import { describe, expect, it } from 'vitest';
import { NOTATION_ERRORS, SONGS, getSong } from '../src/songs';
import { parse, simplify } from '../src/songs/notation';
import type { Level } from '../src/core/types';

const LEVELS: Level[] = ['easy', 'medium', 'hard'];

describe('song notation', () => {
  it('parses notes, chords, rests and fractional durations', () => {
    const { notes, end } = parse('C4 D4:0.5 R:0.5 C3+E3+G3:2 |', 'R', 4);
    expect(end).toBe(4);
    expect(notes.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [60, 0, 1],
      [62, 1, 0.5],
      [48, 2, 2],
      [52, 2, 2],
      [55, 2, 2],
    ]);
  });

  it('simplifies dotted rhythms and eighth pairs', () => {
    const { notes } = parse('E4:1.5 D4:0.5 C4:0.5 D4:0.5 E4', 'R', 4);
    const s = simplify(notes, { evenDotted: true, mergeEighths: true });
    expect(s.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [64, 0, 1],
      [62, 1, 1],
      [60, 2, 1],
      [64, 3, 1],
    ]);
  });

  it('has no transcription errors (bar lengths, chords, melody vs harmony length)', () => {
    expect(NOTATION_ERRORS).toEqual([]);
  });
});

describe('song library', () => {
  it('has at least 10 songs with unique ids', () => {
    expect(SONGS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(SONGS.length);
    expect(getSong(SONGS[0].id)).toBe(SONGS[0]);
    expect(getSong('nope')).toBeUndefined();
  });

  for (const song of SONGS) {
    describe(song.title, () => {
      it('has metadata', () => {
        expect(song.bpm).toBeGreaterThan(0);
        expect(song.beatsPerBar).toBeGreaterThan(0);
        expect(song.tags.length).toBeGreaterThan(0);
      });

      for (const level of LEVELS) {
        it(`${level}: valid notes`, () => {
          const notes = song.levels[level];
          expect(notes.length).toBeGreaterThan(0);
          for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            if (i > 0) expect(n.start).toBeGreaterThanOrEqual(notes[i - 1].start);
            expect(Number.isInteger(n.midi)).toBe(true);
            expect(n.midi).toBeGreaterThanOrEqual(21);
            expect(n.midi).toBeLessThanOrEqual(108);
            expect(n.dur).toBeGreaterThan(0);
            expect(n.start).toBeGreaterThanOrEqual(0);
            expect(['L', 'R']).toContain(n.hand);
          }
        });
      }

      it('easy is right hand only, medium and hard use both hands', () => {
        expect(song.levels.easy.every((n) => n.hand === 'R')).toBe(true);
        expect(song.levels.medium.some((n) => n.hand === 'L')).toBe(true);
        expect(song.levels.hard.some((n) => n.hand === 'L')).toBe(true);
      });

      it('medium left hand is single notes around C3–B3', () => {
        const left = song.levels.medium.filter((n) => n.hand === 'L');
        expect(left.every((n) => n.midi >= 48 && n.midi <= 59)).toBe(true);
        const starts = left.map((n) => n.start);
        expect(new Set(starts).size).toBe(starts.length);
      });
    });
  }
});
