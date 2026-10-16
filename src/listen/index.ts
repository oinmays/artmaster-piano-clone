/**
 * Microphone + Web MIDI listening. Publishes detected notes on the input bus
 * (src/core/input.ts). Placeholder — implemented by ticket T4.
 */

export interface MicOptions {
  a4?: number;
  /**
   * The notes the player currently expects. When provided, the detector can
   * confirm those pitches directly (far more reliable for chords than blind
   * polyphonic detection).
   */
  expected?: () => number[];
}

export interface Listener {
  stop(): void;
}

/** Ask for the mic and start publishing noteOn events. Rejects if permission is denied. */
export async function startMic(_opts: MicOptions = {}): Promise<Listener> {
  throw new Error('Microphone listening is not implemented yet');
}

/** Connect Web MIDI inputs if the browser supports it (not iOS Safari). Null when unavailable. */
export async function startMidi(): Promise<Listener | null> {
  return null;
}

export const micSupported = (): boolean => !!navigator.mediaDevices?.getUserMedia;
export const midiSupported = (): boolean => 'requestMIDIAccess' in navigator;
