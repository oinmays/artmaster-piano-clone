/**
 * Compact song notation, so the song data stays readable and checkable.
 *
 * Melody / free notation (one hand):
 *   "E4:1 E4 F4 G4 | G4:2 R:2 | C3+E3+G3:4"
 *   - `NAME[:dur]`   a note, e.g. `F#4:0.5`, `Bb3:1.5`, `G4:1/3`. Duration in beats, default 1.
 *   - `A+B+C[:dur]`  a chord (all notes start together).
 *   - `R[:dur]`      a rest.
 *   - `|`            a bar line. Each bar line is checked: it must fall exactly on a bar
 *                    boundary after the previous one, so a wrong duration is caught
 *                    (see NOTATION_ERRORS). A note held across bars closes several bars.
 *
 * Harmony (one chord symbol per span, same bar-line rules):
 *   "C:4 | F:2 C:2 | G7:4 | R:3"   qualities: (none) major, m, 7, m7, maj7, dim, aug, sus2, sus4
 *
 * Harmony is turned into left-hand parts: single roots (medium) or patterns (hard).
 */
import { CHORD_QUALITIES, nameToMidi, pitchClass } from '../core/music';
import type { Hand, NoteEvent } from '../core/types';

/** Problems found while parsing song data. Tests assert this stays empty. */
export const NOTATION_ERRORS: string[] = [];

const EPS = 1e-6;

function fail(label: string, msg: string): void {
  NOTATION_ERRORS.push(`${label}: ${msg}`);
}

function parseDur(s: string | undefined): number {
  if (s === undefined || s === '') return 1;
  if (s.includes('/')) {
    const [a, b] = s.split('/');
    return Number(a) / Number(b);
  }
  return Number(s);
}

interface Token {
  head: string;
  dur: number;
}

/** Walk tokens, checking bar lines. Calls `each` with the start time of every non-bar token. */
function walk(
  src: string,
  beatsPerBar: number,
  label: string,
  each: (tok: Token, start: number) => void,
): number {
  let t = 0;
  let bars = 0;
  for (const raw of src.trim().split(/\s+/)) {
    if (!raw) continue;
    if (raw === '|') {
      // A note may be held across several bars, so one `|` can close more than one bar.
      const at = Math.round(t / beatsPerBar);
      if (Math.abs(t - at * beatsPerBar) > EPS || at <= bars) {
        fail(label, `bar line after bar ${bars} falls on beat ${t}, not on a bar boundary`);
        bars++;
        t = bars * beatsPerBar; // resync so one error doesn't cascade
      } else {
        bars = at;
      }
      continue;
    }
    const [head, d] = raw.split(':');
    const dur = parseDur(d);
    if (!(dur > 0) || !Number.isFinite(dur)) {
      fail(label, `bad duration in "${raw}"`);
      continue;
    }
    each({ head, dur }, t);
    t += dur;
  }
  return t;
}

export interface Parsed {
  notes: NoteEvent[];
  /** Total length in beats, including trailing rests. */
  end: number;
}

export function parse(src: string, hand: Hand, beatsPerBar: number, label = 'notation'): Parsed {
  const notes: NoteEvent[] = [];
  const end = walk(src, beatsPerBar, label, ({ head, dur }, start) => {
    if (head === 'R' || head === 'r') return;
    for (const name of head.split('+')) {
      const midi = nameToMidi(name);
      if (Number.isNaN(midi)) fail(label, `bad note "${name}"`);
      else notes.push({ midi, start, dur, hand });
    }
  });
  return { notes: sortNotes(notes), end };
}

// ---- Harmony -----------------------------------------------------------------

export interface ChordSpan {
  /** Pitch class of the root, or -1 for a rest. */
  root: number;
  quality: string;
  start: number;
  dur: number;
}

const QUALITY_ALIASES: Record<string, string> = {
  '': 'maj',
  m: 'min',
  '7': '7',
  m7: 'min7',
  maj7: 'maj7',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
};

export function parseHarmony(src: string, beatsPerBar: number, label = 'harmony'): { spans: ChordSpan[]; end: number } {
  const spans: ChordSpan[] = [];
  const end = walk(src, beatsPerBar, label, ({ head, dur }, start) => {
    if (head === 'R') {
      spans.push({ root: -1, quality: 'maj', start, dur });
      return;
    }
    const m = /^([A-G][#b]?)(.*)$/.exec(head);
    const quality = m ? QUALITY_ALIASES[m[2]] : undefined;
    if (!m || !quality) {
      fail(label, `bad chord "${head}"`);
      return;
    }
    spans.push({ root: pitchClass(nameToMidi(`${m[1]}4`)), quality, start, dur });
  });
  return { spans, end };
}

/** Close triad voicing for the left hand, kept roughly between A2 and C4. */
export function voicing(root: number, quality: string): number[] {
  const iv = (CHORD_QUALITIES[quality] ?? CHORD_QUALITIES.maj).intervals.slice(0, 3);
  let best: number[] = iv.map((i) => 48 + root + i);
  let bestScore = Infinity;
  for (const base of [36 + root, 48 + root]) {
    for (let inv = 0; inv < 3; inv++) {
      const notes = iv.map((i, k) => base + i + (k < inv ? 12 : 0)).sort((a, b) => a - b);
      if (notes[2] > 60 || notes[0] < 45) continue;
      const mean = (notes[0] + notes[1] + notes[2]) / 3;
      const score = Math.abs(mean - 53);
      if (score < bestScore) {
        bestScore = score;
        best = notes;
      }
    }
  }
  return best;
}

/** Medium level: one root note per chord change, in C3–B3. */
export function roots(spans: ChordSpan[]): NoteEvent[] {
  return spans
    .filter((s) => s.root >= 0)
    .map((s) => ({ midi: 48 + s.root, start: s.start, dur: s.dur, hand: 'L' as const }));
}

/**
 * A left-hand pattern. Each step plays the listed voices, then advances `step` beats;
 * the pattern restarts at each chord change. Voice 0 = bass root (C2–B2), 1–3 = the triad
 * from low to high. `step: 0` holds the step for the whole chord.
 */
export interface Pattern {
  step: number;
  steps: number[][];
}

export const PATTERNS = {
  /** Held block chords. */
  block: { step: 0, steps: [[1, 2, 3]] },
  /** Bass, chord, bass, chord (4/4 "oom-pah"). */
  pulse: { step: 1, steps: [[0], [1, 2, 3]] },
  /** Bass then two chords (3/4). */
  waltz: { step: 1, steps: [[0], [1, 2, 3], [1, 2, 3]] },
  /** Bass then two broken chord tones (3/4). */
  waltzArp: { step: 1, steps: [[0], [2], [3]] },
  /** Low-high-middle-high in eighths. */
  alberti: { step: 0.5, steps: [[1], [3], [2], [3]] },
  /** Rising arpeggio in eighths from the bass. */
  arp8: { step: 0.5, steps: [[0], [1], [2], [3]] },
} satisfies Record<string, Pattern>;

export type PatternName = keyof typeof PATTERNS;

export function accompany(spans: ChordSpan[], pattern: Pattern): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const s of spans) {
    if (s.root < 0) continue;
    const triad = voicing(s.root, s.quality);
    const voices = [36 + s.root, ...triad];
    const end = s.start + s.dur;
    const step = pattern.step > 0 ? pattern.step : s.dur;
    for (let i = 0, t = s.start; t < end - EPS; i++, t += step) {
      const dur = Math.min(step, end - t);
      for (const v of pattern.steps[i % pattern.steps.length]) {
        out.push({ midi: voices[v], start: t, dur, hand: 'L' });
      }
    }
  }
  return out;
}

// ---- Combining and simplifying ------------------------------------------------

export function sortNotes(notes: NoteEvent[]): NoteEvent[] {
  return notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/** Merge right and left hand, dropping left-hand notes that would double a sounding right-hand note. */
export function combine(right: NoteEvent[], left: NoteEvent[]): NoteEvent[] {
  const kept = left.filter(
    (l) => !right.some((r) => r.midi === l.midi && r.start < l.start + l.dur - EPS && l.start < r.start + r.dur - EPS),
  );
  return sortNotes([...right.map((n) => ({ ...n })), ...kept]);
}

export interface SimplifyOptions {
  /** Dotted-quarter + eighth pairs become two quarters. */
  evenDotted?: boolean;
  /** Pairs of eighths that start on a beat become one quarter (the second note is dropped). */
  mergeEighths?: boolean;
}

/** Simplify a right-hand melody for the easy level. Input must be a single, monophonic line. */
export function simplify(notes: NoteEvent[], opts: SimplifyOptions): NoteEvent[] {
  const src = sortNotes(notes.map((n) => ({ ...n })));
  const out: NoteEvent[] = [];
  for (let i = 0; i < src.length; i++) {
    const a = src[i];
    const b = src[i + 1];
    const onBeat = Math.abs(a.start - Math.round(a.start)) < EPS;
    if (
      opts.evenDotted &&
      b &&
      onBeat &&
      Math.abs(a.dur - 1.5) < EPS &&
      Math.abs(b.dur - 0.5) < EPS &&
      Math.abs(b.start - (a.start + 1.5)) < EPS
    ) {
      out.push({ ...a, dur: 1 }, { ...b, start: a.start + 1, dur: 1 });
      i++;
      continue;
    }
    if (
      opts.mergeEighths &&
      b &&
      onBeat &&
      Math.abs(a.dur - 0.5) < EPS &&
      Math.abs(b.dur - 0.5) < EPS &&
      Math.abs(b.start - (a.start + 0.5)) < EPS
    ) {
      out.push({ ...a, dur: 1 });
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** Length of a note list in beats (end of the last note). */
export function lengthBeats(notes: NoteEvent[]): number {
  return notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
}
