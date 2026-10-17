/**
 * Scoring engine. Pure and DOM-free so it can be unit tested.
 *
 * Everything is measured in *session beats* (quarter notes since the start of the
 * session, monotonic across loop passes). Timing windows are defined in milliseconds
 * and converted with the current seconds-per-beat at judgement time, so tempo changes
 * mid-session are handled naturally.
 *
 * Judgements (non-wait mode):
 *   |dt| <= perfect window  -> perfect (timing 1)
 *   |dt| <= ok window       -> early / late hit (timing 0.5)
 *   otherwise               -> the played note is wrong; the expected note is missed
 *                              once its ok window has passed.
 * Wait mode: the clock freezes on each note group, so timing is not judged. Any pending
 * expected note with the same pitch at or before the playhead (plus a short look-ahead)
 * is a hit; everything else is wrong.
 */
import type { Hand, HandsMode, NoteEvent } from '../core/types';

// ---- Note status codes (numbers so the renderer can read them without allocation) --
export const ST_PENDING = 0;
export const ST_PERFECT = 1;
export const ST_EARLY = 2;
export const ST_LATE = 3;
/** Hit in wait mode (timing not judged). */
export const ST_HIT = 4;
export const ST_MISSED = 5;
/** Jumped over by a seek; excluded from every total. */
export const ST_SKIPPED = 6;

export const isHitStatus = (s: number): boolean => s >= ST_PERFECT && s <= ST_HIT;

export interface ExpectedNote {
  midi: number;
  /** Session beat of the note's onset. */
  beat: number;
  dur: number;
  hand: Hand;
  /** Suggested finger, 1–5 (src/player/fingering.ts). */
  finger?: number;
  /** 1-based bar number in the song (same across loop passes). */
  bar: number;
}

export type JudgementKind = 'perfect' | 'early' | 'late' | 'hit' | 'wrong';

export interface Judgement {
  kind: JudgementKind;
  /** Index into Scorer.notes, or -1 for a wrong note. */
  index: number;
  /** Played minus expected, in ms (0 in wait mode / for wrong notes). */
  deltaMs: number;
}

export interface BarStat {
  bar: number;
  total: number;
  hit: number;
  wrong: number;
  /** 0–100. Wrong notes count as a penalty here so "tricky parts" surface sloppy bars. */
  accuracy: number;
}

export interface ScoreReport {
  notesTotal: number;
  notesHit: number;
  perfect: number;
  early: number;
  late: number;
  missed: number;
  wrong: number;
  accuracy: number;
  timing: number;
  stars: 0 | 1 | 2 | 3;
  /** True if wait mode was on at any point (timing then reported as 100). */
  wait: boolean;
  bars: BarStat[];
}

// ---- Windows -----------------------------------------------------------------

export const PERFECT_MS = 80;
export const OK_MS = 200;

/**
 * Windows widen at slow tempos (long gaps make precise placement harder and there is
 * room between notes) and tighten slightly when faster. tempo is a % of the song bpm.
 */
export function timingWindows(tempo: number): { perfect: number; ok: number } {
  const t = Math.max(25, Math.min(150, tempo || 100));
  const k = Math.max(0.8, Math.min(1.6, Math.sqrt(100 / t)));
  return { perfect: PERFECT_MS * k, ok: OK_MS * k };
}

export function computeStars(accuracy: number, timing: number, wrong = 0, total = 0): 0 | 1 | 2 | 3 {
  let s: 0 | 1 | 2 | 3 = accuracy >= 90 && timing >= 75 ? 3 : accuracy >= 75 ? 2 : accuracy >= 50 ? 1 : 0;
  // Anti-mash: more wrong notes than expected notes caps the rating at one star.
  if (total > 0 && wrong > total && s > 1) s = 1;
  return s;
}

// ---- Scorer ------------------------------------------------------------------

export interface ScorerOptions {
  tempo: number;
  wait: boolean;
}

export class Scorer {
  readonly notes: ExpectedNote[] = [];
  /** Parallel to notes: ST_* code. */
  readonly status: number[] = [];
  /** Parallel to notes: caller-supplied timestamp of the judgement (for render flashes). */
  readonly judgedAt: number[] = [];
  wrong = 0;
  private wrongByBar = new Map<number, number>();
  private lo = 0;
  private perfectMs: number;
  private okMs: number;
  private wait: boolean;
  private waitUsed: boolean;

  constructor(opts: ScorerOptions) {
    const w = timingWindows(opts.tempo);
    this.perfectMs = w.perfect;
    this.okMs = w.ok;
    this.wait = opts.wait;
    this.waitUsed = opts.wait;
  }

  get okWindowMs(): number {
    return this.okMs;
  }

  get isWait(): boolean {
    return this.wait;
  }

  /** Append notes. Each batch must start at or after the previous batch's last onset. */
  add(batch: ExpectedNote[]): void {
    const sorted = [...batch].sort((a, b) => a.beat - b.beat || a.midi - b.midi);
    for (const n of sorted) {
      this.notes.push(n);
      this.status.push(ST_PENDING);
      this.judgedAt.push(0);
    }
  }

  setTempo(tempo: number): void {
    const w = timingWindows(tempo);
    this.perfectMs = w.perfect;
    this.okMs = w.ok;
  }

  setWait(wait: boolean): void {
    this.wait = wait;
    if (wait) this.waitUsed = true;
  }

  /**
   * Judge one played note.
   * @param beat session beat at which it was played
   * @param spb  current seconds per beat
   * @param bar  song bar at that moment (for attributing wrong notes); optional
   * @param stamp timestamp stored in judgedAt for renderers
   */
  play(midi: number, beat: number, spb: number, bar = 0, stamp = 0): Judgement {
    const msPerBeat = spb * 1000;
    const okBeats = this.okMs / msPerBeat;
    const n = this.notes;
    let best = -1;

    if (this.wait) {
      // Earliest pending note of this pitch at or before the playhead (+ look-ahead).
      const ahead = Math.max(okBeats, 0.5);
      for (let i = this.lo; i < n.length && n[i].beat <= beat + ahead; i++) {
        if (this.status[i] === ST_PENDING && n[i].midi === midi) {
          best = i;
          break;
        }
      }
      if (best >= 0) {
        this.status[best] = ST_HIT;
        this.judgedAt[best] = stamp;
        this.bumpLo();
        return { kind: 'hit', index: best, deltaMs: 0 };
      }
    } else {
      let bestAbs = Infinity;
      for (let i = this.lo; i < n.length && n[i].beat <= beat + okBeats; i++) {
        if (this.status[i] !== ST_PENDING || n[i].midi !== midi) continue;
        const d = Math.abs(beat - n[i].beat);
        if (d <= okBeats && d < bestAbs) {
          bestAbs = d;
          best = i;
        }
      }
      if (best >= 0) {
        const deltaMs = (beat - n[best].beat) * msPerBeat;
        let st = ST_PERFECT;
        let kind: JudgementKind = 'perfect';
        if (Math.abs(deltaMs) > this.perfectMs) {
          st = deltaMs < 0 ? ST_EARLY : ST_LATE;
          kind = deltaMs < 0 ? 'early' : 'late';
        }
        this.status[best] = st;
        this.judgedAt[best] = stamp;
        this.bumpLo();
        return { kind, index: best, deltaMs };
      }
    }

    this.wrong++;
    if (bar > 0) this.wrongByBar.set(bar, (this.wrongByBar.get(bar) ?? 0) + 1);
    return { kind: 'wrong', index: -1, deltaMs: 0 };
  }

  /**
   * Mark notes whose ok window has fully passed as missed (no-op in wait mode).
   * Returns how many notes were newly missed.
   */
  advance(beat: number, spb: number, stamp = 0): number {
    if (this.wait) return 0;
    const okBeats = this.okMs / (spb * 1000);
    const n = this.notes;
    let count = 0;
    for (let i = this.lo; i < n.length && n[i].beat < beat - okBeats; i++) {
      if (this.status[i] === ST_PENDING) {
        this.status[i] = ST_MISSED;
        this.judgedAt[i] = stamp;
        count++;
      }
    }
    this.bumpLo();
    return count;
  }

  /** Exclude every still-pending note with onset before `beat` (used by seek). */
  skipBefore(beat: number): void {
    const n = this.notes;
    for (let i = this.lo; i < n.length && n[i].beat < beat; i++) {
      if (this.status[i] === ST_PENDING) this.status[i] = ST_SKIPPED;
    }
    this.bumpLo();
  }

  /** Index of the first note that is still pending, or -1. */
  firstPending(): number {
    for (let i = this.lo; i < this.notes.length; i++) if (this.status[i] === ST_PENDING) return i;
    return -1;
  }

  private bumpLo(): void {
    while (this.lo < this.status.length && this.status[this.lo] !== ST_PENDING) this.lo++;
  }

  /**
   * Final tally. Pending notes with onset <= endBeat count as missed; later ones were
   * never reached and are left out. Does not mutate state.
   */
  report(endBeat = Infinity): ScoreReport {
    let total = 0;
    let perfect = 0;
    let early = 0;
    let late = 0;
    let waitHits = 0;
    let missed = 0;
    const bars = new Map<number, BarStat>();
    const bar = (b: number): BarStat => {
      let s = bars.get(b);
      if (!s) bars.set(b, (s = { bar: b, total: 0, hit: 0, wrong: 0, accuracy: 0 }));
      return s;
    };

    for (let i = 0; i < this.notes.length; i++) {
      const st = this.status[i];
      if (st === ST_SKIPPED) continue;
      if (st === ST_PENDING && this.notes[i].beat > endBeat) continue;
      total++;
      const b = bar(this.notes[i].bar);
      b.total++;
      if (st === ST_PERFECT) perfect++;
      else if (st === ST_EARLY) early++;
      else if (st === ST_LATE) late++;
      else if (st === ST_HIT) waitHits++;
      else missed++;
      if (isHitStatus(st)) b.hit++;
    }
    this.wrongByBar.forEach((w, b) => (bar(b).wrong += w));

    const hits = perfect + early + late + waitHits;
    const accuracy = total ? Math.round((hits / total) * 100) : 0;
    const timedHits = perfect + early + late;
    let timing: number;
    if (this.waitUsed) timing = 100;
    else timing = timedHits ? Math.round(((perfect + 0.5 * (early + late)) / timedHits) * 100) : 0;

    const barList = [...bars.values()].sort((a, b) => a.bar - b.bar);
    for (const b of barList) {
      const denom = b.total + b.wrong;
      b.accuracy = denom ? Math.round((b.hit / denom) * 100) : 100;
    }

    return {
      notesTotal: total,
      notesHit: hits,
      // In wait mode every hit counts as "perfect" so counts still add up.
      perfect: perfect + waitHits,
      early,
      late,
      missed,
      wrong: this.wrong,
      accuracy,
      timing,
      stars: computeStars(accuracy, timing, this.wrong, total),
      wait: this.waitUsed,
      bars: barList,
    };
  }
}

// ---- Helpers -----------------------------------------------------------------

export const secondsPerBeat = (bpm: number, tempo: number): number => 60 / (bpm * (tempo / 100));

export const handMatches = (hand: Hand, hands: HandsMode): boolean => hands === 'both' || hand === hands;

export const barOfBeat = (beat: number, beatsPerBar: number): number => Math.floor(beat / beatsPerBar + 1e-6) + 1;

/**
 * Worst contiguous range of bars (up to `maxLen` long) by accuracy, for
 * "practise the tricky part". Null when nothing went wrong.
 */
export function findTrickyRange(bars: BarStat[], maxLen = 2): { from: number; to: number; accuracy: number } | null {
  const withNotes = bars.filter((b) => b.total > 0);
  if (!withNotes.length) return null;
  let best: { from: number; to: number; accuracy: number } | null = null;
  for (let i = 0; i < withNotes.length; i++) {
    let hit = 0;
    let denom = 0;
    for (let j = i; j < withNotes.length && withNotes[j].bar - withNotes[i].bar < maxLen; j++) {
      hit += withNotes[j].hit;
      denom += withNotes[j].total + withNotes[j].wrong;
      const acc = denom ? Math.round((hit / denom) * 100) : 100;
      const len = withNotes[j].bar - withNotes[i].bar + 1;
      // Prefer the full window length so loops are musically meaningful.
      if (len === Math.min(maxLen, withNotes[withNotes.length - 1].bar - withNotes[0].bar + 1) || j === i) {
        if (!best || acc < best.accuracy) best = { from: withNotes[i].bar, to: withNotes[j].bar, accuracy: acc };
      }
    }
  }
  return best && best.accuracy < 100 ? best : null;
}

/** Bars below `threshold` accuracy, worst first. */
export function trickyBars(bars: BarStat[], threshold = 80, limit = 3): BarStat[] {
  return bars
    .filter((b) => b.total > 0 && b.accuracy < threshold)
    .sort((a, b) => a.accuracy - b.accuracy || a.bar - b.bar)
    .slice(0, limit);
}

// ---- One-shot convenience (used by tests and offline analysis) ----------------

export interface PerformanceInput {
  /** The level's notes (all hands; filtered here by `hands`). */
  notes: NoteEvent[];
  hands: HandsMode;
  bpm: number;
  beatsPerBar: number;
  /** % of bpm. */
  tempo: number;
  wait: boolean;
  /** Played notes; `time` in ms since beat 0 of the song at this tempo. */
  played: { midi: number; time: number }[];
  /** Session end in ms; pending notes after it are "not reached". Default: everything counts. */
  endTime?: number;
}

export function scorePerformance(input: PerformanceInput): ScoreReport {
  const spb = secondsPerBeat(input.bpm, input.tempo);
  const scorer = new Scorer({ tempo: input.tempo, wait: input.wait });
  scorer.add(
    input.notes
      .filter((n) => handMatches(n.hand, input.hands))
      .map((n) => ({ midi: n.midi, beat: n.start, dur: n.dur, hand: n.hand, bar: barOfBeat(n.start, input.beatsPerBar) })),
  );
  const played = [...input.played].sort((a, b) => a.time - b.time);
  for (const p of played) {
    const beat = p.time / 1000 / spb;
    scorer.advance(beat, spb);
    scorer.play(p.midi, beat, spb, barOfBeat(Math.max(0, beat), input.beatsPerBar));
  }
  const endBeat = input.endTime == null ? Infinity : input.endTime / 1000 / spb;
  if (endBeat !== Infinity) scorer.advance(endBeat, spb);
  return scorer.report(endBeat);
}
