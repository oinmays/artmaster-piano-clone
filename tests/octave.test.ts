import { describe, expect, it } from 'vitest';
import { expandOctaves, octaveMatch } from '../src/player/octave';

describe('any-octave matching', () => {
  it('maps a note in another octave onto the expected note', () => {
    expect(octaveMatch(52, [64])).toBe(64); // E3 played, E4 expected
    expect(octaveMatch(76, [64])).toBe(64); // E5 played
    expect(octaveMatch(88, [64])).toBe(64); // two octaves up
  });
  it('leaves exact and wrong notes alone', () => {
    expect(octaveMatch(64, [64, 52])).toBe(64);
    expect(octaveMatch(62, [64])).toBe(62); // D is still wrong
  });
  it('expands expected notes within the piano range', () => {
    expect(expandOctaves([64]).sort((a, b) => a - b)).toEqual([40, 52, 64, 76, 88]);
    expect(expandOctaves([22])).toEqual([22, 34, 46]);
  });
});
