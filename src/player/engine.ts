/**
 * Transport for the falling-notes player.
 *
 * Time model: a monotonic *session beat* B. It starts negative (lead-in with a one-bar
 * count-in) and grows across loop passes. Pass k covers song beats
 * [regionStart, regionEnd) mapped to session beats [k*passLen, (k+1)*passLen).
 * The clock is anchored to performance.now() (the same clock input timestamps use);
 * audio is scheduled by translating to AudioContext time.
 *
 * Wait mode: when B reaches the next note group that still has pending notes, the clock
 * freezes on that group's beat until the scorer reports every note in it as played.
 */
import type { NoteEvent, PlayOptions, PlayResult, Song } from '../core/types';
import { getAudioContext, playClick, playNote, type Voice } from '../core/audio';
import {
  ST_PENDING,
  Scorer,
  barOfBeat,
  handMatches,
  secondsPerBeat,
  type ExpectedNote,
  type Judgement,
  type ScoreReport,
} from './scoring';

export interface RenderNote {
  midi: number;
  beat: number;
  dur: number;
  hand: 'L' | 'R';
}

export type EngineState = 'idle' | 'running' | 'paused' | 'finished';

export interface EngineCallbacks {
  /** A played note was judged (also called for wrong notes). */
  onJudge?(j: Judgement, midi: number): void;
  /** Non-loop sessions call this once when the last note has passed. */
  onFinish?(): void;
}

/** PlayResult plus extra fields the results screen uses (stored alongside in localStorage). */
export interface PlayResultExt extends PlayResult {
  loopFrom?: number;
  loopTo?: number;
  bars?: ScoreReport['bars'];
  /** Total bars in the level, for clamping loops. */
  songBars?: number;
}

const SCHEDULE_AHEAD_S = 0.12;
const MIN_LEAD_S = 2.5;
const GROUP_EPS = 0.04;
const MAX_VOICES = 48;

export class Engine {
  readonly song: Song;
  readonly opts: PlayOptions;
  readonly bpb: number;
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly passLen: number;
  readonly leadIn: number;
  readonly loop: boolean;
  readonly songBars: number;
  readonly scorer: Scorer;
  /** Accompaniment (the other hand), expanded per pass, sorted by beat. */
  readonly accomp: RenderNote[] = [];

  state: EngineState = 'idle';
  waiting = false;
  tempo: number;
  minTempo: number;
  wait: boolean;
  playAlong: boolean;

  private cb: EngineCallbacks;
  private scoredBase: NoteEvent[];
  private accompBase: NoteEvent[];
  private passes = 0;
  private anchorBeat: number;
  private anchorPerf = 0;
  private beat: number;
  private spb: number;
  private accIdx = 0;
  private alongIdx = 0;
  private clickIdx = 0;
  private clicks: number[] = [];
  private voices: Voice[] = [];
  private voiceIdx = 0;
  private runStart = 0;
  private elapsedMs = 0;
  private finishedAt = Infinity;
  private expectedBuf: number[] = [];

  constructor(song: Song, opts: PlayOptions, cb: EngineCallbacks = {}, playAlong = false) {
    this.song = song;
    this.opts = opts;
    this.cb = cb;
    this.bpb = song.beatsPerBar || 4;
    this.tempo = this.minTempo = clampTempo(opts.tempo);
    this.wait = opts.wait;
    this.playAlong = playAlong;
    this.spb = secondsPerBeat(song.bpm, this.tempo);

    const all = song.levels[opts.level] ?? [];
    const songEnd = all.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
    this.songBars = Math.max(1, Math.ceil(songEnd / this.bpb - 1e-6));

    this.loop = opts.loopFrom != null && opts.loopTo != null;
    if (this.loop) {
      const from = Math.max(1, Math.min(this.songBars, Math.round(opts.loopFrom!)));
      const to = Math.max(from, Math.min(this.songBars, Math.round(opts.loopTo!)));
      this.regionStart = (from - 1) * this.bpb;
      this.regionEnd = to * this.bpb;
    } else {
      this.regionStart = 0;
      this.regionEnd = songEnd;
    }
    this.passLen = Math.max(this.bpb, this.regionEnd - this.regionStart);

    const inRegion = all.filter((n) => n.start >= this.regionStart - 1e-6 && n.start < this.regionEnd - 1e-6);
    this.scoredBase = inRegion.filter((n) => handMatches(n.hand, opts.hands));
    // Like the original app: the hand you are not practising is played for you.
    this.accompBase = opts.hands === 'both' ? [] : inRegion.filter((n) => !handMatches(n.hand, opts.hands));

    const barSec = this.bpb * this.spb;
    this.leadIn = this.bpb * Math.max(1, Math.ceil(MIN_LEAD_S / barSec));
    for (let b = -this.bpb; b < 0; b++) this.clicks.push(b);

    this.scorer = new Scorer({ tempo: this.tempo, wait: this.wait });
    this.anchorBeat = this.beat = -this.leadIn;
    this.addPass();
  }

  // ---- Public API --------------------------------------------------------

  get currentBeat(): number {
    return this.beat;
  }

  get secPerBeat(): number {
    return this.spb;
  }

  /** Song beat for a session beat (lead-in maps to before the region start). */
  songBeatAt(sessionBeat: number): number {
    if (sessionBeat < 0) return this.regionStart + sessionBeat;
    const pass = this.loop ? Math.floor(sessionBeat / this.passLen) : 0;
    return this.regionStart + sessionBeat - pass * this.passLen;
  }

  songBarAt(sessionBeat: number): number {
    return barOfBeat(Math.max(this.regionStart, this.songBeatAt(sessionBeat)), this.bpb);
  }

  /** 0–1 through the current pass. */
  progress(): number {
    if (this.beat <= 0) return 0;
    const inPass = this.loop ? this.beat % this.passLen : this.beat;
    return Math.min(1, inPass / this.passLen);
  }

  get passIndex(): number {
    return this.beat < 0 || !this.loop ? 0 : Math.floor(this.beat / this.passLen);
  }

  start(now = performance.now()): void {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.anchorPerf = now;
    this.runStart = now;
  }

  pause(now = performance.now()): void {
    if (this.state !== 'running') return;
    this.tick(now);
    this.state = 'paused';
    this.anchorBeat = this.beat;
    this.elapsedMs += now - this.runStart;
    this.silence();
  }

  resume(now = performance.now()): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.anchorPerf = now;
    this.runStart = now;
  }

  /**
   * Jump forward to a session beat. Notes jumped over are excluded from the score.
   * (Backward seeks are not supported mid-session: start a new session instead.)
   */
  seek(sessionBeat: number, now = performance.now()): void {
    if (sessionBeat <= this.beat) return;
    while (this.loop && this.passes * this.passLen < sessionBeat + this.passLen) this.addPass();
    this.scorer.skipBefore(sessionBeat - 1e-6);
    this.anchorBeat = this.beat = sessionBeat;
    this.anchorPerf = now;
    this.accIdx = lowerBound(this.accomp, sessionBeat);
    this.alongIdx = lowerBound(this.scorer.notes, sessionBeat);
    this.silence();
  }

  setTempo(tempo: number, now = performance.now()): void {
    const t = clampTempo(tempo);
    if (this.state === 'running') this.tick(now);
    this.anchorBeat = this.beat;
    this.anchorPerf = now;
    this.tempo = t;
    this.minTempo = Math.min(this.minTempo, t);
    this.spb = secondsPerBeat(this.song.bpm, t);
    this.scorer.setTempo(t);
  }

  setWait(wait: boolean, now = performance.now()): void {
    if (this.state === 'running') this.tick(now);
    this.anchorBeat = this.beat;
    this.anchorPerf = now;
    this.wait = wait;
    this.waiting = false;
    this.scorer.setWait(wait);
  }

  /** Feed a played note (performance.now() timestamp, already latency compensated). */
  input(midi: number, time: number): Judgement | null {
    if (this.state !== 'running') return null;
    const beat = this.waiting ? this.beat : this.anchorBeat + (time - this.anchorPerf) / 1000 / this.spb;
    const j = this.scorer.play(midi, beat, this.spb, this.songBarAt(beat), performance.now());
    this.cb.onJudge?.(j, midi);
    return j;
  }

  /** Midis the learner should be playing right now (for the mic detector). Reused array. */
  expectedNow(): number[] {
    const buf = this.expectedBuf;
    buf.length = 0;
    if (this.state !== 'running') return buf;
    const s = this.scorer;
    const i0 = s.firstPending();
    if (i0 < 0) return buf;
    const g = s.notes[i0].beat;
    // Due within ~300 ms (or we're frozen on it).
    if ((g - this.beat) * this.spb > 0.3 && !this.waiting) return buf;
    for (let i = i0; i < s.notes.length && s.notes[i].beat <= g + GROUP_EPS; i++) {
      if (s.status[i] === ST_PENDING) buf.push(s.notes[i].midi);
    }
    return buf;
  }

  /** Index range [first, end) of the next pending scored group, for key hints. */
  nextGroup(out: { first: number; end: number }): boolean {
    const s = this.scorer;
    const i0 = s.firstPending();
    if (i0 < 0) return false;
    const g = s.notes[i0].beat;
    let e = i0;
    while (e < s.notes.length && s.notes[e].beat <= g + GROUP_EPS) e++;
    out.first = i0;
    out.end = e;
    return true;
  }

  /** Advance the clock and schedule audio. Call once per animation frame. */
  tick(now = performance.now()): void {
    if (this.state !== 'running') return;
    let b = this.anchorBeat + (now - this.anchorPerf) / 1000 / this.spb;

    if (this.wait) {
      const i0 = this.scorer.firstPending();
      const g = i0 >= 0 ? this.scorer.notes[i0].beat : Infinity;
      if (b >= g) {
        b = g;
        this.anchorBeat = g;
        this.anchorPerf = now;
        this.waiting = true;
      } else {
        this.waiting = false;
      }
    } else {
      this.waiting = false;
      this.scorer.advance(b, this.spb, now);
    }
    this.beat = b;

    while (this.loop && this.passes * this.passLen < b + this.passLen) this.addPass();

    this.schedule();

    if (!this.loop) {
      const tail = Math.max(1, this.scorer.okWindowMs / 1000 / this.spb + 0.1);
      if (b >= this.passLen + tail && (!this.wait || this.scorer.firstPending() < 0)) this.finish(now);
    }
  }

  /** Stop now and compute the result. Safe to call more than once. */
  finish(now = performance.now()): void {
    if (this.state === 'finished') return;
    if (this.state === 'running') {
      this.elapsedMs += now - this.runStart;
      this.anchorBeat = this.beat;
    }
    this.state = 'finished';
    this.finishedAt = this.beat;
    this.silence();
    this.cb.onFinish?.();
  }

  report(): ScoreReport {
    const end = this.state === 'finished' ? this.finishedAt : this.beat;
    // A note is "reached" once its ok window has passed or we were waiting on it.
    const okBeats = this.scorer.okWindowMs / 1000 / this.spb;
    return this.scorer.report(this.waiting ? end + 1e-6 : end - okBeats);
  }

  result(): PlayResultExt {
    const r = this.report();
    return {
      songId: this.song.id,
      level: this.opts.level,
      hands: this.opts.hands,
      tempo: this.minTempo,
      wait: r.wait,
      notesTotal: r.notesTotal,
      notesHit: r.notesHit,
      perfect: r.perfect,
      early: r.early,
      late: r.late,
      missed: r.missed,
      wrong: r.wrong,
      accuracy: r.accuracy,
      timing: r.timing,
      stars: r.stars,
      durationMs: Math.round(this.elapsedMs),
      at: Date.now(),
      loopFrom: this.loop ? Math.round(this.regionStart / this.bpb) + 1 : undefined,
      loopTo: this.loop ? Math.round(this.regionEnd / this.bpb) : undefined,
      bars: r.bars,
      songBars: this.songBars,
    };
  }

  destroy(): void {
    this.state = 'finished';
    this.silence();
  }

  // ---- Internals -----------------------------------------------------------

  private addPass(): void {
    const off = this.passes * this.passLen - this.regionStart;
    const clip = (n: NoteEvent) => Math.max(0.05, Math.min(n.dur, this.regionEnd - n.start));
    const batch: ExpectedNote[] = this.scoredBase.map((n) => ({
      midi: n.midi,
      beat: n.start + off,
      dur: clip(n),
      hand: n.hand,
      bar: barOfBeat(n.start, this.bpb),
    }));
    this.scorer.add(batch);
    const acc = this.accompBase
      .map((n) => ({ midi: n.midi, beat: n.start + off, dur: clip(n), hand: n.hand }))
      .sort((a, b) => a.beat - b.beat);
    for (const n of acc) this.accomp.push(n);
    this.passes++;
  }

  private schedule(): void {
    const ahead = SCHEDULE_AHEAD_S / this.spb;
    let horizon = this.beat + ahead;
    if (this.wait) {
      // Never sound anything at or beyond the group we may freeze on.
      const i0 = this.scorer.firstPending();
      if (i0 >= 0) horizon = Math.min(horizon, this.scorer.notes[i0].beat - 1e-4);
    }
    if (horizon < this.beat) return;
    let ctx: AudioContext;
    try {
      ctx = getAudioContext();
    } catch {
      return;
    }
    const audioNow = ctx.currentTime;
    const at = (beat: number) => audioNow + Math.max(0, (beat - this.beat) * this.spb);

    while (this.clickIdx < this.clicks.length && this.clicks[this.clickIdx] <= horizon) {
      const cb = this.clicks[this.clickIdx++];
      if (cb >= this.beat - 0.05) playClick(cb === -this.bpb, at(cb));
    }

    const acc = this.accomp;
    while (this.accIdx < acc.length && acc[this.accIdx].beat <= horizon) {
      const n = acc[this.accIdx++];
      if (n.beat < this.beat - 0.25) continue; // stale (e.g. after a long frame)
      this.voice(playNote(n.midi, { when: at(n.beat), duration: Math.max(0.3, n.dur * this.spb + 0.2), velocity: 0.55 }));
    }

    if (this.playAlong) {
      const s = this.scorer.notes;
      while (this.alongIdx < s.length && s[this.alongIdx].beat <= horizon) {
        const n = s[this.alongIdx++];
        if (n.beat < this.beat - 0.25) continue;
        this.voice(playNote(n.midi, { when: at(n.beat), duration: Math.max(0.3, n.dur * this.spb + 0.2), velocity: 0.45 }));
      }
    } else {
      // Keep the pointer current so enabling play-along later doesn't replay the past.
      const s = this.scorer.notes;
      while (this.alongIdx < s.length && s[this.alongIdx].beat <= horizon) this.alongIdx++;
    }
  }

  private voice(v: Voice): void {
    const old = this.voices[this.voiceIdx];
    if (old) old.stop();
    this.voices[this.voiceIdx] = v;
    this.voiceIdx = (this.voiceIdx + 1) % MAX_VOICES;
  }

  private silence(): void {
    for (const v of this.voices) v?.stop();
    this.voices.length = 0;
    this.voiceIdx = 0;
  }
}

export function clampTempo(t: number): number {
  return Math.max(25, Math.min(150, Math.round(Number.isFinite(t) ? t : 100)));
}

function lowerBound(arr: { beat: number }[], beat: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].beat < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
