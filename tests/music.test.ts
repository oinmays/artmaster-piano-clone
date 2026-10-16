import { describe, expect, it } from 'vitest';
import { centsOff, chordNotes, midiToName, nameToMidi } from '../src/core/music';

describe('music helpers', () => {
  it('names and parses notes', () => {
    expect(midiToName(60)).toBe('C4');
    expect(nameToMidi('A4')).toBe(69);
    expect(nameToMidi('Db3')).toBe(49);
  });
  it('builds inversions', () => {
    expect(chordNotes(60, 'maj')).toEqual([60, 64, 67]);
    expect(chordNotes(60, 'maj', 1)).toEqual([64, 67, 72]);
    expect(chordNotes(60, 'maj', 2)).toEqual([67, 72, 76]);
    expect(chordNotes(60, 'add9')).toEqual([60, 64, 67, 74]);
    // 3rd inversion of add9 puts the 9th (D) in the bass.
    expect(chordNotes(60, 'add9', 3)[0] % 12).toBe(2);
  });
  it('measures cents', () => {
    expect(centsOff(440)).toEqual({ midi: 69, cents: 0 });
  });
});
