import type { Level, NoteEvent, Song } from '../core/types';
import { CATALOG } from './catalog';
import { lengthBeats } from './notation';
import { getMySong } from './mine';

export { NOTATION_ERRORS } from './notation';

/** All songs, ordered from easiest to hardest. */
export const SONGS: Song[] = CATALOG;

/** A built-in song, or one the learner imported ("my-…" ids). */
export function getSong(id: string): Song | undefined {
  return SONGS.find((s) => s.id === id) ?? getMySong(id);
}

/** Every tag used in the library, in first-seen order. */
export function allTags(): string[] {
  return [...new Set(SONGS.flatMap((s) => s.tags))];
}

/** Number of bars in a level (ceil of the last note end / beatsPerBar). */
export function barCount(song: Song, level: Level): number {
  return Math.max(1, Math.ceil(lengthBeats(song.levels[level]) / song.beatsPerBar - 1e-6));
}

/** Notes falling inside bars [from, to] (1-based, inclusive). */
export function notesInBars(song: Song, notes: NoteEvent[], from: number, to: number): NoteEvent[] {
  const a = (from - 1) * song.beatsPerBar;
  const b = to * song.beatsPerBar;
  return notes.filter((n) => n.start >= a - 1e-6 && n.start < b - 1e-6);
}

export { lengthBeats };
