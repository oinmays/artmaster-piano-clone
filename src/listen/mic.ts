/**
 * Microphone listening: onsets → note confirmation → input bus.
 *
 * Per ~12 ms frame:
 *  1. RMS of the newest hop, adaptive noise floor, spectral-flux onset (1024-pt spectrum).
 *  2. After an onset, for ~175 ms: if the player expects notes, confirm each expected note
 *     from a 4096-pt spectrum (harmonic peaks vs. local floor, must have risen relative to the
 *     pre-onset spectrum). Otherwise (or if nothing confirms) fall back to YIN monophonic.
 *     Each pitch is emitted at most once per onset, timestamped at the onset.
 *  3. Active notes get a noteOff when their partials vanish or the signal drops under the gate.
 *
 * Sensitivity (settings.micSensitivity → sensitivityFactor f) scales the loudness thresholds:
 * the RMS gate and absolute minimum (×f, inside OnsetDetector; the gate never below 1.2× floor)
 * and the chord-confirmation SNR (×√f, never below 3, minSnrFor). YIN clarity (0.85), flux k/delta, energy rise and the baseline rise ratio
 * are left alone: they measure signal quality or relative change, not loudness. The setting
 * is followed live through onSettingsChange; no restart needed.
 */
import { emitNoteOff, emitNoteOn } from '../core/input';
import { getSettings, onSettingsChange } from '../core/store';
import { confirmNotes, detectPitch, freqToNote, magnitudeSpectrum, OnsetDetector, rms } from './pitch';
import { minSnrFor, sensitivityFactor } from './sensitivity';
import { openMic, type RawFrame } from './source';
import type { Listener, MicOptions, PitchFrame, PitchStreamOptions } from './types';

const CONFIRM_FRAMES = 14; // ≈ 175 ms at 80 frames/s
const FIRST_CHECK = 1; // first frame after the onset that may confirm
const FALLBACK_AFTER = 6; // frames before YIN may stand in for an unconfirmed expectation
const OFF_MISSES = 8; // ≈ 100 ms without partials → noteOff
const MAX_NOTE_MS = 10000;

const pow2 = (x: number) => 2 ** Math.round(Math.log2(x));

/**
 * Apply the sensitivity now and keep following settings.micSensitivity, unless the caller
 * pinned one. Returns the unsubscribe function.
 */
function trackSensitivity(override: number | undefined, apply: (factor: number) => void): () => void {
  if (override != null) {
    apply(sensitivityFactor(override));
    return () => {};
  }
  apply(sensitivityFactor(getSettings().micSensitivity));
  return onSettingsChange((s) => apply(sensitivityFactor(s.micSensitivity)));
}

interface Pending {
  time: number;
  frame: number;
  emitted: Set<number>;
  baseline: Float32Array | null;
  lastMono: number;
  monoVotes: number;
}

interface Active {
  since: number;
  misses: number;
}

export async function startMic(opts: MicOptions = {}): Promise<Listener> {
  const settings = getSettings();
  const a4 = opts.a4 ?? settings.a4;
  const latency = opts.latencyMs ?? settings.micLatencyMs;
  const onsets = new OnsetDetector();
  let minSnr = minSnrFor(onsets.sensitivity);
  const untrack = trackSensitivity(opts.sensitivity, (f) => {
    onsets.setSensitivity(f);
    minSnr = minSnrFor(f);
  });
  const active = new Map<number, Active>();
  let pending: Pending | null = null;
  const specHistory: Float32Array[] = [];

  const noteOn = (midi: number, time: number) => {
    if (midi < 21 || midi > 108) return;
    if (active.has(midi)) emitNoteOff({ midi, time: time - latency, source: 'mic' });
    active.set(midi, { since: time, misses: 0 });
    emitNoteOn({ midi, time: time - latency, source: 'mic' });
  };
  const noteOff = (midi: number, time: number) => {
    if (!active.delete(midi)) return;
    emitNoteOff({ midi, time: time - latency, source: 'mic' });
  };

  const onFrame = (f: RawFrame) => {
    const { samples, hop, sampleRate: sr } = f;
    const W = samples.length;
    const level = rms(samples, Math.max(0, W - hop), W);
    const fluxSize = Math.min(W, pow2(sr * 0.021));
    const fluxMag = magnitudeSpectrum(samples, fluxSize);
    const isOnset = onsets.process({ time: f.time, rms: level, mag: fluxMag, sampleRate: sr });
    const open = onsets.gateOpen(level);
    if (opts.onFrame) {
      let freq = 0;
      let clarity = 0;
      if (opts.livePitch && open) {
        const yinSize = Math.min(W, pow2(sr * 0.043));
        const r = detectPitch(samples.subarray(W - yinSize), sr, { minFreq: 50, maxFreq: 2200 });
        freq = r.freq;
        clarity = r.clarity;
      }
      opts.onFrame({ rms: level, floor: onsets.floor.floor, gate: onsets.gateLevel(), onset: isOnset, freq, clarity });
    }

    const expected = opts.expected?.() ?? [];
    const needSpectrum = expected.length > 0 || active.size > 0 || pending != null;
    const spec = needSpectrum || isOnset ? magnitudeSpectrum(samples) : null;

    if (isOnset) {
      pending = {
        time: f.time - ((hop / 2) / sr) * 1000,
        frame: 0,
        emitted: new Set(),
        baseline: specHistory.length ? specHistory[0] : null,
        lastMono: -1,
        monoVotes: 0,
      };
    }

    if (pending) {
      const p = pending;
      p.frame++;
      if (p.frame >= FIRST_CHECK && open) {
        let confirmedAny = p.emitted.size > 0;
        if (expected.length && spec) {
          const res = confirmNotes(spec, sr, W, expected, { a4, minSnr, baseline: p.baseline ?? undefined });
          for (const r of res) {
            if (r.present && !p.emitted.has(r.midi)) {
              p.emitted.add(r.midi);
              noteOn(r.midi, p.time);
              confirmedAny = true;
            }
          }
        }
        // Monophonic path: nothing expected, or the learner played something else.
        if (!confirmedAny && (!expected.length || p.frame >= FALLBACK_AFTER)) {
          const yinSize = Math.min(W, pow2(sr * 0.043));
          const r = detectPitch(samples.subarray(W - yinSize), sr, { minFreq: 50, maxFreq: 2200 });
          if (r.freq > 0 && r.clarity >= 0.85) {
            const midi = freqToNote(r.freq, a4).midi;
            p.monoVotes = midi === p.lastMono ? p.monoVotes + 1 : 1;
            p.lastMono = midi;
            if (p.monoVotes >= 2 && !p.emitted.has(midi)) {
              p.emitted.add(midi);
              noteOn(midi, p.time);
              pending = null; // one pitch per onset in monophonic mode
            }
          }
        }
      }
      if (pending && p.frame >= CONFIRM_FRAMES) pending = null;
    }

    // Note-offs.
    if (active.size) {
      if (!open) {
        [...active.keys()].forEach((m) => noteOff(m, f.time));
      } else if (spec) {
        const res = confirmNotes(spec, sr, W, [...active.keys()], { a4, minSnr });
        for (const r of res) {
          const a = active.get(r.midi)!;
          const justStarted = pending?.emitted.has(r.midi);
          a.misses = r.present || justStarted ? 0 : a.misses + 1;
          if (a.misses >= OFF_MISSES || f.time - a.since > MAX_NOTE_MS) noteOff(r.midi, f.time);
        }
      }
    }

    if (spec) {
      specHistory.push(spec.slice());
      if (specHistory.length > 2) specHistory.shift();
    } else {
      specHistory.length = 0;
    }
  };

  let src: Awaited<ReturnType<typeof openMic>>;
  try {
    src = await openMic(onFrame);
  } catch (e) {
    untrack();
    throw e;
  }
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      untrack();
      src.stop();
      const now = performance.now();
      [...active.keys()].forEach((m) => noteOff(m, now));
    },
  };
}

/**
 * Lower-level stream for the tuner, meters and latency calibration: one callback per
 * frame with the YIN pitch, clarity, RMS and an onset flag.
 */
export async function startPitchStream(
  cb: (p: PitchFrame) => void,
  opts: PitchStreamOptions = {},
): Promise<Listener> {
  const onsets = new OnsetDetector();
  const onFrame = (f: RawFrame) => {
    const { samples, hop, sampleRate: sr } = f;
    const W = samples.length;
    const level = rms(samples, Math.max(0, W - hop), W);
    const fluxMag = magnitudeSpectrum(samples, Math.min(W, pow2(sr * 0.021)));
    const onset = onsets.process({ time: f.time, rms: level, mag: fluxMag, sampleRate: sr });
    let freq = 0;
    let clarity = 0;
    if (onsets.gateOpen(level)) {
      const r = detectPitch(samples, sr, { minFreq: opts.minFreq ?? 50, maxFreq: opts.maxFreq ?? 2200 });
      freq = r.freq;
      clarity = r.clarity;
    }
    cb({ freq, clarity, rms: level, time: f.time, onset, floor: onsets.floor.floor, gate: onsets.gateLevel() });
  };
  const untrack = trackSensitivity(opts.sensitivity, (f) => onsets.setSensitivity(f));
  let src: Awaited<ReturnType<typeof openMic>>;
  try {
    src = await openMic(onFrame, { windowSize: opts.windowSize });
  } catch (e) {
    untrack();
    throw e;
  }
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      untrack();
      src.stop();
    },
  };
}
