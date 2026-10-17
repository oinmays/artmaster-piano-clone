import { describe, expect, it } from 'vitest';
import { assignFingering } from '../src/player/fingering';
import type { Hand, NoteEvent } from '../src/core/types';
import { CATALOG } from '../src/songs/catalog';

const run = (midis: number[], hand: Hand = 'R'): NoteEvent[] =>
  midis.map((midi, i) => ({ midi, start: i, dur: 1, hand }));

describe('auto-fingering', () => {
  it('fingers a C-major five-finger melody 1-2-3-4-5', () => {
    expect(assignFingering(run([60, 62, 64, 65, 67]))).toEqual([1, 2, 3, 4, 5]);
    expect(assignFingering(run([67, 65, 64, 62, 60]))).toEqual([5, 4, 3, 2, 1]);
  });

  it('crosses the thumb under in a one-octave scale', () => {
    const up = assignFingering(run([60, 62, 64, 65, 67, 69, 71, 72]));
    expect(up).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
    const down = assignFingering(run([72, 71, 69, 67, 65, 64, 62, 60]));
    expect(down).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });

  it('mirrors the left hand', () => {
    expect(assignFingering(run([53, 55, 57, 59, 60], 'L'))).toEqual([5, 4, 3, 2, 1]);
    expect(assignFingering(run([48, 50, 52, 53, 55, 57, 59, 60], 'L'))).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });

  it('treats a big leap as a hand shift, not a stretch', () => {
    // LH bass C2, then a C3-E3-G3 arpeggio: the arpeggio still gets 5-3-1.
    expect(assignFingering(run([36, 48, 52, 55], 'L'))).toEqual([5, 5, 3, 1]);
  });

  it('spreads chords across the fingers by interval', () => {
    const triad = (hand: Hand, base: number): NoteEvent[] =>
      [0, 4, 7].map((d) => ({ midi: base + d, start: 0, dur: 1, hand }));
    expect(assignFingering(triad('R', 60))).toEqual([1, 3, 5]);
    expect(assignFingering(triad('L', 48))).toEqual([5, 3, 1]);
    const octave: NoteEvent[] = [36, 48].map((midi) => ({ midi, start: 0, dur: 1, hand: 'L' }));
    expect(assignFingering(octave)).toEqual([5, 1]);
  });

  it('fingers each hand on its own and keeps the input order', () => {
    const both: NoteEvent[] = [...run([60, 62, 64]), ...run([48, 47, 45], 'L')];
    expect(assignFingering(both)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it('keeps the thumb off black keys in a simple melody', () => {
    const f = assignFingering(run([62, 66, 69, 66, 62])); // D F# A F# D
    expect(f[1]).not.toBe(1);
    expect(f[3]).not.toBe(1);
  });

  it('honours a finger given on the note', () => {
    const notes = run([60, 62, 64]);
    notes[0].finger = 2;
    const f = assignFingering(notes);
    expect(f[0]).toBe(2);
    expect(f.slice(1)).toEqual([3, 4]);
  });

  it('always returns 1–5 for every note of every catalogue song', () => {
    for (const song of CATALOG) {
      for (const notes of Object.values(song.levels)) {
        const f = assignFingering(notes);
        expect(f).toHaveLength(notes.length);
        for (const x of f) expect([1, 2, 3, 4, 5]).toContain(x);
      }
    }
  });

  it('copes with chords wider than five notes', () => {
    const big: NoteEvent[] = [48, 52, 55, 60, 64, 67].map((midi) => ({ midi, start: 0, dur: 1, hand: 'R' }));
    const f = assignFingering(big);
    expect(f).toHaveLength(6);
    for (const x of f) expect(x).toBeGreaterThanOrEqual(1);
  });
});
