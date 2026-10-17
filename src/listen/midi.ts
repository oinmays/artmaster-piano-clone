/**
 * MIDI keyboards (T12). Two routes, same result: every note lands on the input bus with
 * source 'midi'.
 *
 * - Web MIDI (desktop Chrome/Edge/Firefox, Android): all inputs, hot-plug via `statechange`.
 * - The Keys iOS app: WebKit has no Web MIDI, so the app bridges CoreMIDI into the page as
 *   window CustomEvents (contract in ./platform.ts).
 *
 * Both feed raw status bytes through parseMidiMessage. All channels are accepted.
 */
import { emitNoteOff, emitNoteOn } from '../core/input';
import { NATIVE_DEVICES_EVENT, NATIVE_MIDI_EVENT } from './platform';
import type { Listener } from './types';

type MidiNav = Navigator & { requestMIDIAccess?: (o?: { sysex?: boolean }) => Promise<MIDIAccess> };

export interface MidiOptions {
  /** Connected device names: called once at start and again on every plug/unplug. */
  onDevices?: (names: string[]) => void;
}

export type MidiMessage = { type: 'on'; note: number; velocity: number } | { type: 'off'; note: number };

/**
 * Note on/off from raw bytes [status, data1, data2]; null for anything else (CC, clock,
 * sysex…). Note-on with velocity 0 is a note off, as most keyboards send it.
 */
export function parseMidiMessage(data: ArrayLike<number> | null | undefined): MidiMessage | null {
  if (!data || data.length < 2) return null;
  const cmd = data[0] & 0xf0;
  const note = data[1] & 0x7f;
  const vel = data.length > 2 ? data[2] & 0x7f : 0;
  if (cmd === 0x90 && vel > 0) return { type: 'on', note, velocity: vel };
  if (cmd === 0x80 || cmd === 0x90) return { type: 'off', note };
  return null;
}

/** The Keys iOS app's bridge, when this page runs inside it. */
const native = () => (typeof window !== 'undefined' && window.keysNative?.midi ? window.keysNative : undefined);

async function access(): Promise<MIDIAccess | null> {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as MidiNav;
  if (!nav.requestMIDIAccess) return null;
  try {
    return await nav.requestMIDIAccess({ sysex: false });
  } catch {
    return null; // denied or blocked
  }
}

const inputNames = (a: MIDIAccess): string[] => {
  const names: string[] = [];
  a.inputs.forEach((i) => {
    if (i.state !== 'disconnected') names.push(i.name || i.manufacturer || 'MIDI device');
  });
  return names;
};

/**
 * Has this site already been allowed to use MIDI? Lets screens connect quietly without
 * a permission prompt nobody asked for. 'unknown' when the browser can't say.
 */
export async function midiPermission(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  if (native()) return 'granted';
  try {
    const st = await navigator.permissions.query({ name: 'midi' as PermissionName });
    return st.state;
  } catch {
    return 'unknown';
  }
}

/** Names of connected MIDI inputs, or null when MIDI is unavailable or denied. */
export async function listMidiInputs(): Promise<string[] | null> {
  const n = native();
  if (n) return [...(n.devices ?? [])];
  const a = await access();
  return a ? inputNames(a) : null;
}

/** Turns parsed messages into bus events and remembers held keys so stop() can release them. */
function noteSink() {
  const held = new Set<number>();
  return {
    feed(data: ArrayLike<number> | null | undefined) {
      const m = parseMidiMessage(data);
      if (!m) return;
      const time = performance.now();
      if (m.type === 'on') {
        held.add(m.note);
        emitNoteOn({ midi: m.note, time, source: 'midi', velocity: m.velocity / 127 });
      } else {
        held.delete(m.note);
        emitNoteOff({ midi: m.note, time, source: 'midi' });
      }
    },
    /** Note off for every held key (stop, or the keyboard was unplugged mid-note). */
    release() {
      const now = performance.now();
      held.forEach((midi) => emitNoteOff({ midi, time: now, source: 'midi' }));
      held.clear();
    },
  };
}

function startNative(opts: MidiOptions): Listener {
  const sink = noteSink();
  const onMidi = (e: Event) => sink.feed((e as CustomEvent<{ data?: number[] }>).detail?.data);
  const onDevices = (e: Event) => {
    const names = (e as CustomEvent<{ names?: string[] }>).detail?.names ?? window.keysNative?.devices ?? [];
    if (!names.length) sink.release();
    opts.onDevices?.([...names]);
  };
  window.addEventListener(NATIVE_MIDI_EVENT, onMidi);
  window.addEventListener(NATIVE_DEVICES_EVENT, onDevices);
  opts.onDevices?.([...(window.keysNative?.devices ?? [])]);
  return {
    stop() {
      window.removeEventListener(NATIVE_MIDI_EVENT, onMidi);
      window.removeEventListener(NATIVE_DEVICES_EVENT, onDevices);
      sink.release();
    },
  };
}

/**
 * Start publishing MIDI notes: the iOS app bridge when present, else Web MIDI.
 * Null when neither is available or the user blocked MIDI access.
 */
export async function startMidi(opts: MidiOptions = {}): Promise<Listener | null> {
  if (native()) return startNative(opts);
  const a = await access();
  if (!a) return null;

  const sink = noteSink();
  const onMessage = (e: Event) => sink.feed((e as MIDIMessageEvent).data);

  const attached = new Set<MIDIInput>();
  const attachAll = () => {
    a.inputs.forEach((input) => {
      if (attached.has(input) || input.state === 'disconnected') return;
      input.addEventListener('midimessage', onMessage);
      attached.add(input);
    });
  };
  const onState = (e: Event) => {
    const port = (e as MIDIConnectionEvent).port;
    if (port?.type !== 'input') return;
    const input = port as MIDIInput;
    if (port.state === 'disconnected') {
      if (attached.has(input)) {
        input.removeEventListener('midimessage', onMessage);
        attached.delete(input);
      }
      sink.release(); // a key held on the unplugged keyboard would otherwise stick
    } else {
      attachAll();
    }
    opts.onDevices?.(inputNames(a));
  };

  attachAll();
  a.addEventListener('statechange', onState);
  opts.onDevices?.(inputNames(a));

  return {
    stop() {
      a.removeEventListener('statechange', onState);
      attached.forEach((i) => i.removeEventListener('midimessage', onMessage));
      attached.clear();
      sink.release();
    },
  };
}
