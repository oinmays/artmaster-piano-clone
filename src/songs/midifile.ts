/**
 * Standard MIDI File reader (format 0 and 1, PPQ timing) and conversion to a Keys Song.
 * No dependencies; runs in the browser on a file the learner picked. Nothing is uploaded.
 *
 * Levels follow the same idea as catalog.ts:
 *   easy   = right-hand melody only (the top note of each chord, one note at a time)
 *   medium = melody + the left hand's lowest note on each onset (a bass line)
 *   hard   = both hands as written (chords capped at 4 notes per hand)
 */
import type { Hand, NoteEvent, Song } from '../core/types';
import { combine, sortNotes } from './notation';
import { gmShortName, isKeys } from './gm';

/** A friendly error: its message is shown to the learner as is. */
export class MidiImportError extends Error {}

export interface RawNote {
  midi: number;
  /** In ticks. */
  start: number;
  end: number;
  velocity: number;
  channel: number;
  track: number;
  /** General MIDI program (0-based, 0 = Acoustic Grand) active on the channel when the note started; undefined if none was set. (T26) */
  program?: number;
}

export interface MidiFile {
  format: number;
  ppq: number;
  /** Microseconds per quarter note of the first tempo event (500000 = 120 bpm). */
  tempo: number;
  timeSig: { num: number; den: number };
  /** Key signature: sharps (+) or flats (−), and minor flag. */
  keySig?: { sf: number; minor: boolean };
  /** Track names by track index ('' when the track has none). */
  trackNames: string[];
  /** Sequence name: the first track's name in format 1 files, the only track's name in format 0. (T26/T25) */
  sequenceName?: string;
  /** Copyright notice meta events (0x02), in file order. (T26/T25) */
  copyright?: string[];
  /** Text meta events (0x01), in file order. (T26/T25) */
  texts?: string[];
  notes: RawNote[];
}

/** What the learner chose for a track: right hand, left hand, split at middle C, or ignored. (T26) */
export type TrackRole = 'R' | 'L' | 'split' | 'off';
/** Roles by String(TrackInfo.key). (T26) */
export type TrackRoles = Record<string, TrackRole>;

/** One playable part of a MIDI file, as shown on the Tracks sheet. (T26) */
export interface TrackInfo {
  /** Group key: the track index in multi-track format 1 files, the channel otherwise (same grouping midiToSong uses). */
  key: number;
  /** Track name from the file ('' when none). */
  name: string;
  /** Friendly label, e.g. "Piano (RH)", "Bass", "Strings 2". */
  label: string;
  /** GM program (0-based) of the first program change in the part, or null. */
  program: number | null;
  /** Channel of most of the notes (0-based; 9 = drums). */
  channel: number;
  drums: boolean;
  notes: number;
  low: number;
  high: number;
  /** Mean pitch of the part's notes (listTracks always sets it; autoRoles falls back to the low–high midpoint). */
  avg?: number;
}

/** Parse the bytes of a .mid file. Throws MidiImportError on anything it can't read. */
export function parseMidi(bytes: Uint8Array): MidiFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const need = (at: number, n: number) => {
    if (at + n > bytes.length) throw new MidiImportError('This MIDI file is cut short or damaged.');
  };

  if (bytes.length < 4 || str(0) !== 'MThd') throw new MidiImportError("This doesn't look like a MIDI file (.mid).");
  need(0, 14);
  const headLen = view.getUint32(4);
  const format = view.getUint16(8);
  const nTracks = view.getUint16(10);
  const division = view.getUint16(12);
  if (format > 1) throw new MidiImportError('This MIDI file uses format 2, which Keys can’t read. Try exporting it again as format 0 or 1.');
  if (division & 0x8000) throw new MidiImportError('This MIDI file uses SMPTE timing, which Keys can’t read. Try exporting it again from your music app.');
  const ppq = division || 480;

  const out: MidiFile = { format, ppq, tempo: 0, timeSig: { num: 4, den: 4 }, trackNames: [], notes: [] };
  let tempoAt = Infinity;
  let sigAt = Infinity;
  let keyAt = Infinity;
  let pos = 8 + headLen;
  // Program changes, in file order: assigned to notes by channel and time once every track is read.
  const programs: { tick: number; ch: number; program: number }[] = [];
  const copyright: string[] = [];
  const texts: string[] = [];
  const latin1 = (d: Uint8Array) => new TextDecoder('latin1').decode(d).trim();

  for (let t = 0; t < nTracks && pos + 8 <= bytes.length; t++) {
    const id = str(pos);
    const len = view.getUint32(pos + 4);
    pos += 8;
    if (id !== 'MTrk') {
      // Unknown chunk: skip it.
      pos += len;
      t--;
      continue;
    }
    const end = Math.min(pos + len, bytes.length);
    out.trackNames[t] = '';
    const open = new Map<number, { start: number; velocity: number }[]>();
    let tick = 0;
    let status = 0;

    const varlen = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        need(pos, 1);
        const b = bytes[pos++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
      throw new MidiImportError('This MIDI file is damaged (bad length).');
    };
    const noteOff = (ch: number, key: number) => {
      const stack = open.get(ch * 128 + key);
      const on = stack?.shift();
      if (on) out.notes.push({ midi: key, start: on.start, end: tick, velocity: on.velocity, channel: ch, track: t });
    };

    while (pos < end) {
      tick += varlen();
      need(pos, 1);
      let b = bytes[pos];
      if (b & 0x80) {
        pos++;
      } else {
        // Running status: reuse the last channel status; b is the first data byte.
        if (!status) throw new MidiImportError('This MIDI file is damaged (no status byte).');
        b = status;
      }

      if (b === 0xff) {
        need(pos, 1);
        const type = bytes[pos++];
        const n = varlen();
        need(pos, n);
        const d = bytes.subarray(pos, pos + n);
        pos += n;
        if (type === 0x2f) break;
        if (type === 0x03 && !out.trackNames[t]) out.trackNames[t] = latin1(d);
        if (type === 0x01 || type === 0x02) {
          const text = latin1(d);
          if (text) (type === 0x02 ? copyright : texts).push(text);
        }
        if (type === 0x51 && n >= 3 && tick < tempoAt) {
          tempoAt = tick;
          out.tempo = (d[0] << 16) | (d[1] << 8) | d[2];
        }
        if (type === 0x58 && n >= 2 && tick < sigAt) {
          sigAt = tick;
          out.timeSig = { num: d[0] || 4, den: 2 ** d[1] };
        }
        if (type === 0x59 && n >= 2 && tick < keyAt) {
          keyAt = tick;
          out.keySig = { sf: (d[0] << 24) >> 24, minor: d[1] === 1 };
        }
        // The spec says meta events cancel running status, but some writers rely on it surviving; keeping it is harmless.
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        pos += varlen();
        status = 0;
        continue;
      }
      if (b >= 0xf0) throw new MidiImportError('This MIDI file is damaged (unexpected system message).');

      status = b;
      const kind = b & 0xf0;
      const ch = b & 0x0f;
      const size = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      need(pos, size);
      const d1 = bytes[pos];
      const d2 = size === 2 ? bytes[pos + 1] : 0;
      pos += size;

      if (kind === 0xc0) {
        programs.push({ tick, ch, program: d1 & 0x7f });
      } else if (kind === 0x90 && d2 > 0) {
        const k = ch * 128 + d1;
        if (!open.has(k)) open.set(k, []);
        open.get(k)!.push({ start: tick, velocity: d2 });
      } else if (kind === 0x80 || kind === 0x90) {
        noteOff(ch, d1);
      }
    }
    // Close any note still held at the end of the track.
    for (const [k, stack] of open) for (const _ of [...stack]) noteOff(Math.floor(k / 128), k % 128);
    pos = end;
  }

  if (!out.tempo) out.tempo = 500000;
  // The program a note plays with is the last change on its channel at or before its start (in any track).
  if (programs.length) {
    const byCh = new Map<number, typeof programs>();
    for (const p of programs.sort((a, b) => a.tick - b.tick)) {
      if (!byCh.has(p.ch)) byCh.set(p.ch, []);
      byCh.get(p.ch)!.push(p);
    }
    for (const n of out.notes) {
      const list = byCh.get(n.channel);
      if (!list) continue;
      let program: number | undefined;
      for (const p of list) {
        if (p.tick > n.start) break;
        program = p.program;
      }
      if (program !== undefined) n.program = program;
    }
  }
  // Format 0 has one track; format 1 keeps the song's name on the first (tempo) track.
  if (out.trackNames[0]) out.sequenceName = out.trackNames[0];
  out.copyright = copyright;
  out.texts = texts;
  return out;
}

// ---- Conversion to a Song -----------------------------------------------------------------

/** Quantise to sixteenth notes. */
const GRID = 0.25;
const EPS = 1e-6;
const MAX_CHORD = 4;
export const MAX_NOTES = 6000;

const q = (beats: number) => Math.round(beats / GRID) * GRID;

const RIGHT_NAME = /\b(right|r\.?h\.?|treble|melody|upper|lead|vocal|voice|soprano)\b/i;
const LEFT_NAME = /\b(left|l\.?h\.?|bass|lower)\b/i;

const MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭'];
const MINOR = ['A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'D', 'G', 'C', 'F', 'B♭', 'E♭', 'A♭'];
function keyName(k: MidiFile['keySig']): string {
  if (!k || k.sf < -7 || k.sf > 7) return 'C major';
  const i = k.sf >= 0 ? k.sf : 7 - k.sf;
  return k.minor ? `${MINOR[i]} minor` : `${MAJOR[i]} major`;
}

/** Keep at most `max` notes per onset: the top ones for the right hand, the bottom ones for the left. */
function capChords(notes: NoteEvent[], max: number, hand: Hand): NoteEvent[] {
  const byStart = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    if (!byStart.has(n.start)) byStart.set(n.start, []);
    byStart.get(n.start)!.push(n);
  }
  const out: NoteEvent[] = [];
  for (const group of byStart.values()) {
    group.sort((a, b) => (hand === 'R' ? b.midi - a.midi : a.midi - b.midi));
    out.push(...group.slice(0, max));
  }
  return sortNotes(out);
}

/** One note per onset (top for R, bottom for L), each ending by the next onset. */
function line(notes: NoteEvent[], hand: Hand): NoteEvent[] {
  const one = capChords(notes, 1, hand);
  return one.map((n, i) => {
    const next = one[i + 1];
    return next && n.start + n.dur > next.start + EPS ? { ...n, dur: next.start - n.start } : { ...n };
  });
}

/**
 * The parts of a file, keyed like TrackInfo.key: by track in multi-track format 1 files, by channel
 * otherwise. Whether a file is "multi-track" is decided from its pitched notes only, so a format 1
 * file with one piano track and one drum track still splits by channel. Drum notes are included.
 */
export function partsOf(midi: MidiFile): Map<number, RawNote[]> {
  const byTrack = splitsByTrack(midi);
  const g = new Map<number, RawNote[]>();
  for (const n of midi.notes) {
    const k = byTrack ? n.track : n.channel;
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(n);
  }
  return new Map([...g].sort((a, b) => a[0] - b[0]));
}

function splitsByTrack(midi: MidiFile): boolean {
  const pitched = midi.notes.filter((n) => n.channel !== 9);
  return midi.format === 1 && new Set((pitched.length ? pitched : midi.notes).map((n) => n.track)).size > 1;
}

const KEYS_NAME = /\b(piano|pno|keys|keyboard|klavier|r\.?h\.?|l\.?h\.?|right|left|treble|bass\s*clef)\b/i;
const HAND_IN_NAME = /\b(r\.?h\.?|l\.?h\.?|right|left)\b/i;
/** Names that say nothing about the part: "Track 3", "Channel 1", "Untitled", "Instrument 2"… */
const JUNK_NAME = /^(track|tr|channel|ch|part|staff|instrument|inst|untitled|midi|new track|sequence)?\s*#?\s*\d*$/i;

function cleanName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim();
  if (JUNK_NAME.test(n) || !/\p{L}/u.test(n)) return '';
  return n.length > 28 ? `${n.slice(0, 27).trim()}…` : n;
}

const avgOf = (t: TrackInfo) => t.avg ?? (t.low + t.high) / 2;
const isKeysPart = (t: TrackInfo) => (t.program !== null && isKeys(t.program)) || KEYS_NAME.test(t.name);

export interface ConvertOptions {
  id: string;
  title: string;
  /** Shown as the song's composer line; defaults to 'Imported MIDI'. */
  composer?: string;
  /** Which tracks play which hand (T26). Defaults to autoRoles(listTracks(midi)). */
  roles?: TrackRoles;
}

/**
 * The playable parts of a file, drums included (flagged), in key order. (T26)
 * Labels are the cleaned track name when it means something, else the GM short name ("Piano",
 * "Bass", "Strings"…), "Drums", or "Part" when neither is known; repeats get " 2", " 3". The label
 * then carries autoRoles' pick as " (RH)" / " (LH)" (unless the name already says which hand), so it
 * describes the automatic choice, not one the learner saved.
 */
export function listTracks(midi: MidiFile): TrackInfo[] {
  const parts = partsOf(midi);
  const byTrack = splitsByTrack(midi);
  const tracks: TrackInfo[] = [];
  for (const [key, notes] of parts) {
    const chCount = new Map<number, number>();
    for (const n of notes) chCount.set(n.channel, (chCount.get(n.channel) ?? 0) + 1);
    const channel = [...chCount].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const first = [...notes].sort((a, b) => a.start - b.start).find((n) => n.program !== undefined);
    const pitches = notes.map((n) => n.midi);
    tracks.push({
      key,
      name: byTrack ? (midi.trackNames[key] ?? '') : '',
      label: '',
      program: first?.program ?? null,
      channel,
      drums: channel === 9,
      notes: notes.length,
      low: pitches.reduce((a, b) => Math.min(a, b)),
      high: pitches.reduce((a, b) => Math.max(a, b)),
      avg: pitches.reduce((s, m) => s + m, 0) / pitches.length,
    });
  }

  // Base labels, de-duplicated.
  const seen = new Map<string, number>();
  for (const t of tracks) {
    const base = t.drums ? 'Drums' : cleanName(t.name) || (t.program !== null ? gmShortName(t.program) : 'Part');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    t.label = n > 1 ? `${base} ${n}` : base;
  }
  const roles = autoRoles(tracks);
  for (const t of tracks) {
    const role = roles[String(t.key)];
    if ((role === 'R' || role === 'L') && !HAND_IN_NAME.test(t.label)) t.label += role === 'R' ? ' (RH)' : ' (LH)';
  }
  return tracks;
}

/**
 * Pick hands automatically. (T26) Drums are always off; a single part is split at middle C.
 * Otherwise keys parts (a piano or organ program, or a piano/hand-like name) win:
 *  - two or more: a part named for the right/left hand takes that hand, else the higher one is
 *    the right hand and the lower one the left; any others are off;
 *  - exactly one: it is split at middle C and everything else is off;
 *  - none: the old behaviour — the right hand is a melody/lead/vocal-named part or the highest
 *    one, the left hand a left/bass-named part or the lowest one, the rest off.
 */
export function autoRoles(tracks: TrackInfo[]): TrackRoles {
  const roles: TrackRoles = {};
  for (const t of tracks) roles[String(t.key)] = 'off';
  const parts = tracks.filter((t) => !t.drums && t.notes > 0);
  if (parts.length === 1) roles[String(parts[0].key)] = 'split';
  if (parts.length <= 1) return roles;

  const keys = parts.filter(isKeysPart);
  if (keys.length === 1) {
    roles[String(keys[0].key)] = 'split';
    return roles;
  }
  const pool = keys.length ? keys : parts;
  const byPitch = [...pool].sort((a, b) => avgOf(b) - avgOf(a));
  const right = pool.find((t) => RIGHT_NAME.test(t.name)) ?? byPitch[0];
  const left = pool.find((t) => t !== right && LEFT_NAME.test(t.name)) ?? byPitch.filter((t) => t !== right).at(-1)!;
  roles[String(right.key)] = 'R';
  roles[String(left.key)] = 'L';
  return roles;
}

/** Turn a parsed MIDI file into a Song with easy, medium and hard levels. */
export function midiToSong(midi: MidiFile, opts: ConvertOptions): Song {
  // Channel 10 (index 9) is drums.
  const pitched = midi.notes.filter((n) => n.channel !== 9);
  if (!pitched.length) throw new MidiImportError('This MIDI file has no piano notes in it (only drums, or nothing at all).');

  // Decide which notes belong to each hand from the part roles ('split' = middle C and up is the right hand).
  const roles = opts.roles ?? autoRoles(listTracks(midi));
  const roleOf = new Map<RawNote, TrackRole>();
  for (const [key, list] of partsOf(midi)) for (const n of list) roleOf.set(n, roles[String(key)] ?? 'off');
  const hand = (n: RawNote): Hand | null => {
    const role = roleOf.get(n);
    return role === 'R' || role === 'L' ? role : role === 'split' ? (n.midi >= 60 ? 'R' : 'L') : null;
  };
  if (!pitched.some(hand)) throw new MidiImportError('Pick at least one track for a hand.');

  let notes: NoteEvent[] = [];
  for (const n of pitched) {
    const h = hand(n);
    if (!h) continue;
    const start = q(n.start / midi.ppq);
    const end = Math.max(start + GRID, q(n.end / midi.ppq));
    notes.push({ midi: n.midi, start, dur: end - start, hand: h });
  }
  // Drop duplicates the quantiser created (same pitch, same hand, same onset).
  const seen = new Set<string>();
  notes = notes.filter((n) => {
    const k = `${n.hand}${n.midi}@${n.start}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });

  let right = notes.filter((n) => n.hand === 'R');
  let left = notes.filter((n) => n.hand === 'L');
  if (!right.length) {
    // Everything was low: treat it all as the right hand so easy still has a melody.
    right = left.map((n) => ({ ...n, hand: 'R' as Hand }));
    left = [];
  }

  // Start at the bar holding the first note.
  const beatsPerBar = (midi.timeSig.num * 4) / midi.timeSig.den;
  const first = Math.min(...right.map((n) => n.start), ...left.map((n) => n.start));
  const shift = Math.floor(first / beatsPerBar + EPS) * beatsPerBar;
  const move = (list: NoteEvent[]) => list.map((n) => ({ ...n, start: n.start - shift }));
  right = capChords(move(right), MAX_CHORD, 'R');
  left = capChords(move(left), MAX_CHORD, 'L');

  const hard = combine(right, left);
  if (hard.length > MAX_NOTES) {
    throw new MidiImportError(`This song has ${hard.length.toLocaleString()} notes; Keys can load up to ${MAX_NOTES.toLocaleString()}. Try a shorter or simpler arrangement.`);
  }
  const melody = line(right, 'R');
  const bpm = Math.max(20, Math.min(300, Math.round(60_000_000 / midi.tempo)));
  const meter = midi.timeSig.den === 4 ? undefined : `${midi.timeSig.num}/${midi.timeSig.den}`;

  return {
    id: opts.id,
    title: opts.title,
    composer: opts.composer ?? 'Imported MIDI',
    blurb: `My song · ${hard.length} notes`,
    bpm,
    beatsPerBar,
    ...(meter ? { meter } : {}),
    key: keyName(midi.keySig),
    tags: ['My songs'],
    levels: {
      easy: melody,
      medium: combine(melody, line(left, 'L')),
      hard,
    },
  };
}

/** "my_song-01.mid" -> "My song 01" */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.(midi?|kar)$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 80) || 'My song';
}
