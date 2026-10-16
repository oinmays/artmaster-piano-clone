/**
 * One shared AudioContext plus a lightweight synthesized piano voice.
 *
 * iOS rules this module handles:
 *  - An AudioContext only starts inside a user gesture: call `unlockAudio()` from a tap handler.
 *  - The ring/silent switch mutes Web Audio unless the audio session is "playback".
 *    Safari 16.4+ exposes `navigator.audioSession`; the mic module switches it to
 *    "play-and-record" while listening and back afterwards.
 */
import { midiToFreq } from './music';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

type AudioSessionType = 'auto' | 'playback' | 'play-and-record' | 'ambient' | 'transient';
interface NavigatorWithSession extends Navigator {
  audioSession?: { type: AudioSessionType };
}

export function setAudioSession(type: AudioSessionType): void {
  const nav = navigator as NavigatorWithSession;
  try {
    if (nav.audioSession) nav.audioSession.type = type;
  } catch {
    /* unsupported */
  }
}

export function getAudioContext(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
  }
  return ctx;
}

export function getMaster(): GainNode {
  getAudioContext();
  return master!;
}

/** Call from any user gesture. Safe to call repeatedly. */
export async function unlockAudio(): Promise<void> {
  setAudioSession('playback');
  const c = getAudioContext();
  if (c.state !== 'running') {
    try {
      await c.resume();
    } catch {
      /* ignored */
    }
  }
  // A one-sample silent buffer fully unlocks output on older iOS.
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b;
  s.connect(c.destination);
  s.start(0);
}

export function setVolume(v: number): void {
  getMaster().gain.value = Math.max(0, Math.min(1, v));
}

export interface Voice {
  stop(at?: number): void;
}

/**
 * Play a piano-ish tone. `when` is in AudioContext time (defaults to now);
 * `duration` in seconds (defaults to a natural decay).
 */
export function playNote(midi: number, opts: { when?: number; duration?: number; velocity?: number } = {}): Voice {
  const c = getAudioContext();
  const t0 = opts.when ?? c.currentTime;
  const vel = Math.max(0.05, Math.min(1, opts.velocity ?? 0.75));
  const f = midiToFreq(midi);
  const decay = opts.duration ?? Math.max(0.6, 2.4 - (midi - 48) * 0.025);

  const out = c.createGain();
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(12000, f * 8 * (0.5 + vel)), t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2), t0 + decay);
  filter.Q.value = 0.7;

  // Three partials give a soft, bright attack that settles quickly.
  const partials: Array<[OscillatorType, number, number]> = [
    ['triangle', 1, 0.6],
    ['sine', 2, 0.25],
    ['sine', 3, 0.08],
  ];
  const oscs = partials.map(([type, mult, gain]) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f * mult;
    o.detune.value = (Math.random() - 0.5) * 4;
    const g = c.createGain();
    g.gain.value = gain;
    o.connect(g).connect(filter);
    return o;
  });

  const peak = 0.32 * vel;
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  out.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + 0.25);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);

  filter.connect(out).connect(getMaster());
  oscs.forEach((o) => o.start(t0));
  const end = t0 + decay + 0.05;
  oscs.forEach((o) => o.stop(end));

  let stopped = false;
  return {
    stop(at?: number) {
      if (stopped) return;
      stopped = true;
      const t = Math.max(at ?? c.currentTime, t0 + 0.01);
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0.0001, t, 0.06);
      oscs.forEach((o) => {
        try {
          o.stop(t + 0.4);
        } catch {
          /* already stopped */
        }
      });
    },
  };
}

/** Short percussive click for metronomes and count-ins. */
export function playClick(accent: boolean, when?: number): void {
  const c = getAudioContext();
  const t = when ?? c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.35, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(getMaster());
  o.start(t);
  o.stop(t + 0.06);
}
