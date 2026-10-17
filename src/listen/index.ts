/**
 * Microphone + Web MIDI listening. Publishes detected notes on the input bus
 * (src/core/input.ts).
 *
 * - startMic: onset detection, then spectral confirmation of the player's expected notes
 *   (chords included), falling back to YIN monophonic pitch. Events carry source 'mic'
 *   and are already compensated by settings.micLatencyMs (override with opts.latencyMs).
 * - startPitchStream: raw per-frame pitch/level/onset stream for the tuner and settings.
 * - startMidi: all Web MIDI inputs, hot-plug aware. Null when unsupported or denied.
 */
import { startMic as startMicImpl } from './mic';
import { startMidi as startMidiImpl } from './midi';
import type { Listener, MicOptions } from './types';

export type { Listener, MicFrameInfo, MicOptions, PitchFrame, PitchStreamOptions } from './types';
export { startPitchStream } from './mic';
export { listMidiInputs } from './midi';
export { micErrorMessage, MicError } from './source';

/** Ask for the mic and start publishing noteOn events. Rejects if permission is denied. */
export async function startMic(opts: MicOptions = {}): Promise<Listener> {
  return startMicImpl(opts);
}

/** Connect Web MIDI inputs if the browser supports it (not iOS Safari). Null when unavailable. */
export async function startMidi(): Promise<Listener | null> {
  return startMidiImpl();
}

export const micSupported = (): boolean => !!navigator.mediaDevices?.getUserMedia;
export const midiSupported = (): boolean => 'requestMIDIAccess' in navigator;
