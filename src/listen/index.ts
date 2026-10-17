/**
 * Microphone + Web MIDI listening. Publishes detected notes on the input bus
 * (src/core/input.ts).
 *
 * - startMic: onset detection, then spectral confirmation of the player's expected notes
 *   (chords included), falling back to YIN monophonic pitch. Events carry source 'mic'
 *   and are already compensated by settings.micLatencyMs (override with opts.latencyMs).
 * - startPitchStream: raw per-frame pitch/level/onset stream for the tuner and settings.
 * - startMidi: all Web MIDI inputs (or the Keys iOS app's CoreMIDI bridge), hot-plug aware,
 *   reporting connected device names. Null when unsupported or denied.
 */
import { startMic as startMicImpl } from './mic';
import { startMidi as startMidiImpl, type MidiOptions } from './midi';
import { midiPossible } from './platform';
import type { Listener, MicOptions } from './types';

export type { Listener, MicFrameInfo, MicOptions, PitchFrame, PitchStreamOptions } from './types';
export { startPitchStream } from './mic';
export { listMidiInputs, midiPermission, parseMidiMessage, type MidiMessage, type MidiOptions } from './midi';
export { midiHelp, midiPlatform, midiPossible, type MidiHelp, type MidiPlatform } from './platform';
export { micErrorMessage, MicError } from './source';
export {
  BASE_GATE,
  BASE_MIN_RMS,
  BASE_MIN_SNR,
  DEFAULT_SENSITIVITY_FACTOR,
  gateFromFloor,
  minSnrFor,
  sensitivityFactor,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
} from './sensitivity';

/** Ask for the mic and start publishing noteOn events. Rejects if permission is denied. */
export async function startMic(opts: MicOptions = {}): Promise<Listener> {
  return startMicImpl(opts);
}

/** Connect MIDI keyboards (Web MIDI, or the iOS app bridge). Null when unavailable or denied. */
export async function startMidi(opts: MidiOptions = {}): Promise<Listener | null> {
  return startMidiImpl(opts);
}

export const micSupported = (): boolean => !!navigator.mediaDevices?.getUserMedia;
/** True when a MIDI keyboard can reach the app here: Web MIDI, or inside the Keys iOS app. */
export const midiSupported = (): boolean => midiPossible();
