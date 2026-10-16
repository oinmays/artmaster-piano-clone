import { describe, expect, it } from 'vitest';
import { TapTempo, clampBpm, meterById, tempoMarking } from '../src/tools/tempo';

describe('tempoMarking', () => {
  it('maps bpm to names', () => {
    expect(tempoMarking(40)).toBe('Largo');
    expect(tempoMarking(70)).toBe('Adagio');
    expect(tempoMarking(90)).toBe('Andante');
    expect(tempoMarking(112)).toBe('Moderato');
    expect(tempoMarking(140)).toBe('Allegro');
    expect(tempoMarking(200)).toBe('Presto');
  });
});

describe('clampBpm', () => {
  it('rounds and clamps to 30-260', () => {
    expect(clampBpm(10)).toBe(30);
    expect(clampBpm(999)).toBe(260);
    expect(clampBpm(120.4)).toBe(120);
  });
});

describe('meters', () => {
  it('falls back to 4/4', () => {
    expect(meterById('6/8').groups).toEqual([0, 3]);
    expect(meterById('nope').id).toBe('4/4');
  });
});

describe('TapTempo', () => {
  it('needs two taps', () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(500)).toBe(120);
  });

  it('averages the last 4 taps', () => {
    const t = new TapTempo();
    [0, 1000, 1500, 2000].forEach((x) => t.tap(x));
    // last 4 taps: 1000,1500,2000,2500 -> 500ms -> 120
    expect(t.tap(2500)).toBe(120);
    expect(t.count).toBe(4);
  });

  it('resets after a 2 s pause', () => {
    const t = new TapTempo();
    t.tap(0);
    t.tap(600);
    expect(t.tap(3000)).toBeNull();
    expect(t.tap(3400)).toBe(150);
  });
});
