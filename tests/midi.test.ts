import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onNoteOff, onNoteOn } from '../src/core/input';
import type { PlayedNote } from '../src/core/types';
import { listMidiInputs, parseMidiMessage, startMidi } from '../src/listen/midi';
import { NATIVE_DEVICES_EVENT, NATIVE_MIDI_EVENT } from '../src/listen/platform';

// ---- A fake Web MIDI ----------------------------------------------------------

class FakeInput extends EventTarget {
  readonly type = 'input';
  state: 'connected' | 'disconnected' = 'connected';
  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    super();
  }
  send(bytes: number[]): void {
    const e = new Event('midimessage') as Event & { data: Uint8Array };
    e.data = Uint8Array.from(bytes);
    this.dispatchEvent(e);
  }
}

class FakeAccess extends EventTarget {
  inputs = new Map<string, FakeInput>();
  private change(port: FakeInput): void {
    const e = new Event('statechange') as Event & { port: FakeInput };
    e.port = port;
    this.dispatchEvent(e);
  }
  plug(i: FakeInput): void {
    i.state = 'connected';
    this.inputs.set(i.id, i);
    this.change(i);
  }
  unplug(i: FakeInput): void {
    i.state = 'disconnected';
    this.inputs.delete(i.id);
    this.change(i);
  }
}

const withWebMidi = (access: FakeAccess | Error) =>
  vi.stubGlobal('navigator', {
    requestMIDIAccess: () => (access instanceof Error ? Promise.reject(access) : Promise.resolve(access)),
  });

// ---- Bus capture ----------------------------------------------------------------

let ons: PlayedNote[] = [];
let offs: PlayedNote[] = [];
let unsub: (() => void)[] = [];

beforeEach(() => {
  ons = [];
  offs = [];
  unsub = [onNoteOn((n) => ons.push(n)), onNoteOff((n) => offs.push(n))];
});

afterEach(() => {
  unsub.forEach((u) => u());
  vi.unstubAllGlobals();
});

// ---- Tests ------------------------------------------------------------------------

describe('parseMidiMessage', () => {
  it('reads note on, on any channel', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({ type: 'on', note: 60, velocity: 100 });
    expect(parseMidiMessage([0x9f, 21, 1])).toEqual({ type: 'on', note: 21, velocity: 1 });
  });
  it('treats 0x80 and note on with velocity 0 as note off', () => {
    expect(parseMidiMessage([0x80, 60, 64])).toEqual({ type: 'off', note: 60 });
    expect(parseMidiMessage([0x93, 62, 0])).toEqual({ type: 'off', note: 62 });
    expect(parseMidiMessage([0x90, 62])).toEqual({ type: 'off', note: 62 });
  });
  it('ignores everything else', () => {
    expect(parseMidiMessage([0xb0, 64, 127])).toBeNull(); // sustain pedal
    expect(parseMidiMessage([0xf8])).toBeNull(); // clock
    expect(parseMidiMessage([])).toBeNull();
    expect(parseMidiMessage(null)).toBeNull();
  });
});

describe('startMidi (Web MIDI)', () => {
  it('publishes note on with velocity 0..1 and source midi', async () => {
    const a = new FakeAccess();
    const kb = new FakeInput('1', 'Yamaha P-45');
    a.inputs.set('1', kb);
    withWebMidi(a);
    const l = await startMidi();
    kb.send([0x90, 60, 127]);
    expect(ons).toHaveLength(1);
    expect(ons[0]).toMatchObject({ midi: 60, source: 'midi', velocity: 1 });
    expect(typeof ons[0].time).toBe('number');
    l!.stop();
  });

  it('note on with velocity 0 and 0x80 both emit note off', async () => {
    const a = new FakeAccess();
    const kb = new FakeInput('1', 'Keys');
    a.inputs.set('1', kb);
    withWebMidi(a);
    const l = await startMidi();
    kb.send([0x90, 60, 64]);
    kb.send([0x90, 60, 0]);
    kb.send([0x90, 62, 64]);
    kb.send([0x80, 62, 0]);
    expect(ons.map((n) => n.midi)).toEqual([60, 62]);
    expect(ons[0].velocity).toBeCloseTo(64 / 127);
    expect(offs.map((n) => [n.midi, n.source])).toEqual([
      [60, 'midi'],
      [62, 'midi'],
    ]);
    l!.stop();
    expect(offs).toHaveLength(2); // nothing held, nothing more to release
  });

  it('attaches hot-plugged inputs, reports names, and detaches on unplug', async () => {
    const a = new FakeAccess();
    withWebMidi(a);
    const seen: string[][] = [];
    const l = await startMidi({ onDevices: (n) => seen.push(n) });
    expect(seen).toEqual([[]]);

    const kb = new FakeInput('7', 'Roland FP-10');
    a.plug(kb);
    expect(seen.at(-1)).toEqual(['Roland FP-10']);
    kb.send([0x90, 64, 90]);
    expect(ons.map((n) => n.midi)).toEqual([64]);

    a.unplug(kb);
    expect(seen.at(-1)).toEqual([]);
    expect(offs.map((n) => n.midi)).toEqual([64]); // the held key is released
    kb.send([0x90, 65, 90]);
    expect(ons).toHaveLength(1);
    l!.stop();
  });

  it('stop() releases held notes and detaches', async () => {
    const a = new FakeAccess();
    const kb = new FakeInput('1', 'Keys');
    a.inputs.set('1', kb);
    withWebMidi(a);
    const l = await startMidi();
    kb.send([0x90, 60, 100]);
    kb.send([0x90, 64, 100]);
    l!.stop();
    expect(offs.map((n) => n.midi).sort()).toEqual([60, 64]);
    kb.send([0x90, 67, 100]);
    expect(ons).toHaveLength(2);
  });

  it('is null when Web MIDI is missing or denied', async () => {
    vi.stubGlobal('navigator', {});
    expect(await startMidi()).toBeNull();
    expect(await listMidiInputs()).toBeNull();
    withWebMidi(new Error('SecurityError'));
    expect(await startMidi()).toBeNull();
  });

  it('lists connected input names', async () => {
    const a = new FakeAccess();
    a.inputs.set('1', new FakeInput('1', 'Casio CT-S1'));
    withWebMidi(a);
    expect(await listMidiInputs()).toEqual(['Casio CT-S1']);
  });
});

describe('startMidi (Keys iOS app bridge)', () => {
  const nativeWindow = (devices: string[]) => {
    const w = Object.assign(new EventTarget(), { keysNative: { platform: 'ios' as const, midi: true, devices } });
    vi.stubGlobal('window', w);
    vi.stubGlobal('navigator', {}); // no Web MIDI in WebKit
    return w;
  };
  const midiEvent = (data: number[]) => new CustomEvent(NATIVE_MIDI_EVENT, { detail: { data, device: 'X' } });

  it('publishes notes from keysnative:midi events', async () => {
    const w = nativeWindow(['Yamaha P-45']);
    const seen: string[][] = [];
    const l = await startMidi({ onDevices: (n) => seen.push(n) });
    expect(l).not.toBeNull();
    expect(seen).toEqual([['Yamaha P-45']]);
    w.dispatchEvent(midiEvent([0x90, 60, 127]));
    w.dispatchEvent(midiEvent([0x90, 60, 0]));
    expect(ons[0]).toMatchObject({ midi: 60, source: 'midi', velocity: 1 });
    expect(offs.map((n) => n.midi)).toEqual([60]);
    l!.stop();
    w.dispatchEvent(midiEvent([0x90, 62, 127]));
    expect(ons).toHaveLength(1);
  });

  it('reports device changes and lists devices from the bridge', async () => {
    const w = nativeWindow([]);
    expect(await listMidiInputs()).toEqual([]);
    const seen: string[][] = [];
    const l = await startMidi({ onDevices: (n) => seen.push(n) });
    w.keysNative.devices = ['Roland FP-10'];
    w.dispatchEvent(new CustomEvent(NATIVE_DEVICES_EVENT, { detail: { names: ['Roland FP-10'] } }));
    expect(seen).toEqual([[], ['Roland FP-10']]);
    expect(await listMidiInputs()).toEqual(['Roland FP-10']);

    w.dispatchEvent(midiEvent([0x90, 48, 80]));
    w.dispatchEvent(new CustomEvent(NATIVE_DEVICES_EVENT, { detail: { names: [] } }));
    expect(seen.at(-1)).toEqual([]);
    expect(offs.map((n) => n.midi)).toEqual([48]); // unplugged mid-note: released
    l!.stop();
  });

  it('stop() releases held notes', async () => {
    const w = nativeWindow(['Keys']);
    const l = await startMidi();
    w.dispatchEvent(midiEvent([0x90, 72, 100]));
    l!.stop();
    expect(offs.map((n) => n.midi)).toEqual([72]);
  });
});
