import { describe, expect, it } from 'vitest';
import {
  MAX_AUDIO_SECONDS,
  MIN_AMPLITUDE,
  MIN_NOTE_SEC,
  downmix,
  formatDuration,
  notesToMidi,
  tooLongMessage,
  type AudioNote,
} from '../src/songs/audio';
import { MidiImportError, midiToSong } from '../src/songs/midifile';
import { FRAME_THRESHOLD, MIN_NOTE_FRAMES, ONSET_THRESHOLD, decodeEvents, decodeNotes } from '../src/songs/audionotes';
import { outputToNotesPoly } from '@spotify/basic-pitch/esm/toMidi';

const note = (pitchMidi: number, startSec: number, durSec: number, amplitude = 0.5): AudioNote => ({ pitchMidi, startSec, durSec, amplitude });

describe('downmix', () => {
  it('averages channels into a new array', () => {
    const l = new Float32Array([1, 0.5, -1]);
    const r = new Float32Array([0, 0.5, 1]);
    expect([...downmix([l, r])]).toEqual([0.5, 0.5, 0]);
  });

  it('copies a single channel instead of returning it', () => {
    const mono = new Float32Array([0.25, -0.25]);
    const out = downmix([mono]);
    expect([...out]).toEqual([0.25, -0.25]);
    expect(out).not.toBe(mono);
    expect(out.buffer).not.toBe(mono.buffer);
  });

  it('uses the shortest channel and handles none', () => {
    expect(downmix([new Float32Array([1, 1, 1]), new Float32Array([1])]).length).toBe(1);
    expect(downmix([]).length).toBe(0);
  });
});

describe('duration limit', () => {
  it('formats m:ss', () => {
    expect(formatDuration(432)).toBe('7:12');
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(59.6)).toBe('1:00');
  });

  it('explains the limit', () => {
    expect(MAX_AUDIO_SECONDS).toBe(360);
    expect(tooLongMessage(432)).toBe('That recording is 7:12 long; Keys converts up to 6 minutes. Trim it, or pick a shorter version.');
  });
});

describe('notesToMidi', () => {
  it('writes a format-0, 120 bpm, ppq 480 file: one second is 960 ticks', () => {
    const midi = notesToMidi([note(60, 1, 0.5, 1), note(64, 0, 0.25, 0.4)]);
    expect(midi).toMatchObject({ format: 0, ppq: 480, tempo: 500000, timeSig: { num: 4, den: 4 }, trackNames: [''] });
    expect(midi.notes).toEqual([
      { midi: 64, start: 0, end: 240, velocity: 51, channel: 0, track: 0, program: 0 },
      { midi: 60, start: 960, end: 1440, velocity: 127, channel: 0, track: 0, program: 0 },
    ]);
  });

  it('drops short and quiet notes', () => {
    const midi = notesToMidi([
      note(60, 0, MIN_NOTE_SEC - 0.01),
      note(62, 0, 0.5, MIN_AMPLITUDE - 0.01),
      note(64, 0, MIN_NOTE_SEC, MIN_AMPLITUDE),
    ]);
    expect(midi.notes.map((n) => n.midi)).toEqual([64]);
  });

  it('keeps keys on the piano and velocities in range', () => {
    const midi = notesToMidi([note(15, 0, 1, 0.21), note(115, 1, 1, 1.4)]);
    expect(midi.notes.map((n) => [n.midi, n.velocity])).toEqual([[21, 27], [108, 127]]);
  });

  it('cuts a note short when its key is struck again, and merges same-tick twins', () => {
    const midi = notesToMidi([note(60, 0, 2), note(60, 1, 0.5), note(60, 1, 0.75, 0.9)]);
    expect(midi.notes.map((n) => [n.start, n.end, n.velocity])).toEqual([
      [0, 960, 64],
      [960, 1680, 114],
    ]);
  });

  it('throws a friendly error when nothing is left', () => {
    expect(() => notesToMidi([])).toThrow(MidiImportError);
    expect(() => notesToMidi([note(60, 0, 0.01)])).toThrow('No notes were found in that recording.');
  });

  it('becomes a song: seconds map to beats at 2 a second', () => {
    const midi = notesToMidi([note(60, 0, 0.5), note(64, 0.5, 0.5), note(67, 1, 1)]);
    const song = midiToSong(midi, { id: 't', title: 'T' });
    expect(song.bpm).toBe(120);
    const hard = [...song.levels.hard].sort((a, b) => a.start - b.start);
    expect(hard.map((n) => [n.midi, n.start, n.dur])).toEqual([[60, 0, 1], [64, 1, 1], [67, 2, 2]]);
  });
});

describe('note decoding', () => {
  /** Smooth random probabilities with held notes, some with weak onsets so the melodia pass has work. */
  function fakeOutput(rows: number, seed: number) {
    let x = seed;
    const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const frames = Array.from({ length: rows }, () => Array.from({ length: 88 }, () => rnd() * 0.2));
    const onsets = Array.from({ length: rows }, () => Array.from({ length: 88 }, () => rnd() * 0.3));
    for (let k = 0; k < rows / 4; k++) {
      const key = Math.floor(rnd() * 88);
      const at = Math.floor(rnd() * (rows - 40));
      const len = 5 + Math.floor(rnd() * 60);
      const level = 0.3 + rnd() * 0.65;
      for (let i = at; i < Math.min(rows, at + len); i++) frames[i][key] = Math.max(frames[i][key], level * (0.8 + rnd() * 0.2));
      if (rnd() < 0.5) onsets[at][key] = 0.5 + rnd() * 0.5;
    }
    return { frames, onsets };
  }
  const key = (e: { startFrame: number; durationFrames: number; pitchMidi: number; amplitude: number }) =>
    `${e.pitchMidi}@${e.startFrame}+${e.durationFrames}:${e.amplitude.toFixed(6)}`;

  it('matches Basic Pitch’s outputToNotesPoly, melodia pass included', () => {
    for (const seed of [1, 7, 42]) {
      const a = fakeOutput(800, seed);
      const b = { frames: a.frames.map((r) => r.slice()), onsets: a.onsets.map((r) => r.slice()) };
      const ours = decodeEvents(a.frames, a.onsets).map(key).sort();
      const theirs = outputToNotesPoly(b.frames, b.onsets, ONSET_THRESHOLD, FRAME_THRESHOLD, MIN_NOTE_FRAMES, true, null, null, true).map(key).sort();
      expect(ours.length).toBeGreaterThan(20);
      expect(ours.length).toBeGreaterThan(decodeEvents(a.frames.map((r) => r.slice()), a.onsets.map((r) => r.slice()), false).length);
      expect(ours).toEqual(theirs);
    }
  });

  it('reports seconds and handles silence', () => {
    expect(decodeNotes([], [])).toEqual([]);
    const { frames, onsets } = fakeOutput(400, 3);
    for (const n of decodeNotes(frames, onsets)) {
      expect(n.startSec).toBeGreaterThanOrEqual(0);
      expect(n.durSec).toBeGreaterThan(MIN_NOTE_FRAMES / 87);
    }
  });
});
