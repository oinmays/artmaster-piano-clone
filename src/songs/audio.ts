/**
 * Audio file -> notes on the device with Spotify's Basic Pitch (T23 — stub).
 * The model and TensorFlow.js load lazily on first use (never in the main bundle or the
 * offline precache) and are cached after the first download. Nothing is uploaded.
 */
import type { MidiFile } from './midifile';

export const AUDIO_FILE = /\.(mp3|m4a|aac|mp4|wav|wave|aif|aiff|caf|ogg|oga|opus|flac)$/i;
/** Longest recording Keys converts. */
export const MAX_AUDIO_SECONDS = 360;
export const MAX_AUDIO_BYTES = 60 * 1024 * 1024;

export interface AudioConvertOptions {
  signal?: AbortSignal;
  /** percent 0–100 over the whole job; phase is a short label shown to the learner. */
  onProgress?: (percent: number, phase: string) => void;
}

export interface AudioConvertResult {
  /** Format 0, one track, channel 0, 120 bpm, ppq 480: feed it to midiToSong. */
  midi: MidiFile;
  durationSec: number;
}

/** Throws MidiImportError with a friendly message; a DOMException named 'AbortError' when aborted. */
export async function audioToMidi(_file: Blob, _opts: AudioConvertOptions = {}): Promise<AudioConvertResult> {
  throw new Error('T23: audioToMidi not built yet');
}
