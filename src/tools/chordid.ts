/**
 * Chord naming, spelling and identification for the Chord Finder.
 * Pure: no DOM, no audio.
 */
import { CHORD_QUALITIES } from '../core/music';

/** Preferred spelling for each root pitch class (C..B). */
export const ROOT_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** Chip labels showing both spellings for black keys. */
export const ROOT_LABELS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'] as const;

/** Chord-symbol suffix per quality key in CHORD_QUALITIES. */
export const QUALITY_SUFFIX: Record<string, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  '7': '7',
  maj7: 'maj7',
  min7: 'm7',
  m7b5: 'm7b5',
  dim7: 'dim7',
  add9: 'add9',
};

/** Semitones from the root -> [degree label, letter steps above the root letter]. */
const DEGREES: Record<number, [string, number]> = {
  0: ['1', 0],
  2: ['2', 1],
  3: ['b3', 2],
  4: ['3', 2],
  5: ['4', 3],
  6: ['b5', 4],
  7: ['5', 4],
  8: ['#5', 4],
  9: ['bb7', 6],
  10: ['b7', 6],
  11: ['7', 6],
  14: ['9', 1],
};

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Root pitch class + quality -> "C", "F#m", "Bbmaj7". */
export function chordName(rootPc: number, quality: string): string {
  return ROOT_NAMES[mod12(rootPc)] + (QUALITY_SUFFIX[quality] ?? quality);
}

/** Degree formula, e.g. maj7 -> "1-3-5-7", dim7 -> "1-b3-b5-bb7". */
export function chordFormula(quality: string): string {
  const q = CHORD_QUALITIES[quality];
  if (!q) return '';
  return q.intervals.map((i) => DEGREES[i]?.[0] ?? String(i)).join('-');
}

/** Spell a note `interval` semitones above a root name, using correct letters (Eb, not D#, in C minor). */
export function spellInterval(rootName: string, interval: number): string {
  const letterIdx = LETTERS.indexOf(rootName[0]);
  const rootAcc = rootName.slice(1) === '#' ? 1 : rootName.slice(1) === 'b' ? -1 : 0;
  const rootPc = LETTER_PC[letterIdx] + rootAcc;
  const steps = DEGREES[interval]?.[1];
  if (letterIdx < 0 || steps == null) return ROOT_NAMES[mod12(rootPc + interval)];
  const li = (letterIdx + steps) % 7;
  let diff = mod12(rootPc + interval - LETTER_PC[li]);
  if (diff > 6) diff -= 12;
  const acc = diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff);
  return LETTERS[li] + acc;
}

/** Spelled note names of a chord in root position, e.g. (0,'min') -> ["C","Eb","G"]. */
export function chordNoteNames(rootPc: number, quality: string): string[] {
  const q = CHORD_QUALITIES[quality];
  if (!q) return [];
  const root = ROOT_NAMES[mod12(rootPc)];
  return q.intervals.map((i) => spellInterval(root, i));
}

export interface ChordMatch {
  rootPc: number;
  quality: string;
  /** Symbol including slash bass when inverted, e.g. "C/E". */
  name: string;
  /** Plain symbol without bass, e.g. "C". */
  symbol: string;
  /** 0 = root position, 1 = first inversion… (by the lowest selected note). */
  inversion: number;
}

/**
 * Name the chord(s) whose pitch classes exactly equal the given notes' pitch classes.
 * Any voicing or inversion. Symmetric chords (aug, dim7) return several matches.
 * Root-position matches come first, then by quality order in CHORD_QUALITIES.
 */
export function identifyChord(midis: number[]): ChordMatch[] {
  if (midis.length === 0) return [];
  const pcs = new Set(midis.map(mod12));
  if (pcs.size < 3) return [];
  const bassPc = mod12(Math.min(...midis));
  const out: ChordMatch[] = [];
  const keys = Object.keys(CHORD_QUALITIES);
  for (const quality of keys) {
    const ivs = CHORD_QUALITIES[quality].intervals;
    const qpcs = new Set(ivs.map(mod12));
    if (qpcs.size !== pcs.size) continue;
    for (let root = 0; root < 12; root++) {
      if (![...qpcs].every((i) => pcs.has(mod12(root + i)))) continue;
      const bassInterval = mod12(bassPc - root);
      const inversion = ivs.findIndex((i) => mod12(i) === bassInterval);
      const symbol = chordName(root, quality);
      const bassName = inversion > 0 ? spellInterval(ROOT_NAMES[root], ivs[inversion]) : '';
      out.push({ rootPc: root, quality, symbol, name: inversion > 0 ? `${symbol}/${bassName}` : symbol, inversion });
    }
  }
  const order = (q: string) => keys.indexOf(q);
  return out.sort(
    (a, b) => (a.inversion === 0 ? 0 : 1) - (b.inversion === 0 ? 0 : 1) || order(a.quality) - order(b.quality),
  );
}
