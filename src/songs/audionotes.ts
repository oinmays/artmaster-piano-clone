/**
 * Basic Pitch's note decoding (frame and onset probabilities -> notes), T23. Runs in the audio
 * worker; no TensorFlow here, so tests can import it.
 *
 * Same result as Basic Pitch's outputToNotesPoly with its defaults, but the "melodia trick"
 * (a second pass that picks up sustained notes whose onset was missed) is rewritten: the
 * original rescans every frame for the loudest leftover cell on each pass, about 10 s for a
 * 6-minute file; this one sorts the candidate cells once and walks them loudest first. Cells
 * only ever drop to 0, so the loudest untouched candidate is always the rescan's answer.
 */
import { noteFramesToTime, outputToNotesPoly, type NoteEvent } from '@spotify/basic-pitch/esm/toMidi';
import type { AudioNote } from './audio';

/**
 * Thresholds: Basic Pitch's own defaults (its Python CLI and demo site), which suit solo
 * piano well. Onset 0.5 and frame 0.3 are probabilities; a note must last more than 11 frames
 * (about 128 ms at 86 frames a second); onsets are also inferred from jumps in the frames.
 */
export const ONSET_THRESHOLD = 0.5;
export const FRAME_THRESHOLD = 0.3;
export const MIN_NOTE_FRAMES = 11;
/** Frames below the threshold a note may sit through before it ends (Basic Pitch's default). */
const ENERGY_TOLERANCE = 11;
const MIDI_OFFSET = 21;
const MAX_FREQ_IDX = 87;

/** Notes from onsets, then the melodia pass. melodia = false skips it. Mutates onsets. */
export function decodeEvents(frames: number[][], onsets: number[][], melodia = true): NoteEvent[] {
  if (!frames.length) return [];
  const notes = outputToNotesPoly(frames, onsets, ONSET_THRESHOLD, FRAME_THRESHOLD, MIN_NOTE_FRAMES, true, null, null, false);
  if (!melodia) return notes;

  // The energy outputToNotesPoly leaves behind: each kept note zeroes its key and both neighbours.
  const n = frames.length;
  const keys = frames[0].length;
  const energy = new Float32Array(n * keys);
  for (let i = 0; i < n; i++) energy.set(frames[i], i * keys);
  const clear = (i: number, f: number) => {
    energy[i * keys + f] = 0;
    if (f < MAX_FREQ_IDX) energy[i * keys + f + 1] = 0;
    if (f > 0) energy[i * keys + f - 1] = 0;
  };
  for (const ev of notes) {
    const f = ev.pitchMidi - MIDI_OFFSET;
    for (let i = ev.startFrame; i < ev.startFrame + ev.durationFrames; i++) clear(i, f);
  }

  const candidates: number[] = [];
  for (let c = 0; c < energy.length; c++) if (energy[c] > FRAME_THRESHOLD) candidates.push(c);
  candidates.sort((a, b) => energy[b] - energy[a] || a - b);

  for (const c of candidates) {
    if (energy[c] <= FRAME_THRESHOLD) continue; // cleared by an earlier note
    const iMid = Math.floor(c / keys);
    const f = c % keys;
    const at = (i: number) => energy[i * keys + f];
    energy[c] = 0;
    let i = iMid + 1;
    let k = 0;
    while (i < n - 1 && k < ENERGY_TOLERANCE) {
      k = at(i) < FRAME_THRESHOLD ? k + 1 : 0;
      clear(i, f);
      i += 1;
    }
    const iEnd = i - 1 - k;
    i = iMid - 1;
    k = 0;
    while (i > 0 && k < ENERGY_TOLERANCE) {
      k = at(i) < FRAME_THRESHOLD ? k + 1 : 0;
      clear(i, f);
      i -= 1;
    }
    const iStart = i + 1 + k;
    if (iEnd - iStart <= MIN_NOTE_FRAMES) continue;
    let sum = 0;
    for (let j = iStart; j < iEnd; j++) sum += frames[j][f];
    notes.push({ startFrame: iStart, durationFrames: iEnd - iStart, pitchMidi: f + MIDI_OFFSET, amplitude: sum / (iEnd - iStart) });
  }
  return notes;
}

/** Notes in seconds, as the worker posts them. */
export function decodeNotes(frames: number[][], onsets: number[][]): AudioNote[] {
  return noteFramesToTime(decodeEvents(frames, onsets)).map((n) => ({
    pitchMidi: n.pitchMidi,
    startSec: n.startTimeSeconds,
    durSec: n.durationSeconds,
    amplitude: n.amplitude,
  }));
}
