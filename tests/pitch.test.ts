import { describe, expect, it, vi } from 'vitest';
import { onNoteOn } from '../src/core/input';
import type { PlayedNote } from '../src/core/types';
import type { RawFrame } from '../src/listen/source';

// Drive startMic with synthetic audio instead of a real microphone.
const feed: { cb: ((f: RawFrame) => void) | null } = { cb: null };
vi.mock('../src/listen/source', () => ({
  openMic: async (cb: (f: RawFrame) => void) => {
    feed.cb = cb;
    return { sampleRate: 44100, stop: () => (feed.cb = null) };
  },
}));
import { startMic } from '../src/listen/mic';
import {
  confirmNotes,
  detectPitch,
  freqToNote,
  magnitudeSpectrum,
  OnsetDetector,
  rms,
} from '../src/listen/pitch';

const SR = 44100;
const midiFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Deterministic PRNG so noise is reproducible. */
function rng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sine(freq: number, n: number, amp = 0.5, sr = SR): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

/** Piano-ish tone: decaying partials with slight inharmonicity. */
function pianoTone(
  freq: number,
  n: number,
  opts: { amp?: number; partials?: number[]; offset?: number; decay?: number; sr?: number } = {},
): Float32Array {
  const sr = opts.sr ?? SR;
  const partials = opts.partials ?? [1, 0.6, 0.4, 0.25, 0.15];
  const amp = opts.amp ?? 0.3;
  const B = 0.0004;
  const out = new Float32Array(n);
  const off = opts.offset ?? 0;
  for (let h = 0; h < partials.length; h++) {
    const k = h + 1;
    const fk = freq * k * Math.sqrt(1 + B * k * k);
    if (fk > sr / 2) continue;
    const ph = h * 0.7;
    for (let i = 0; i < n; i++) {
      const t = (i + off) / sr;
      const env = Math.exp(-t * (opts.decay ?? 1.5) * (1 + h * 0.5));
      out[i] += amp * partials[h] * env * Math.sin(2 * Math.PI * fk * t + ph);
    }
  }
  return out;
}

function addNoise(buf: Float32Array, level: number, seed = 7): Float32Array {
  const r = rng(seed);
  for (let i = 0; i < buf.length; i++) buf[i] += level * (r() * 2 - 1);
  return buf;
}

function mix(...bufs: Float32Array[]): Float32Array {
  const out = new Float32Array(Math.max(...bufs.map((b) => b.length)));
  bufs.forEach((b) => b.forEach((v, i) => (out[i] += v)));
  return out;
}

function centsError(found: number, target: number): number {
  return 1200 * Math.log2(found / target);
}

describe('YIN pitch detection', () => {
  it('detects 440 Hz as A4 within ±10 cents', () => {
    const r = detectPitch(sine(440, 2048), SR);
    expect(Math.abs(centsError(r.freq, 440))).toBeLessThan(10);
    expect(freqToNote(r.freq).midi).toBe(69);
    expect(r.clarity).toBeGreaterThan(0.9);
  });

  it('detects 110 Hz (A2) and 1046.5 Hz (C6)', () => {
    const lo = detectPitch(sine(110, 2048), SR);
    expect(Math.abs(centsError(lo.freq, 110))).toBeLessThan(10);
    const hi = detectPitch(sine(1046.5, 2048), SR);
    expect(Math.abs(centsError(hi.freq, 1046.5))).toBeLessThan(10);
    expect(freqToNote(hi.freq).midi).toBe(84);
  });

  it('works at 48 kHz and for a low A1 with a 4096 window', () => {
    const r = detectPitch(pianoTone(55, 4096, { sr: 48000 }), 48000);
    expect(Math.abs(centsError(r.freq, 55))).toBeLessThan(10);
  });

  it('finds the fundamental of a piano-like tone with harmonics (no octave error)', () => {
    for (const m of [45, 57, 60, 72, 79]) {
      const f = midiFreq(m);
      const buf = addNoise(pianoTone(f, 2048, { partials: [0.5, 1, 0.7, 0.4, 0.3, 0.2] }), 0.002);
      const r = detectPitch(buf, SR);
      expect(freqToNote(r.freq).midi).toBe(m);
      expect(r.clarity).toBeGreaterThan(0.8);
    }
  });

  it('gives low clarity for noise and nothing for silence', () => {
    const noise = addNoise(new Float32Array(2048), 0.3, 3);
    expect(detectPitch(noise, SR).clarity).toBeLessThan(0.5);
    expect(detectPitch(new Float32Array(2048), SR)).toEqual({ freq: 0, clarity: 0 });
  });
});

describe('expected-note confirmation', () => {
  const N = 4096;

  it('finds C4+E4+G4 in a triad and rejects a missing F4', () => {
    const buf = addNoise(
      mix(...[60, 64, 67].map((m, i) => pianoTone(midiFreq(m), N, { amp: 0.2, offset: 2000 + i * 37 }))),
      0.003,
    );
    const mag = magnitudeSpectrum(buf);
    const res = confirmNotes(mag, SR, N, [60, 64, 67, 65]);
    const byMidi = Object.fromEntries(res.map((r) => [r.midi, r.present]));
    expect(byMidi).toEqual({ 60: true, 64: true, 67: true, 65: false });
  });

  it('rejects the chord tone that was not played', () => {
    const buf = addNoise(mix(pianoTone(midiFreq(60), N), pianoTone(midiFreq(64), N)), 0.003);
    const res = confirmNotes(magnitudeSpectrum(buf), SR, N, [60, 64, 67]);
    expect(res.map((r) => r.present)).toEqual([true, true, false]);
  });

  it('handles a 4-note chord across two octaves (C3 G3 E4 C5... minus one)', () => {
    const played = [48, 55, 64, 70];
    const buf = addNoise(mix(...played.map((m) => pianoTone(midiFreq(m), N, { amp: 0.15 }))), 0.003);
    const res = confirmNotes(magnitudeSpectrum(buf), SR, N, [48, 55, 64, 70, 66]);
    expect(res.map((r) => r.present)).toEqual([true, true, true, true, false]);
  });

  it('does not confirm a note played an octave too low', () => {
    const buf = addNoise(pianoTone(midiFreq(48), N), 0.003);
    const res = confirmNotes(magnitudeSpectrum(buf), SR, N, [60]);
    expect(res[0].present).toBe(false);
  });

  it('respects the baseline: a note still ringing is not "freshly" played', () => {
    const before = magnitudeSpectrum(addNoise(pianoTone(midiFreq(64), N, { amp: 0.2 }), 0.003));
    const now = magnitudeSpectrum(
      addNoise(mix(pianoTone(midiFreq(64), N, { amp: 0.2, offset: 1000 }), pianoTone(midiFreq(60), N)), 0.003, 9),
    );
    const res = confirmNotes(now, SR, N, [60, 64], { baseline: before });
    expect(res.map((r) => r.present)).toEqual([true, false]);
  });

  it('finds nothing in noise', () => {
    const res = confirmNotes(magnitudeSpectrum(addNoise(new Float32Array(N), 0.1)), SR, N, [60, 64, 67]);
    expect(res.every((r) => !r.present)).toBe(true);
  });
});

describe('onset detection', () => {
  const HOP = 512;

  function runOnsets(signal: Float32Array, spectral = true): number[] {
    const det = new OnsetDetector();
    const onsets: number[] = [];
    const win = 1024;
    for (let end = win; end <= signal.length; end += HOP) {
      const frame = signal.subarray(end - win, end);
      const t = (end / SR) * 1000;
      const hit = det.process({
        time: t,
        rms: rms(frame, win - HOP, win),
        mag: spectral ? magnitudeSpectrum(frame) : undefined,
        sampleRate: SR,
      });
      if (hit) onsets.push(t);
    }
    return onsets;
  }

  function twoNotes(m1: number, m2: number): Float32Array {
    const total = Math.round(SR * 1.6);
    const s1 = Math.round(SR * 0.3);
    const s2 = Math.round(SR * 0.9);
    const sig = new Float32Array(total);
    const a = pianoTone(midiFreq(m1), total - s1, { decay: 3 });
    const b = pianoTone(midiFreq(m2), total - s2, { decay: 3 });
    a.forEach((v, i) => (sig[s1 + i] += v));
    b.forEach((v, i) => (sig[s2 + i] += v));
    return addNoise(sig, 0.002);
  }

  const near = (onsets: number[], ms: number) => onsets.some((t) => Math.abs(t - ms) < 40);

  it('counts a repeated same note twice', () => {
    const onsets = runOnsets(twoNotes(69, 69));
    expect(onsets).toHaveLength(2);
    expect(near(onsets, 300)).toBe(true);
    expect(near(onsets, 900)).toBe(true);
  });

  it('detects two consecutive different notes', () => {
    const onsets = runOnsets(twoNotes(60, 64));
    expect(onsets).toHaveLength(2);
    expect(near(onsets, 300)).toBe(true);
    expect(near(onsets, 900)).toBe(true);
  });

  it('works on energy alone (clicks for latency calibration)', () => {
    const sig = addNoise(new Float32Array(SR), 0.002);
    for (const at of [0.2, 0.5, 0.8]) {
      const s = Math.round(at * SR);
      for (let i = 0; i < 2000; i++) sig[s + i] += 0.5 * Math.exp(-i / 300) * Math.sin(i * 0.17);
    }
    const onsets = runOnsets(sig, false);
    expect(onsets).toHaveLength(3);
    [200, 500, 800].forEach((ms) => expect(near(onsets, ms)).toBe(true));
  });

  it('stays quiet on steady noise', () => {
    expect(runOnsets(addNoise(new Float32Array(SR), 0.01))).toHaveLength(0);
  });
});

describe('startMic pipeline (simulated microphone)', () => {
  async function play(signal: Float32Array, expected: () => number[]): Promise<PlayedNote[]> {
    const got: PlayedNote[] = [];
    const off = onNoteOn((n) => got.push(n));
    const l = await startMic({ expected, latencyMs: 0 });
    const W = 4096;
    const hop = 551;
    const ring = new Float32Array(W);
    for (let pos = 0; pos + hop <= signal.length; pos += hop) {
      ring.copyWithin(0, hop);
      ring.set(signal.subarray(pos, pos + hop), W - hop);
      feed.cb!({ samples: ring, hop, time: ((pos + hop) / SR) * 1000, sampleRate: SR });
    }
    l.stop();
    off();
    return got;
  }

  function sequence(events: Array<{ at: number; notes: number[] }>, seconds: number): Float32Array {
    const sig = new Float32Array(Math.round(SR * seconds));
    for (const e of events) {
      const s = Math.round(e.at * SR);
      for (const m of e.notes) {
        pianoTone(midiFreq(m), sig.length - s, { amp: 0.15, decay: 2.5 }).forEach((v, i) => (sig[s + i] += v));
      }
    }
    return addNoise(sig, 0.002);
  }

  it('confirms an expected triad once, then a repeated note again', async () => {
    const sig = sequence(
      [
        { at: 0.4, notes: [60, 64, 67] },
        { at: 1.2, notes: [67] },
      ],
      2,
    );
    const got = await play(sig, () => [60, 64, 67]);
    const first = got.filter((n) => n.time < 1100).map((n) => n.midi).sort();
    const second = got.filter((n) => n.time >= 1100).map((n) => n.midi);
    expect(first).toEqual([60, 64, 67]);
    expect(second).toEqual([67]);
    expect(got.every((n) => n.source === 'mic')).toBe(true);
    expect(Math.abs(got[0].time - 400)).toBeLessThan(40);
  });

  it('falls back to monophonic YIN when nothing is expected', async () => {
    const got = await play(sequence([{ at: 0.3, notes: [62] }, { at: 0.9, notes: [65] }], 1.6), () => []);
    expect(got.map((n) => n.midi)).toEqual([62, 65]);
  });

  it('reports a wrong note (not in expected) through the fallback', async () => {
    const got = await play(sequence([{ at: 0.3, notes: [62] }], 1), () => [60]);
    expect(got.map((n) => n.midi)).toEqual([62]);
  });
});
