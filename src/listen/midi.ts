/**
 * Web MIDI input (desktop Chrome/Edge/Firefox, Android). iOS Safari has no Web MIDI.
 * Every connected input publishes to the input bus with source 'midi'; devices plugged
 * in later are picked up through `statechange`.
 */
import { emitNoteOff, emitNoteOn } from '../core/input';
import type { Listener } from './types';

type MidiNav = Navigator & { requestMIDIAccess?: (o?: { sysex?: boolean }) => Promise<MIDIAccess> };

async function access(): Promise<MIDIAccess | null> {
  const nav = navigator as MidiNav;
  if (!nav.requestMIDIAccess) return null;
  try {
    return await nav.requestMIDIAccess({ sysex: false });
  } catch {
    return null; // denied or blocked
  }
}

/** Names of connected MIDI inputs, or null when Web MIDI is unavailable or denied. */
export async function listMidiInputs(): Promise<string[] | null> {
  const a = await access();
  if (!a) return null;
  const names: string[] = [];
  a.inputs.forEach((i) => names.push(i.name || i.manufacturer || 'MIDI device'));
  return names;
}

export async function startMidi(): Promise<Listener | null> {
  const a = await access();
  if (!a) return null;

  const held = new Set<number>();
  const onMessage = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (!d || d.length < 2) return;
    const cmd = d[0] & 0xf0;
    const note = d[1];
    const vel = d.length > 2 ? d[2] : 0;
    const time = performance.now();
    if (cmd === 0x90 && vel > 0) {
      held.add(note);
      emitNoteOn({ midi: note, time, source: 'midi', velocity: vel / 127 });
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      held.delete(note);
      emitNoteOff({ midi: note, time, source: 'midi' });
    }
  };

  const attached = new Set<MIDIInput>();
  const attachAll = () => {
    a.inputs.forEach((input) => {
      if (attached.has(input) || input.state === 'disconnected') return;
      input.addEventListener('midimessage', onMessage as EventListener);
      attached.add(input);
    });
  };
  const onState = (e: Event) => {
    const port = (e as MIDIConnectionEvent).port;
    if (port?.type !== 'input') return;
    const input = port as MIDIInput;
    if (port.state === 'disconnected' && attached.has(input)) {
      input.removeEventListener('midimessage', onMessage as EventListener);
      attached.delete(input);
    } else {
      attachAll();
    }
  };

  attachAll();
  a.addEventListener('statechange', onState);

  return {
    stop() {
      a.removeEventListener('statechange', onState);
      attached.forEach((i) => i.removeEventListener('midimessage', onMessage as EventListener));
      attached.clear();
      const now = performance.now();
      held.forEach((midi) => emitNoteOff({ midi, time: now, source: 'midi' }));
      held.clear();
    },
  };
}
