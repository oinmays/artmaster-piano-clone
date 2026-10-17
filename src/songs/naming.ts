/** Artist and title from messy file names, MIDI meta and audio tags (T25 — stub). */
import type { MidiFile } from './midifile';

export interface NameGuess {
  /** '' when unknown. */
  artist: string;
  /** Never empty ('My song' as a last resort). */
  title: string;
}
export interface NameMeta {
  title?: string;
  artist?: string;
}

/** "50 Cent - 21 Questions (Official Music Video) [ytmp3.cc] 320kbps.mp3" -> { artist: '50 Cent', title: '21 Questions' } */
export function guessFromFileName(_fileName: string): NameGuess {
  throw new Error('T25: guessFromFileName not built yet');
}
/** Useful title/artist from a MIDI file's sequence name, copyright and text events (junk like "Track 1", "Piano" ignored). */
export function metaFromMidi(_midi: MidiFile): NameMeta {
  throw new Error('T25: metaFromMidi not built yet');
}
/** Tags beat the file name, field by field; both are cleaned. */
export function pickName(_fileName: string, _meta: NameMeta = {}): NameGuess {
  throw new Error('T25: pickName not built yet');
}
