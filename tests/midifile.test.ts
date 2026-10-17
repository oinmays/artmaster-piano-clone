import { describe, expect, it } from 'vitest';
import { MidiImportError, midiToSong, parseMidi, titleFromFileName } from '../src/songs/midifile';

// ---- Tiny hand-built MIDI files --------------------------------------------------

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const header = (format: number, tracks: number, ppq: number) => [...'MThd'].map((c) => c.charCodeAt(0)).concat(u32(6), u16(format), u16(tracks), u16(ppq));
function track(events: number[][]): number[] {
  const body = events.flat().concat([0, 0xff, 0x2f, 0]);
  return [...'MTrk'].map((c) => c.charCodeAt(0)).concat(u32(body.length), body);
}
const midi = (...parts: number[][]) => new Uint8Array(parts.flat());
const tempo = (bpm: number) => {
  const us = Math.round(60_000_000 / bpm);
  return [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
};
const name = (s: string) => [0, 0xff, 0x03, s.length, ...[...s].map((c) => c.charCodeAt(0))];
/** Note on at delta, then note off `len` ticks later, as two events. */
const note = (delta: number, key: number, len: number, ch = 0) => [...vlq(delta), 0x90 | ch, key, 100, ...vlq(len), 0x80 | ch, key, 0];

const PPQ = 96;

describe('parseMidi', () => {
  it('reads format 0 with tempo, time signature and note on/off', () => {
    const file = midi(
      header(0, 1, PPQ),
      track([tempo(90), [0, 0xff, 0x58, 4, 3, 2, 24, 8], note(0, 60, PPQ), note(0, 62, PPQ * 2)]),
    );
    const m = parseMidi(file);
    expect(m.format).toBe(0);
    expect(m.ppq).toBe(PPQ);
    expect(Math.round(60_000_000 / m.tempo)).toBe(90);
    expect(m.timeSig).toEqual({ num: 3, den: 4 });
    expect(m.notes.map((n) => [n.midi, n.start, n.end])).toEqual([
      [60, 0, PPQ],
      [62, PPQ, PPQ * 3],
    ]);
  });

  it('handles running status and velocity-0 note offs', () => {
    // 0x90 once, then data bytes only; offs are note-ons with velocity 0.
    const ev = [[0, 0x90, 60, 100], [0, 64, 100], [...vlq(PPQ), 60, 0], [0, 64, 0], [0, 67, 90], [...vlq(PPQ), 67, 0]];
    const m = parseMidi(midi(header(0, 1, PPQ), track(ev)));
    expect(m.notes.map((n) => [n.midi, n.start, n.end, n.velocity])).toEqual([
      [60, 0, PPQ, 100],
      [64, 0, PPQ, 100],
      [67, PPQ, PPQ * 2, 90],
    ]);
  });

  it('reads format 1 with several tracks and track names', () => {
    const file = midi(
      header(1, 3, PPQ),
      track([tempo(120)]),
      track([name('Piano RH'), note(0, 72, PPQ), note(0, 74, PPQ)]),
      track([name('Piano LH'), note(0, 48, PPQ * 2)]),
    );
    const m = parseMidi(file);
    expect(m.format).toBe(1);
    expect(m.trackNames).toEqual(['', 'Piano RH', 'Piano LH']);
    expect(m.notes.map((n) => [n.track, n.midi])).toEqual([
      [1, 72],
      [1, 74],
      [2, 48],
    ]);
  });

  it('rejects files that are not MIDI with a friendly error', () => {
    expect(() => parseMidi(new TextEncoder().encode('ID3 not a midi file'))).toThrow(MidiImportError);
    expect(() => parseMidi(midi(header(2, 0, PPQ)))).toThrow(/format 2/);
  });
});

describe('midiToSong', () => {
  const opts = { id: 'my-test', title: 'Test' };

  it('splits one track at middle C and builds three levels', () => {
    // Bar 1: C major chord (C3 + E4 G4 C5) on beat 1, then melody D5 on beat 3.
    const ev = [
      [0, 0x90, 48, 80], [0, 64, 80], [0, 67, 80], [0, 72, 80],
      [...vlq(PPQ * 2), 48, 0], [0, 64, 0], [0, 67, 0], [0, 72, 0],
      note(0, 74, PPQ * 2),
    ];
    const song = midiToSong(parseMidi(midi(header(0, 1, PPQ), track([tempo(100), ...ev]))), opts);
    expect(song.bpm).toBe(100);
    expect(song.beatsPerBar).toBe(4);
    const view = (l: 'easy' | 'medium' | 'hard') => song.levels[l].map((n) => `${n.hand}${n.midi}@${n.start}`);
    expect(view('easy')).toEqual(['R72@0', 'R74@2']);
    expect(view('medium')).toEqual(['L48@0', 'R72@0', 'R74@2']);
    expect(view('hard')).toEqual(['L48@0', 'R64@0', 'R67@0', 'R72@0', 'R74@2']);
  });

  it('splits hands by track name in format 1, even when the names disagree with pitch', () => {
    const file = midi(
      header(1, 3, PPQ),
      track([tempo(120)]),
      track([name('Left hand'), note(0, 65, PPQ)]),
      track([name('Right hand'), note(0, 64, PPQ)]),
    );
    const song = midiToSong(parseMidi(file), opts);
    expect(song.levels.hard.map((n) => `${n.hand}${n.midi}`)).toEqual(['R64', 'L65']);
  });

  it('picks the right hand by highest average pitch when tracks are unnamed', () => {
    const file = midi(header(1, 2, PPQ), track([note(0, 40, PPQ), note(0, 45, PPQ)]), track([note(0, 70, PPQ * 2)]));
    const song = midiToSong(parseMidi(file), opts);
    expect(song.levels.easy.map((n) => n.midi)).toEqual([70]);
    expect(song.levels.hard.filter((n) => n.hand === 'L').map((n) => n.midi)).toEqual([40, 45]);
  });

  it('ignores drums, quantises lightly and trims leading empty bars', () => {
    const swing = PPQ * 4 * 2 + 5; // bar 3, five ticks late
    const file = midi(header(0, 1, PPQ), track([note(0, 36, PPQ, 9), note(swing - PPQ, 67, PPQ - 3)]));
    const song = midiToSong(parseMidi(file), opts);
    expect(song.levels.hard).toEqual([{ midi: 67, start: 0, dur: 1, hand: 'R' }]);
  });

  it('reads 6/8 as three quarter-note beats per bar', () => {
    const file = midi(header(0, 1, PPQ), track([[0, 0xff, 0x58, 4, 6, 3, 24, 8], note(0, 60, PPQ)]));
    const song = midiToSong(parseMidi(file), opts);
    expect(song.beatsPerBar).toBe(3);
    expect(song.meter).toBe('6/8');
  });

  it('refuses a drums-only file with a friendly error', () => {
    const file = midi(header(0, 1, PPQ), track([note(0, 36, PPQ, 9)]));
    expect(() => midiToSong(parseMidi(file), opts)).toThrow(/no piano notes/);
  });

  it('makes a title from the file name', () => {
    expect(titleFromFileName('love_yourself-piano.mid')).toBe('Love yourself piano');
    expect(titleFromFileName('.midi')).toBe('My song');
  });
});
