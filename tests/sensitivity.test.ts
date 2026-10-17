import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MIC_SENSITIVITY, DEFAULT_SETTINGS, updateSettings } from '../src/core/store';
import type { RawFrame } from '../src/listen/source';
import type { MicFrameInfo, PitchFrame } from '../src/listen/types';

// Drive the mic pipelines with synthetic audio instead of a real microphone.
const feed: { cb: ((f: RawFrame) => void) | null } = { cb: null };
vi.mock('../src/listen/source', () => ({
  openMic: async (cb: (f: RawFrame) => void) => {
    feed.cb = cb;
    return { sampleRate: 44100, stop: () => (feed.cb = null) };
  },
}));
import { startMic, startPitchStream } from '../src/listen/mic';
import { confirmNotes, magnitudeSpectrum, OnsetDetector, rms } from '../src/listen/pitch';
import {
  BASE_GATE,
  BASE_MIN_RMS,
  DEFAULT_SENSITIVITY_FACTOR,
  gateFromFloor,
  minSnrFor,
  sensitivityFactor,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
} from '../src/listen/sensitivity';

const SR = 44100;
const HOP = 512;
const midiFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

function rng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pianoTone(freq: number, n: number, amp: number, opts: { decay?: number; offset?: number } = {}): Float32Array {
  const partials = [1, 0.6, 0.4, 0.25, 0.15];
  const B = 0.0004;
  const out = new Float32Array(n);
  for (let h = 0; h < partials.length; h++) {
    const k = h + 1;
    const fk = freq * k * Math.sqrt(1 + B * k * k);
    for (let i = 0; i < n; i++) {
      const t = (i + (opts.offset ?? 0)) / SR;
      const env = Math.exp(-t * (opts.decay ?? 1.5) * (1 + h * 0.5));
      out[i] += amp * partials[h] * env * Math.sin(2 * Math.PI * fk * t + h * 0.7);
    }
  }
  return out;
}

function addNoise(buf: Float32Array, level: number, seed = 7): Float32Array {
  const r = rng(seed);
  for (let i = 0; i < buf.length; i++) buf[i] += level * (r() * 2 - 1);
  return buf;
}

/** Feed `signal` through an OnsetDetector; returns onset times (ms) and gate-open frames after `afterMs`. */
function runOnsets(signal: Float32Array, factor: number, afterMs = 0): { onsets: number[]; openFrames: number } {
  const det = new OnsetDetector({ sensitivity: factor });
  const onsets: number[] = [];
  let openFrames = 0;
  const win = 1024;
  for (let end = win; end <= signal.length; end += HOP) {
    const frame = signal.subarray(end - win, end);
    const t = (end / SR) * 1000;
    const level = rms(frame, win - HOP, win);
    if (det.process({ time: t, rms: level, mag: magnitudeSpectrum(frame), sampleRate: SR })) onsets.push(t);
    if (t > afterMs && det.gateOpen(level)) openFrames++;
  }
  return { onsets, openFrames };
}

describe('sensitivityFactor', () => {
  it('maps the endpoints and the default exactly', () => {
    expect(sensitivityFactor(SENSITIVITY_MIN)).toBeCloseTo(1.125, 12);
    expect(sensitivityFactor(SENSITIVITY_DEFAULT)).toBe(0.75);
    expect(sensitivityFactor(DEFAULT_MIC_SENSITIVITY)).toBe(DEFAULT_SENSITIVITY_FACTOR);
    expect(sensitivityFactor(DEFAULT_SETTINGS.micSensitivity)).toBe(0.75);
    expect(sensitivityFactor(SENSITIVITY_MAX)).toBeCloseTo(0.5, 12);
  });

  it('reproduces the pre-T16 thresholds near 15', () => {
    expect(sensitivityFactor(14.5)).toBeCloseTo(1, 2);
  });

  it('is strictly decreasing, clamped, and safe on junk input', () => {
    for (let s = 1; s <= 100; s++) expect(sensitivityFactor(s)).toBeLessThan(sensitivityFactor(s - 1));
    expect(sensitivityFactor(-20)).toBe(sensitivityFactor(0));
    expect(sensitivityFactor(250)).toBe(sensitivityFactor(100));
    expect(sensitivityFactor(NaN)).toBe(0.75);
  });

  it('keeps the gate at least 1.25x the floor at maximum, and scales SNR by sqrt', () => {
    expect(BASE_GATE * sensitivityFactor(100)).toBeGreaterThanOrEqual(1.25 - 1e-9);
    expect(minSnrFor(1)).toBe(5);
    expect(minSnrFor(0.75)).toBeCloseTo(4.33, 2);
    expect(minSnrFor(0.5)).toBeCloseTo(3.54, 2);
  });
});

describe('OnsetDetector sensitivity', () => {
  it('defaults to factor 0.75: gate 1.875x floor, minRms 0.0006', () => {
    const det = new OnsetDetector();
    expect(det.sensitivity).toBe(0.75);
    expect(det.gateLevel()).toBeCloseTo(0.0006, 12); // empty floor → absolute minimum rules
    for (let i = 0; i < 50; i++) det.process({ time: i * 12, rms: 0.01 });
    expect(det.gateLevel()).toBeCloseTo(0.01 * 1.875, 9);
    expect(det.gateLevel()).toBeCloseTo(gateFromFloor(det.floor.floor), 12);
    det.setSensitivity(1);
    expect(det.gateLevel()).toBeCloseTo(0.01 * BASE_GATE, 9);
    expect(gateFromFloor(0, 1)).toBe(BASE_MIN_RMS);
  });

  it('hears a quieter note at the default that the old thresholds missed', () => {
    const sig = new Float32Array(SR * 3);
    const start = SR * 2;
    pianoTone(midiFreq(60), SR, 0.0025).forEach((v, i) => (sig[start + i] += v));
    addNoise(sig, 0.002);
    const old = runOnsets(sig, 1);
    const now = runOnsets(sig, sensitivityFactor(DEFAULT_MIC_SENSITIVITY));
    expect(old.onsets).toHaveLength(0);
    expect(now.onsets).toHaveLength(1);
    expect(Math.abs(now.onsets[0] - 2000)).toBeLessThan(40);
  });

  describe('at maximum sensitivity, steady noise never counts as a note', () => {
    const fMax = sensitivityFactor(SENSITIVITY_MAX);
    const seconds = 6;
    const warmMs = 1500;

    it('white noise (loud and very quiet)', () => {
      for (const [level, seed] of [
        [0.01, 3],
        [0.002, 11],
        [0.0005, 5],
      ] as const) {
        const r = runOnsets(addNoise(new Float32Array(SR * seconds), level, seed), fMax, warmMs);
        expect(r.onsets.filter((t) => t > warmMs)).toEqual([]);
        expect(r.openFrames).toBe(0);
      }
    });

    // Per-hop RMS of 50 Hz hum ripples ~2x (a 12 ms hop is shorter than a 20 ms cycle), so at
    // max sensitivity the gate may flicker open on ripple peaks; what matters is no onsets.
    it.each([50, 60])('%i Hz mains hum with harmonics plus hiss', (hz) => {
      const sig = new Float32Array(SR * seconds);
      for (let i = 0; i < sig.length; i++) {
        const w = (2 * Math.PI * hz * i) / SR;
        sig[i] = 0.004 * Math.sin(w) + 0.002 * Math.sin(2 * w + 1) + 0.001 * Math.sin(3 * w + 2);
      }
      const r = runOnsets(addNoise(sig, 0.001, 21), fMax, warmMs);
      expect(r.onsets.filter((t) => t > warmMs)).toEqual([]);
    });

    it('slowly swelling fan noise (gate may open, but no onsets)', () => {
      const sig = addNoise(new Float32Array(SR * seconds), 0.006, 17);
      for (let i = 0; i < sig.length; i++) sig[i] *= 1 + 0.25 * Math.sin((2 * Math.PI * 0.4 * i) / SR);
      const r = runOnsets(sig, fMax, warmMs);
      expect(r.onsets.filter((t) => t > warmMs)).toEqual([]);
    });
  });
});

describe('confirmNotes minSnr', () => {
  const N = 4096;

  it('a weaker note passes at the default minSnr (4.33) but not at the old 5', () => {
    const mag = magnitudeSpectrum(addNoise(pianoTone(midiFreq(60), N, 0.044, { offset: 2000 }), 0.25));
    expect(confirmNotes(mag, SR, N, [60], { minSnr: 5 })[0].present).toBe(false);
    expect(confirmNotes(mag, SR, N, [60], { minSnr: minSnrFor(0.75) })[0].present).toBe(true);
  });

  it('still finds nothing in noise at the maximum-sensitivity minSnr', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const mag = magnitudeSpectrum(addNoise(new Float32Array(N), 0.1, seed));
      const res = confirmNotes(mag, SR, N, [48, 60, 64, 67, 72], { minSnr: minSnrFor(sensitivityFactor(100)) });
      expect(res.filter((r) => r.present)).toEqual([]);
    }
  });
});

describe('live sensitivity updates', () => {
  afterEach(() => updateSettings({ micSensitivity: DEFAULT_MIC_SENSITIVITY }));

  /** Push ~1 s of steady noise through the mocked mic so the floor settles. */
  function pump(n = 80): void {
    const W = 4096;
    const hop = 551;
    const ring = new Float32Array(W);
    const r = rng(9);
    for (let k = 0; k < n; k++) {
      ring.copyWithin(0, hop);
      for (let i = W - hop; i < W; i++) ring[i] = 0.01 * (r() * 2 - 1);
      feed.cb?.({ samples: ring, hop, time: k * 12.5, sampleRate: SR });
    }
  }

  it('startMic reports gate from the detector and follows settings changes until stop()', async () => {
    let last: MicFrameInfo | null = null;
    const l = await startMic({ onFrame: (f) => (last = f), latencyMs: 0 });
    pump();
    const f0 = last!;
    expect(f0.gate / f0.floor).toBeCloseTo(BASE_GATE * 0.75, 6);
    updateSettings({ micSensitivity: 100 });
    pump(1);
    expect(last!.gate / last!.floor).toBeCloseTo(BASE_GATE * 0.5, 6);
    l.stop();
    // After stop the listener is unsubscribed: a new session starts from the saved value only.
    updateSettings({ micSensitivity: 0 });
    expect(feed.cb).toBeNull();
  });

  it('startPitchStream includes gate and follows settings; a pinned sensitivity ignores them', async () => {
    let last: PitchFrame | null = null;
    const l = await startPitchStream((p) => (last = p));
    pump();
    expect(last!.gate / last!.floor).toBeCloseTo(BASE_GATE * 0.75, 6);
    updateSettings({ micSensitivity: 0 });
    pump(1);
    expect(last!.gate / last!.floor).toBeCloseTo(BASE_GATE * 1.125, 6);
    l.stop();

    const pinned = await startPitchStream((p) => (last = p), { sensitivity: 100 });
    pump();
    updateSettings({ micSensitivity: 0 });
    pump(1);
    expect(last!.gate / last!.floor).toBeCloseTo(BASE_GATE * 0.5, 6);
    pinned.stop();
  });
});
