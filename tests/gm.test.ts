import { describe, expect, it } from 'vitest';
import { gmFamily, gmName, gmShortName, isKeys } from '../src/songs/gm';

describe('General MIDI', () => {
  it('names all 128 programs (0-based)', () => {
    expect(gmName(0)).toBe('Acoustic Grand Piano');
    expect(gmName(4)).toBe('Electric Piano 1');
    expect(gmName(33)).toBe('Electric Bass (finger)');
    expect(gmName(48)).toBe('String Ensemble 1');
    expect(gmName(127)).toBe('Gunshot');
    const names = Array.from({ length: 128 }, (_, p) => gmName(p));
    expect(new Set(names).size).toBe(128);
    expect(names).not.toContain('Unknown instrument');
    expect(gmName(128)).toBe('Unknown instrument');
    expect(gmName(-1)).toBe('Unknown instrument');
  });

  it('groups programs into 16 families of 8', () => {
    expect(gmFamily(0)).toBe('piano');
    expect(gmFamily(7)).toBe('piano');
    expect(gmFamily(8)).toBe('chromatic');
    expect(gmFamily(21)).toBe('organ');
    expect(gmFamily(32)).toBe('bass');
    expect(gmFamily(39)).toBe('bass');
    expect(gmFamily(40)).toBe('strings');
    expect(gmFamily(48)).toBe('ensemble');
    expect(gmFamily(80)).toBe('synth lead');
    expect(gmFamily(127)).toBe('sound effects');
  });

  it('counts pianos, harpsichord, clavinet and organs as keys, not accordions or mallets', () => {
    for (const p of [0, 1, 4, 5, 6, 7, 16, 19, 20]) expect(isKeys(p)).toBe(true);
    for (const p of [8, 11, 21, 22, 23, 24, 33, 48, 80, -1, 128, 0.5]) expect(isKeys(p)).toBe(false);
  });

  it('has short part names for labels', () => {
    expect(gmShortName(0)).toBe('Piano');
    expect(gmShortName(5)).toBe('Electric Piano');
    expect(gmShortName(38)).toBe('Bass');
    expect(gmShortName(49)).toBe('Strings');
    expect(gmShortName(200)).toBe('Part');
  });
});
