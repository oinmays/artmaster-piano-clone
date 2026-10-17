/** "My songs" cards, grouped by artist (T25 — stub). */
import type { MySong } from './mine';

export interface ArtistGroup {
  /** '' for songs with no artist (shown as "Unknown artist", last). */
  artist: string;
  songs: MySong[];
}
/** Groups sorted by artist (case-insensitive, "The " ignored), songs by title inside. */
export function groupByArtist(_list: MySong[]): ArtistGroup[] {
  throw new Error('T25: groupByArtist not built yet');
}
/** 'Beginner' | 'Intermediate' | 'Advanced' from the hard level's note density and chords. */
export function difficultyOf(_song: MySong): 'Beginner' | 'Intermediate' | 'Advanced' {
  throw new Error('T25: difficultyOf not built yet');
}
/**
 * One card plus its actions, in the same visual language as songCardHtml in ui.ts.
 * `mode` 'edit' shows an artist + title form (data-rename=id, inputs name="artist" and "title"),
 * 'confirm' a delete confirmation (data-delete-yes=id, data-cancel), otherwise buttons
 * data-edit=id, data-delete=id and, for multi-track MIDI songs, a link to #/tracks/<id>.
 */
export function mySongCardHtml(_song: MySong, _mode: 'view' | 'edit' | 'confirm' = 'view'): string {
  throw new Error('T25: mySongCardHtml not built yet');
}
