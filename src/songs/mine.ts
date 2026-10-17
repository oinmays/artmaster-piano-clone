/**
 * "My songs": MIDI files the learner imported. Stored on this device only (localStorage),
 * never uploaded. Notes are kept compact ([midi, start, dur, hand]) to stretch the quota.
 */
import type { Level, NoteEvent, Song } from '../core/types';
import { load, trySave } from '../core/store';
import { MidiImportError, midiToSong, parseMidi, titleFromFileName } from './midifile';

const KEY = 'mySongs';
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_SONGS = 30;
/** Total budget for imported songs, leaving room in the ~5 MB quota for progress and settings. */
const MAX_STORED_CHARS = 2_500_000;

type Packed = [number, number, number, 0 | 1];
interface Stored extends Omit<Song, 'levels'> {
  levels: Record<Level, Packed[]>;
  addedAt: number;
}

const pack = (n: NoteEvent): Packed => [n.midi, n.start, n.dur, n.hand === 'L' ? 1 : 0];
const unpack = ([midi, start, dur, h]: Packed): NoteEvent => ({ midi, start, dur, hand: h ? 'L' : 'R' });

let cache: Song[] | null = null;

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
}

/** Imported songs, newest first. */
export function mySongs(): Song[] {
  if (!cache) {
    cache = readAll()
      .sort((a, b) => b.addedAt - a.addedAt)
      .map(({ addedAt: _, levels, ...meta }) => ({
        ...meta,
        levels: { easy: levels.easy.map(unpack), medium: levels.medium.map(unpack), hard: levels.hard.map(unpack) },
      }));
  }
  return cache;
}

export const isMySong = (id: string) => id.startsWith('my-');
export const getMySong = (id: string): Song | undefined => (isMySong(id) ? mySongs().find((s) => s.id === id) : undefined);

/** Read, convert and store a picked file. Throws MidiImportError with a message fit to show. */
export async function importMidiFile(file: File): Promise<Song> {
  if (!/\.(midi?|kar)$/i.test(file.name) && !/midi/i.test(file.type)) {
    throw new MidiImportError('Please choose a MIDI file (.mid or .midi).');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new MidiImportError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; Keys can load MIDI files up to 1 MB.`);
  }
  if (readAll().length >= MAX_SONGS) {
    throw new MidiImportError(`You have ${MAX_SONGS} songs, the most Keys keeps. Delete one to add another.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = `my-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const song = midiToSong(parseMidi(bytes), { id, title: titleFromFileName(file.name) });
  const { levels, ...meta } = song;
  writeAll([
    ...readAll(),
    { ...meta, addedAt: Date.now(), levels: { easy: levels.easy.map(pack), medium: levels.medium.map(pack), hard: levels.hard.map(pack) } },
  ]);
  return song;
}

export function renameMySong(id: string, title: string): void {
  const t = title.trim().slice(0, 80);
  if (!t) return;
  writeAll(readAll().map((s) => (s.id === id ? { ...s, title: t } : s)));
}

export function deleteMySong(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
}
