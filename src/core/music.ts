/** Pure music-theory helpers. No DOM, no audio — safe to unit test. */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

const BLACK = new Set([1, 3, 6, 8, 10]);

export const isBlack = (midi: number): boolean => BLACK.has(((midi % 12) + 12) % 12);

export const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;

/** 60 -> "C4" */
export function midiToName(midi: number, flats = false): string {
  const names = flats ? FLAT_NAMES : NOTE_NAMES;
  return `${names[pitchClass(midi)]}${Math.floor(midi / 12) - 1}`;
}

/** "C4" / "Db3" / "F#5" -> midi number, or NaN. */
export function nameToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) return NaN;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as 'C'];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

export const midiToFreq = (midi: number, a4 = 440): number => a4 * 2 ** ((midi - 69) / 12);

/** Fractional midi number for a frequency (69.0 = A4). */
export const freqToMidi = (freq: number, a4 = 440): number => 69 + 12 * Math.log2(freq / a4);

/** Cents off the nearest equal-tempered note. */
export function centsOff(freq: number, a4 = 440): { midi: number; cents: number } {
  const exact = freqToMidi(freq, a4);
  const midi = Math.round(exact);
  return { midi, cents: Math.round((exact - midi) * 100) };
}

/** Chord qualities as semitone intervals from the root. */
export const CHORD_QUALITIES: Record<string, { label: string; intervals: number[] }> = {
  maj: { label: 'Major', intervals: [0, 4, 7] },
  min: { label: 'Minor', intervals: [0, 3, 7] },
  dim: { label: 'Diminished', intervals: [0, 3, 6] },
  aug: { label: 'Augmented', intervals: [0, 4, 8] },
  sus2: { label: 'Sus2', intervals: [0, 2, 7] },
  sus4: { label: 'Sus4', intervals: [0, 5, 7] },
  '7': { label: 'Dominant 7', intervals: [0, 4, 7, 10] },
  maj7: { label: 'Major 7', intervals: [0, 4, 7, 11] },
  min7: { label: 'Minor 7', intervals: [0, 3, 7, 10] },
  m7b5: { label: 'Half-dim 7', intervals: [0, 3, 6, 10] },
  dim7: { label: 'Diminished 7', intervals: [0, 3, 6, 9] },
  add9: { label: 'Add 9', intervals: [0, 4, 7, 14] },
};

/** Build a chord's midi notes; inversion 0 = root position. */
export function chordNotes(rootMidi: number, quality: string, inversion = 0): number[] {
  const q = CHORD_QUALITIES[quality];
  if (!q) return [];
  const notes = q.intervals.map((i) => rootMidi + i);
  for (let i = 0; i < inversion % notes.length; i++) {
    const n = notes.shift()!;
    notes.push(n + 12);
  }
  return notes;
}

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
