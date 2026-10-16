import { describe, expect, it } from 'vitest';
import { chordFormula, chordName, chordNoteNames, identifyChord, spellInterval } from '../src/tools/chordid';

const names = (midis: number[]) => identifyChord(midis).map((m) => m.name);

describe('chord naming', () => {
  it('builds symbols', () => {
    expect(chordName(0, 'maj')).toBe('C');
    expect(chordName(6, 'min')).toBe('F#m');
    expect(chordName(0, 'maj7')).toBe('Cmaj7');
    expect(chordName(10, 'min7')).toBe('Bbm7');
    expect(chordName(11, 'm7b5')).toBe('Bm7b5');
  });

  it('gives degree formulas', () => {
    expect(chordFormula('maj')).toBe('1-3-5');
    expect(chordFormula('maj7')).toBe('1-3-5-7');
    expect(chordFormula('min7')).toBe('1-b3-5-b7');
    expect(chordFormula('dim7')).toBe('1-b3-b5-bb7');
    expect(chordFormula('aug')).toBe('1-3-#5');
    expect(chordFormula('add9')).toBe('1-3-5-9');
  });

  it('spells notes with the right letters', () => {
    expect(chordNoteNames(0, 'min')).toEqual(['C', 'Eb', 'G']);
    expect(chordNoteNames(6, 'maj')).toEqual(['F#', 'A#', 'C#']);
    expect(chordNoteNames(5, 'maj')).toEqual(['F', 'A', 'C']);
    expect(chordNoteNames(10, '7')).toEqual(['Bb', 'D', 'F', 'Ab']);
    expect(chordNoteNames(0, 'dim7')).toEqual(['C', 'Eb', 'Gb', 'Bbb']);
    expect(chordNoteNames(4, 'aug')).toEqual(['E', 'G#', 'B#']);
    expect(chordNoteNames(2, 'add9')).toEqual(['D', 'F#', 'A', 'E']);
    expect(spellInterval('Eb', 4)).toBe('G');
  });
});

describe('identifyChord', () => {
  it('returns nothing for fewer than 3 pitch classes', () => {
    expect(identifyChord([])).toEqual([]);
    expect(identifyChord([60, 64])).toEqual([]);
    expect(identifyChord([60, 72, 64])).toEqual([]);
  });

  it('names root-position triads and sevenths', () => {
    expect(names([60, 64, 67])).toEqual(['C']);
    expect(names([57, 60, 64])).toEqual(['Am']);
    expect(names([66, 69, 73])).toEqual(['F#m']);
    expect(names([60, 64, 67, 71])).toEqual(['Cmaj7']);
    expect(names([55, 59, 62, 65])).toEqual(['G7']);
    expect(names([59, 62, 65, 69])).toEqual(['Bm7b5']);
  });

  it('handles inversions and spread voicings', () => {
    expect(names([64, 67, 72])).toEqual(['C/E']);
    expect(names([67, 72, 76])).toEqual(['C/G']);
    expect(names([48, 64, 67, 72, 76])).toEqual(['C']);
    const m = identifyChord([65, 67, 71, 74]); // G7 / F
    expect(m[0].name).toBe('G7/F');
    expect(m[0].inversion).toBe(3);
  });

  it('lists every reading of an ambiguous pitch-class set, root position first', () => {
    expect(names([57, 60, 64, 67])).toEqual(['Am7']); // 4 pcs: no C6 quality, so only Am7
    expect(names([60, 64, 68])).toEqual(['Caug', 'Eaug/B#', 'Abaug/C']);
    expect(names([60, 63, 66, 69])).toHaveLength(4);
    expect(names([60, 63, 66, 69])[0]).toBe('Cdim7');
    expect(names([60, 62, 67])).toEqual(['Csus2', 'Gsus4/C']);
  });

  it('says no match for clusters', () => {
    expect(identifyChord([60, 61, 62])).toEqual([]);
    expect(identifyChord([60, 61, 64, 67])).toEqual([]);
  });
});
