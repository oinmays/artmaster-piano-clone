/**
 * "My songs": MIDI and audio files the learner imported. Stored on this device only
 * (converted notes in localStorage, original MIDI bytes in IndexedDB), never uploaded.
 * Notes are kept compact ([midi, start, dur, hand]) to stretch the quota.
 */
import type { Level, NoteEvent, Song } from '../core/types';
import { load, trySave } from '../core/store';
import {
  MidiImportError,
  autoRoles,
  listTracks,
  midiToSong,
  parseMidi,
  type MidiFile,
  type TrackInfo,
  type TrackRoles,
} from './midifile';
import { AUDIO_FILE, MAX_AUDIO_BYTES, audioToMidi } from './audio';
import { readAudioTags } from './id3';
import { metaFromMidi, pickName } from './naming';
import { lengthBeats } from './notation';
import { DuplicateSongError, type ProcessContext, type ProcessResult } from './queue';
import { deleteSource, getSource, putSource } from './sources';

const KEY = 'mySongs';
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_SONGS = 60;
/** Total budget for imported songs, leaving room in the ~5 MB quota for progress and settings. */
const MAX_STORED_CHARS = 3_000_000;

export type SongSource = 'midi' | 'audio';

/** An imported song with what My songs shows about it. */
export interface MySong extends Song {
  /** '' when unknown. Song.composer mirrors it ('Unknown artist' when empty). */
  artist: string;
  source: SongSource;
  /** Length of the hard level at the song's tempo. */
  durationSec: number;
  /** SHA-256 of the file's bytes (hex), for duplicate detection; '' for songs from before T24. */
  hash: string;
  fileName: string;
  addedAt: number;
  /** Track roles chosen on the Tracks sheet (MIDI only). */
  roles?: TrackRoles;
  /** More than one non-drum part: the Tracks sheet is worth offering. */
  multiTrack: boolean;
}

type Packed = [number, number, number, 0 | 1];
interface Stored extends Omit<MySong, 'levels' | 'artist' | 'source' | 'durationSec' | 'hash' | 'fileName' | 'multiTrack'> {
  levels: Record<Level, Packed[]>;
  // Optional: songs imported before T24/T25 lack them.
  artist?: string;
  source?: SongSource;
  durationSec?: number;
  hash?: string;
  fileName?: string;
  multiTrack?: boolean;
}

const pack = (n: NoteEvent): Packed => [n.midi, n.start, n.dur, n.hand === 'L' ? 1 : 0];
const unpack = ([midi, start, dur, h]: Packed): NoteEvent => ({ midi, start, dur, hand: h ? 'L' : 'R' });
const packLevels = (l: Song['levels']): Stored['levels'] => ({ easy: l.easy.map(pack), medium: l.medium.map(pack), hard: l.hard.map(pack) });

let cache: MySong[] | null = null;

function readAll(): Stored[] {
  const v = load<Stored[]>(KEY, []);
  return Array.isArray(v) ? v : [];
}

function writeAll(list: Stored[]): void {
  if (JSON.stringify(list).length > MAX_STORED_CHARS) {
    throw new MidiImportError('There isn’t room on this device for that song. Delete one of your songs and try again.');
  }
  if (!trySave(KEY, list)) {
    throw new MidiImportError('Keys couldn’t save on this device (storage is full or blocked, e.g. in a private window).');
  }
  cache = null;
  for (const fn of listeners) fn();
}

const listeners = new Set<() => void>();
/** Called whenever My songs changes (import, rename, delete, new tracks). Returns an unsubscribe function. */
export function onMySongsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const durationOf = (song: Pick<Song, 'levels' | 'bpm'>): number => Math.round((lengthBeats(song.levels.hard) * 60) / song.bpm);

function toMySong(s: Stored): MySong {
  const { levels, ...meta } = s;
  const song = { ...meta, levels: { easy: levels.easy.map(unpack), medium: levels.medium.map(unpack), hard: levels.hard.map(unpack) } };
  return {
    ...song,
    artist: s.artist ?? '',
    source: s.source ?? 'midi',
    durationSec: s.durationSec ?? durationOf(song),
    hash: s.hash ?? '',
    fileName: s.fileName ?? s.title,
    multiTrack: s.multiTrack ?? false,
  };
}

/** Imported songs, newest first. */
export function mySongs(): MySong[] {
  cache ??= readAll()
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(toMySong);
  return cache;
}

export const isMySong = (id: string) => id.startsWith('my-');
export const getMySong = (id: string): MySong | undefined => (isMySong(id) ? mySongs().find((s) => s.id === id) : undefined);

const isMidiName = (f: File) => /\.(midi?|kar)$/i.test(f.name) || /midi/i.test(f.type);
const isAudioName = (f: File) => !isMidiName(f) && (AUDIO_FILE.test(f.name) || f.type.startsWith('audio/'));
/** 'midi', 'audio' or null for files Keys can't import. */
export const fileKind = (f: File): SongSource | null => (isMidiName(f) ? 'midi' : isAudioName(f) ? 'audio' : null);

async function sha256(bytes: Uint8Array): Promise<string> {
  try {
    const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // No SubtleCrypto (plain-http LAN testing): FNV-1a over the bytes, plus the length.
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
    return `fnv${(h >>> 0).toString(16)}-${bytes.length}`;
  }
}

const newId = () => `my-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const composerFor = (artist: string) => artist || 'Unknown artist';
const blurbFor = (source: SongSource, notes: number) => `${source === 'audio' ? 'From audio' : 'MIDI'} · ${notes.toLocaleString()} notes`;
const nonDrum = (tracks: TrackInfo[]) => tracks.filter((t) => !t.drums);

/**
 * Read, convert and store one picked file (MIDI or audio). This is the import queue's processor.
 * Throws MidiImportError with a message fit to show, DuplicateSongError when the same file is
 * already in My songs, or an AbortError when cancelled.
 */
export async function importFile(file: File, ctx: Partial<ProcessContext> = {}): Promise<ProcessResult> {
  const { signal, onProgress } = ctx;
  const kind = fileKind(file);
  if (!kind) throw new MidiImportError('Keys can load MIDI files (.mid) and audio files (MP3, M4A, WAV).');
  const limit = kind === 'midi' ? MAX_FILE_BYTES : MAX_AUDIO_BYTES;
  if (file.size > limit) {
    throw new MidiImportError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; Keys can load ${kind === 'midi' ? 'MIDI' : 'audio'} files up to ${limit / 1024 / 1024} MB.`);
  }
  if (readAll().length >= MAX_SONGS) {
    throw new MidiImportError(`You have ${MAX_SONGS} songs, the most Keys keeps. Delete one to add another.`);
  }
  onProgress?.(0, 'Reading');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256(bytes);
  const twin = readAll().find((s) => s.hash === hash);
  if (twin) throw new DuplicateSongError(`Already in My songs as “${twin.title}”.`, twin.id);
  signal?.throwIfAborted();

  const id = newId();
  let midi: MidiFile;
  let name;
  let roles: TrackRoles | undefined;
  let multiTrack = false;
  if (kind === 'midi') {
    midi = parseMidi(bytes);
    name = pickName(file.name, metaFromMidi(midi));
    const tracks = listTracks(midi);
    roles = autoRoles(tracks);
    multiTrack = nonDrum(tracks).length > 1;
  } else {
    const tags = readAudioTags(bytes);
    name = pickName(file.name, tags);
    midi = (await audioToMidi(new Blob([bytes as BlobPart], { type: file.type }), { signal, onProgress })).midi;
  }
  signal?.throwIfAborted();
  const song = midiToSong(midi, { id, title: name.title, composer: composerFor(name.artist), roles });
  const { levels, ...meta } = song;
  writeAll([
    ...readAll(),
    {
      ...meta,
      blurb: blurbFor(kind, levels.hard.length),
      artist: name.artist,
      source: kind,
      durationSec: durationOf(song),
      hash,
      fileName: file.name,
      addedAt: Date.now(),
      multiTrack,
      ...(roles ? { roles } : {}),
      levels: packLevels(levels),
    },
  ]);
  if (kind === 'midi') await putSource(id, bytes);
  onProgress?.(100, 'Done');
  return { songId: id, multiTrack };
}

/** Rename: either field may be given; an empty title is ignored, an empty artist clears it. */
export function updateMySong(id: string, fields: { artist?: string; title?: string }): void {
  const title = fields.title?.trim().slice(0, 80);
  const artist = fields.artist?.trim().slice(0, 80);
  writeAll(
    readAll().map((s) =>
      s.id !== id
        ? s
        : {
            ...s,
            ...(title ? { title } : {}),
            ...(artist !== undefined ? { artist, composer: composerFor(artist) } : {}),
          },
    ),
  );
}

/** Kept for older callers: renames the title only. */
export const renameMySong = (id: string, title: string) => updateMySong(id, { title });

export function deleteMySong(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
  void deleteSource(id);
}

/** The parts of an imported MIDI song and its current roles, or null when the original file isn't on this device. */
export async function getSongTracks(id: string): Promise<{ midi: MidiFile; tracks: TrackInfo[]; roles: TrackRoles } | null> {
  const song = getMySong(id);
  if (!song || song.source !== 'midi') return null;
  const bytes = await getSource(id);
  if (!bytes) return null;
  const midi = parseMidi(bytes);
  const tracks = listTracks(midi);
  return { midi, tracks, roles: { ...autoRoles(tracks), ...song.roles } };
}

/** Re-split the hands with the learner's choice and save it with the song. Throws MidiImportError. */
export async function applyTrackRoles(id: string, roles: TrackRoles): Promise<MySong> {
  const found = await getSongTracks(id);
  const song = getMySong(id);
  if (!found || !song) throw new MidiImportError('The original MIDI file isn’t on this device any more, so its tracks can’t be changed.');
  const next = midiToSong(found.midi, { id, title: song.title, composer: song.composer, roles });
  writeAll(
    readAll().map((s) =>
      s.id !== id ? s : { ...s, roles, bpm: next.bpm, blurb: blurbFor('midi', next.levels.hard.length), durationSec: durationOf(next), levels: packLevels(next.levels) },
    ),
  );
  return getMySong(id)!;
}
