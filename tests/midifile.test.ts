import { describe, expect, it } from 'vitest';
import { MidiImportError, autoRoles, listTracks, midiToSong, parseMidi, titleFromFileName, type TrackInfo } from '../src/songs/midifile';

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
/** A meta event at delta 0 carrying latin1 text (0x01 text, 0x02 copyright, 0x03 track name). */
const meta = (type: number, s: string) => [0, 0xff, type, s.length, ...[...s].map((c) => c.charCodeAt(0))];
const name = (s: string) => meta(0x03, s);
/** Program change (0-based GM program) on a channel. */
const prog = (program: number, ch = 0, delta = 0) => [...vlq(delta), 0xc0 | ch, program];
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

// ---- T26: instruments, tracks and roles ------------------------------------------------

/** A track that sets a program, then plays the keys one after another (one beat each). */
const part = (label: string, program: number | null, ch: number, keys: number[]) =>
  track([...(label ? [name(label)] : []), ...(program === null ? [] : [prog(program, ch)]), ...keys.map((k) => note(0, k, PPQ, ch))]);

/** Piano RH + piano LH + bass + strings + drums, all format 1 with a tempo track. */
const band = () =>
  midi(
    header(1, 6, PPQ),
    track([name('My Band Song'), tempo(120)]),
    part('', 0, 0, [72, 76, 79]),
    part('', 1, 1, [48, 52, 55]),
    part('', 33, 2, [36, 40]),
    part('', 48, 3, [60, 64, 67, 72]),
    part('', null, 9, [36, 38, 42]),
  );

const view = (song: ReturnType<typeof midiToSong>) => song.levels.hard.map((n) => `${n.hand}${n.midi}`).sort();

describe('parseMidi (T26 additions)', () => {
  it('records the program active on each note’s channel, including mid-track changes', () => {
    const ev = [prog(0), note(0, 60, PPQ), prog(40, 0, 0), note(0, 62, PPQ), note(0, 50, PPQ, 1)];
    const m = parseMidi(midi(header(0, 1, PPQ), track(ev)));
    expect(m.notes.map((n) => [n.midi, n.program])).toEqual([
      [60, 0],
      [62, 40],
      [50, undefined],
    ]);
  });

  it('applies a program change from another track to the channel', () => {
    const file = midi(header(1, 2, PPQ), track([prog(33, 2)]), track([note(0, 40, PPQ, 2)]));
    expect(parseMidi(file).notes[0].program).toBe(33);
  });

  it('reads the sequence name, copyright and text events', () => {
    const file = midi(
      header(1, 2, PPQ),
      track([name(' Moonlight Sonata '), meta(0x02, 'Copyright 1801 L. v. B.'), meta(0x01, 'Ludwig van Beethoven'), meta(0x01, '   ')]),
      track([name('Piano'), meta(0x01, 'Adagio'), note(0, 60, PPQ)]),
    );
    const m = parseMidi(file);
    expect(m.sequenceName).toBe('Moonlight Sonata');
    expect(m.copyright).toEqual(['Copyright 1801 L. v. B.']);
    expect(m.texts).toEqual(['Ludwig van Beethoven', 'Adagio']);
  });

  it('uses the only track’s name as the sequence name in format 0', () => {
    const m = parseMidi(midi(header(0, 1, PPQ), track([name('Für Elise'), note(0, 64, PPQ)])));
    expect(m.sequenceName).toBe('Für Elise');
    expect(m.copyright).toEqual([]);
  });
});

describe('listTracks', () => {
  it('lists every part with its program, label and drums flag', () => {
    const tracks = listTracks(parseMidi(band()));
    expect(tracks.map((t) => [t.key, t.program, t.drums, t.label])).toEqual([
      [1, 0, false, 'Piano (RH)'],
      [2, 1, false, 'Piano 2 (LH)'],
      [3, 33, false, 'Bass'],
      [4, 48, false, 'Strings'],
      [5, null, true, 'Drums'],
    ]);
    expect(tracks[2]).toMatchObject({ channel: 2, notes: 2, low: 36, high: 40, avg: 38 });
  });

  it('prefers a meaningful track name and ignores junk ones', () => {
    const file = midi(
      header(1, 3, PPQ),
      part('Track 1', 0, 0, [72]),
      part('Right Hand', 0, 1, [74]),
      part('Lefty piano', 0, 2, [48]),
    );
    expect(listTracks(parseMidi(file)).map((t) => t.label)).toEqual(['Piano', 'Right Hand', 'Lefty piano (LH)']);
  });

  it('groups by channel in a single-track file', () => {
    const file = midi(header(0, 1, PPQ), track([prog(0, 0), prog(32, 1), note(0, 64, PPQ, 0), note(0, 40, PPQ, 1), note(0, 36, PPQ, 9)]));
    const tracks = listTracks(parseMidi(file));
    expect(tracks.map((t) => [t.key, t.name, t.label])).toEqual([
      [0, '', 'Piano'],
      [1, '', 'Bass'],
      [9, '', 'Drums'],
    ]);
  });
});

describe('autoRoles', () => {
  const t = (key: number, o: Partial<TrackInfo>): TrackInfo => ({ key, name: '', label: '', program: null, channel: key, drums: false, notes: 4, low: 60, high: 60, ...o });

  it('gives the two piano parts the hands and turns the band off', () => {
    expect(autoRoles(listTracks(parseMidi(band())))).toEqual({ 1: 'R', 2: 'L', 3: 'off', 4: 'off', 5: 'off' });
  });

  it('splits a lone piano part at middle C when other instruments play too', () => {
    const roles = autoRoles([t(0, { program: 0, low: 40, high: 80 }), t(1, { program: 33, low: 30, high: 45 }), t(2, { program: 48, low: 60, high: 80 })]);
    expect(roles).toEqual({ 0: 'split', 1: 'off', 2: 'off' });
  });

  it('with no piano parts, gives the melody to the right hand and the bass to the left', () => {
    const roles = autoRoles([
      t(0, { program: 48, low: 70, high: 90 }),
      t(1, { program: 73, name: 'Melody', low: 65, high: 80 }),
      t(2, { program: 33, low: 30, high: 45 }),
      t(3, { program: 24, low: 50, high: 60 }),
    ]);
    expect(roles).toEqual({ 0: 'off', 1: 'R', 2: 'L', 3: 'off' });
  });

  it('lets named hands win over pitch among piano parts', () => {
    const roles = autoRoles([t(0, { program: 0, name: 'Left hand', avg: 70 }), t(1, { program: 0, name: 'Right hand', avg: 50 })]);
    expect(roles).toEqual({ 0: 'L', 1: 'R' });
  });

  it('splits a single part and always turns drums off', () => {
    expect(autoRoles([t(0, { program: 40 }), t(9, { drums: true })])).toEqual({ 0: 'split', 9: 'off' });
    expect(autoRoles([t(9, { drums: true })])).toEqual({ 9: 'off' });
  });
});

describe('midiToSong with roles', () => {
  const opts = { id: 'my-test', title: 'Test' };

  it('plays the two piano parts by default and ignores the rest', () => {
    const song = midiToSong(parseMidi(band()), opts);
    expect(view(song)).toEqual(['L48', 'L52', 'L55', 'R72', 'R76', 'R79']);
    expect(song.composer).toBe('Imported MIDI');
  });

  it('splits the lone piano part at middle C', () => {
    const file = midi(header(1, 3, PPQ), part('', 0, 0, [72, 48]), part('', 33, 1, [36]), part('', 48, 2, [80]));
    expect(view(midiToSong(parseMidi(file), opts))).toEqual(['L48', 'R72']);
  });

  it('uses custom roles and composer', () => {
    const song = midiToSong(parseMidi(band()), { ...opts, composer: 'Me', roles: { 1: 'off', 2: 'off', 3: 'L', 4: 'split', 5: 'R' } });
    // Drums never play, even when asked to.
    expect(view(song)).toEqual(['L36', 'L40', 'R60', 'R64', 'R67', 'R72']);
    expect(song.composer).toBe('Me');
  });

  it('refuses when every track is ignored', () => {
    expect(() => midiToSong(parseMidi(band()), { ...opts, roles: { 1: 'off', 2: 'off', 3: 'off', 4: 'off', 5: 'R' } })).toThrow(/Pick at least one track/);
  });
});
