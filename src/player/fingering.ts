/**
 * Automatic piano fingering (1 = thumb … 5 = little finger), per hand. Pure, no DOM.
 *
 * A small Viterbi search over each hand's onsets. Every onset (a single note, or the notes of
 * one hand that start together) gets a few candidate finger assignments; the cheapest path
 * through them wins. Costs are a simplified ergonomic model:
 * - neighbouring fingers like to be about a white-key step apart (2 semitones per finger);
 * - a stretch beyond what the pair can comfortably reach, or a cramped one, costs extra;
 * - crossings are only cheap the classic way: thumb under going up, finger over the thumb
 *   going down (mirrored for the left hand);
 * - the thumb (and, a little, the little finger) avoids black keys; the weak ring finger costs a touch more;
 * - a leap wider than LEAP is a hand shift, so any finger may land it.
 *
 * It is deterministic and works for any NoteEvent list, including imported MIDI with no
 * fingering. A `finger` on a NoteEvent is kept as given and the rest is fitted around it.
 * It is a heuristic, not a teacher's edition.
 */
import { isBlack } from '../core/music';
import type { Finger, Hand, NoteEvent } from '../core/types';

const FINGERS: Finger[] = [1, 2, 3, 4, 5];
const EPS = 1e-6;
/** Wider than this (semitones) between consecutive notes counts as a hand shift, not a stretch. */
const LEAP = 9;

/** Cost of moving from (m1, f1) to (m2, f2) in the right hand. The left hand mirrors pitch. */
function moveCost(m1: number, f1: Finger, m2: number, f2: Finger, hand: Hand): number {
  const d = hand === 'R' ? m2 - m1 : m1 - m2;
  let c = 0;
  if (Math.abs(d) > LEAP) {
    // Beyond any comfortable reach the hand moves anyway: any finger can land the leap, with a
    // slight preference for leaving from, and landing on, the hand's edge in the direction of travel.
    const edge = d > 0 ? f1 - 1 + (5 - f2) : 5 - f1 + (f2 - 1);
    c = 3 + Math.abs(d) * 0.05 + edge * 0.1;
  } else if (f1 === f2) {
    c = d === 0 ? 0 : 6 + Math.abs(d);
  } else if (d === 0) {
    c = 1;
  } else if ((f2 > f1 && d > 0) || (f2 < f1 && d < 0)) {
    c = spanCost(Math.min(f1, f2), Math.max(f1, f2), Math.abs(d));
  } else if (d > 0 && f2 === 1 && f1 <= 4) {
    // Thumb under, going up. Best right after 3 or 4, over a short gap.
    c = 2 + (f1 === 2 ? 1 : f1 === 4 ? 0.5 : 0) + Math.max(0, d - 1) * 0.5 + (d > 5 ? (d - 5) * 2 : 0);
  } else if (d < 0 && f1 === 1 && f2 <= 4) {
    // Finger over the thumb, going down.
    c = 2 + (f2 === 2 ? 1 : f2 === 4 ? 0.5 : 0) + Math.max(0, -d - 1) * 0.5 + (-d > 5 ? (-d - 5) * 2 : 0);
  } else {
    c = 10 + Math.abs(d);
  }
  return c + keyCost(m2, f2);
}

/** Cost of fingers lo < hi playing notes `d` semitones apart (lo on the lower-thumb side). */
function spanCost(lo: number, hi: number, d: number): number {
  const steps = hi - lo;
  const natural = 2 * steps;
  const max = lo === 1 ? natural + 3 : natural;
  const min = steps;
  return Math.abs(d - natural) * 0.3 + Math.max(0, d - max) * 2 + Math.max(0, min - d) * 2;
}

/** Per-note cost: the thumb (and a little, the little finger) avoids black keys; the ring finger is the weakest. */
function keyCost(midi: number, f: Finger): number {
  const weak = f === 4 ? 0.2 : 0;
  if (!isBlack(midi)) return weak;
  return weak + (f === 1 ? 3 : f === 5 ? 1 : 0);
}

interface Onset {
  /** Indexes into the input array, sorted by pitch (low to high). */
  idx: number[];
  midi: number[];
}

/** Candidate assignments for one onset: fingers per note (same order as onset.midi). */
function candidates(o: Onset, hand: Hand, fixed: (Finger | undefined)[]): Finger[][] {
  const k = o.midi.length;
  let out: Finger[][] = [];
  if (k === 1) out = FINGERS.map((f) => [f]);
  else if (k > 5) {
    // More notes than fingers: spread them evenly, best effort.
    const spread = o.midi.map((_, i) => (1 + Math.round((i * 4) / (k - 1))) as Finger);
    out = [hand === 'R' ? spread : spread.slice().reverse()];
  } else {
    // Strictly increasing fingers from the low note up (RH), decreasing for the LH.
    const pick = (start: number, acc: Finger[]) => {
      if (acc.length === k) {
        out.push(hand === 'R' ? acc.slice() : acc.slice().reverse());
        return;
      }
      for (let f = start; f <= 5 - (k - acc.length - 1); f++) {
        acc.push(f as Finger);
        pick(f + 1, acc);
        acc.pop();
      }
    };
    pick(1, []);
  }
  const constrained = out.filter((a) => a.every((f, i) => fixed[i] == null || fixed[i] === f));
  if (constrained.length) return constrained;
  // An override no candidate satisfies: honour it note by note on top of the first candidate.
  return [out[0].map((f, i) => fixed[i] ?? f)];
}

/** Cost of holding one assignment as a chord. */
function chordCost(o: Onset, a: Finger[]): number {
  let c = 0;
  for (let i = 0; i < o.midi.length; i++) {
    c += keyCost(o.midi[i], a[i]);
    if (i > 0) {
      const d = o.midi[i] - o.midi[i - 1];
      const lo = Math.min(a[i], a[i - 1]);
      const hi = Math.max(a[i], a[i - 1]);
      c += hi === lo ? 10 : spanCost(lo, hi, d);
    }
  }
  // Wide chords (a fifth or more, three notes or more) sit best with thumb and little finger outside.
  const k = o.midi.length;
  if (k >= 3 && o.midi[k - 1] - o.midi[0] >= 7) {
    if (Math.min(a[0], a[k - 1]) !== 1) c += 0.5;
    if (Math.max(a[0], a[k - 1]) !== 5) c += 0.5;
  }
  return c;
}

/** Cost between consecutive onsets: each new note is compared with the old note on the nearest finger. */
function transCost(p: Onset, pa: Finger[], q: Onset, qa: Finger[], hand: Hand): number {
  let c = 0;
  for (let j = 0; j < q.midi.length; j++) {
    let best = 0;
    for (let i = 1; i < pa.length; i++) {
      if (Math.abs(pa[i] - qa[j]) < Math.abs(pa[best] - qa[j])) best = i;
    }
    c += moveCost(p.midi[best], pa[best], q.midi[j], qa[j], hand) - keyCost(q.midi[j], qa[j]);
  }
  return c / q.midi.length;
}

function fingerHand(notes: NoteEvent[], idx: number[], hand: Hand, out: Finger[]): void {
  const sorted = idx.slice().sort((a, b) => notes[a].start - notes[b].start || notes[a].midi - notes[b].midi || a - b);
  const onsets: Onset[] = [];
  for (const i of sorted) {
    const last = onsets[onsets.length - 1];
    if (last && Math.abs(notes[last.idx[0]].start - notes[i].start) < EPS) {
      if (last.midi.includes(notes[i].midi)) continue; // duplicate pitch: copied below
      last.idx.push(i);
      last.midi.push(notes[i].midi);
    } else onsets.push({ idx: [i], midi: [notes[i].midi] });
  }
  if (!onsets.length) return;

  const cands = onsets.map((o) => candidates(o, hand, o.idx.map((i) => notes[i].finger)));
  // Viterbi.
  let cost = cands[0].map((a) => chordCost(onsets[0], a));
  const back: number[][] = [cost.map(() => -1)];
  for (let t = 1; t < onsets.length; t++) {
    const next: number[] = [];
    const ptr: number[] = [];
    for (let j = 0; j < cands[t].length; j++) {
      const own = chordCost(onsets[t], cands[t][j]);
      let best = Infinity;
      let arg = 0;
      for (let i = 0; i < cands[t - 1].length; i++) {
        const c = cost[i] + transCost(onsets[t - 1], cands[t - 1][i], onsets[t], cands[t][j], hand);
        if (c < best - EPS) {
          best = c;
          arg = i;
        }
      }
      next.push(best + own);
      ptr.push(arg);
    }
    cost = next;
    back.push(ptr);
  }
  let j = 0;
  for (let k = 1; k < cost.length; k++) if (cost[k] < cost[j] - EPS) j = k;
  for (let t = onsets.length - 1; t >= 0; t--) {
    const a = cands[t][j];
    onsets[t].idx.forEach((i, n) => (out[i] = a[n]));
    j = back[t][j];
  }
  // Duplicate pitches in one onset share the finger of the first.
  for (const i of sorted) {
    if (out[i]) continue;
    const twin = sorted.find((k) => out[k] && notes[k].midi === notes[i].midi && Math.abs(notes[k].start - notes[i].start) < EPS);
    out[i] = twin != null ? out[twin] : 1;
  }
}

/** Fingers for every note, in input order. Each hand is fingered on its own. */
export function assignFingering(notes: readonly NoteEvent[]): Finger[] {
  const out: Finger[] = new Array(notes.length).fill(0);
  const list = notes as NoteEvent[];
  for (const hand of ['L', 'R'] as Hand[]) {
    const idx: number[] = [];
    list.forEach((n, i) => n.hand === hand && idx.push(i));
    fingerHand(list, idx, hand, out);
  }
  return out;
}
