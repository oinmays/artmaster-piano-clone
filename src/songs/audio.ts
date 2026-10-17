/**
 * Audio file -> notes on the device with Spotify's Basic Pitch (T23).
 * The browser decodes the file and resamples it to 22050 Hz mono; audio.worker.ts runs the
 * model. TensorFlow.js and the model load lazily on first use (never in the main bundle or the
 * offline precache); the service worker keeps them in a long-lived cache after the first
 * download. Nothing is uploaded.
 *
 * Progress: decoding 0–10 %, loading the model 10–20 % (only while the worker hasn't got it),
 * converting 20–95 %, building notes 95–100 %. One worker serves every file in a session;
 * cancelling terminates it, and the next file starts a fresh one.
 */
import { MidiImportError, type MidiFile, type RawNote } from './midifile';

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

/** A note as the worker reports it. */
export interface AudioNote {
  pitchMidi: number;
  startSec: number;
  durSec: number;
  /** Mean frame probability over the note, 0–1. */
  amplitude: number;
}

/** Main thread -> worker. The samples are transferred, not copied. */
export type WorkerRequest = { type: 'run'; id: number; audio: Float32Array; modelUrl: string };
/** Worker -> main thread. */
export type WorkerReply =
  | { type: 'model'; id: number; fraction: number }
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'notes'; id: number }
  | { type: 'done'; id: number; notes: AudioNote[]; backend: string }
  | { type: 'error'; id: number; message: string; model?: boolean };

/** Basic Pitch's input rate. */
export const MODEL_RATE = 22050;
/** Imported songs run at 120 bpm with 480 ticks a beat: 960 ticks a second. */
const PPQ = 480;
const TEMPO = 500000;
const TICKS_PER_SEC = (PPQ * 1e6) / TEMPO;
/** Notes shorter than this are clicks and bow noise, not something to play. */
export const MIN_NOTE_SEC = 0.06;
/**
 * Notes whose mean frame probability is below this are mostly overtones and room echo of a
 * louder note (real piano notes from Basic Pitch sit around 0.3–0.7).
 */
export const MIN_AMPLITUDE = 0.2;

const DECODE_ERROR = 'Keys couldn’t read that audio file. Try an MP3, M4A or WAV.';
const NO_NOTES = 'No notes were found in that recording.';
const MODEL_OFFLINE = 'Keys needs to download its note model once (about 1 MB). Connect to the internet and try again.';
const CONVERT_ERROR = 'Keys couldn’t convert that recording. Try again, or pick a shorter file.';

/** "7:12" */
export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function tooLongMessage(sec: number): string {
  return `That recording is ${formatDuration(sec)} long; Keys converts up to ${MAX_AUDIO_SECONDS / 60} minutes. Trim it, or pick a shorter version.`;
}

/** Average the channels into one new array (never a view of the input). */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array(0);
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  if (channels.length > 1) for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The worker's notes as a format-0 MidiFile at 120 bpm (seconds × 960 = ticks). Drops notes
 * shorter than MIN_NOTE_SEC or quieter than MIN_AMPLITUDE; a key struck again before its
 * previous note ended cuts that note short. Throws MidiImportError when nothing is left.
 */
export function notesToMidi(notes: readonly AudioNote[]): MidiFile {
  const raw: RawNote[] = notes
    .filter((n) => n.durSec >= MIN_NOTE_SEC && n.amplitude >= MIN_AMPLITUDE && Number.isFinite(n.startSec))
    .map((n) => {
      const start = Math.max(0, Math.round(n.startSec * TICKS_PER_SEC));
      return {
        midi: clamp(Math.round(n.pitchMidi), 21, 108),
        start,
        end: Math.max(start + 1, Math.round((n.startSec + n.durSec) * TICKS_PER_SEC)),
        velocity: clamp(Math.round(n.amplitude * 127), 1, 127),
        channel: 0,
        track: 0,
        program: 0,
      };
    })
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  const out: RawNote[] = [];
  const sounding = new Map<number, RawNote>();
  for (const n of raw) {
    const prev = sounding.get(n.midi);
    if (prev && prev.end > n.start) {
      if (prev.start === n.start) {
        prev.end = Math.max(prev.end, n.end);
        prev.velocity = Math.max(prev.velocity, n.velocity);
        continue;
      }
      prev.end = n.start;
    }
    sounding.set(n.midi, n);
    out.push(n);
  }
  if (!out.length) throw new MidiImportError(NO_NOTES);
  return { format: 0, ppq: PPQ, tempo: TEMPO, timeSig: { num: 4, den: 4 }, trackNames: [''], notes: out };
}

// ---- Decoding -----------------------------------------------------------------------------

type AudioContextClass = typeof AudioContext;

/** Decode at 22050 Hz when the browser can (an OfflineAudioContext resamples while decoding), else at the device rate. */
async function decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  try {
    return await new OfflineAudioContext(1, 1, MODEL_RATE).decodeAudioData(bytes.slice(0));
  } catch {
    // Some Safari versions only decode MP3/M4A in a real AudioContext.
  }
  const Ctx: AudioContextClass | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  if (Ctx) {
    const ctx = new Ctx();
    try {
      return await ctx.decodeAudioData(bytes);
    } catch {
      // fall through
    } finally {
      void ctx.close().catch(() => {});
    }
  }
  throw new MidiImportError(DECODE_ERROR);
}

/** Mono samples at 22050 Hz. */
async function toModelRate(buffer: AudioBuffer): Promise<Float32Array> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  if (buffer.sampleRate === MODEL_RATE) return downmix(channels);
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * MODEL_RATE)), MODEL_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  // A one-channel destination down-mixes the source (L+R)/2 while rendering.
  return (await ctx.startRendering()).getChannelData(0).slice();
}

// ---- The worker ---------------------------------------------------------------------------

let worker: Worker | null = null;
/** True once the worker has loaded the model: later files skip the loading phase. */
let modelReady = false;
let lastBackend: string | null = null;
let nextId = 1;
const pending = new Map<number, (err: Error) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
    // The script itself failed (e.g. offline before it was ever cached).
    worker.addEventListener('error', (e) => {
      e.preventDefault();
      console.error('Keys audio worker failed:', e.message);
      stopWorker(new MidiImportError(navigator.onLine ? CONVERT_ERROR : MODEL_OFFLINE));
    });
  }
  return worker;
}

/** Terminate the worker and fail any job still waiting on it. */
function stopWorker(err: Error) {
  worker?.terminate();
  worker = null;
  modelReady = false;
  const rejects = [...pending.values()];
  pending.clear();
  for (const reject of rejects) reject(err);
}

const modelUrl = () => new URL('models/basic-pitch/model.json', document.baseURI).href;

/** Whether the service worker already holds the model weights. */
async function modelCached(url: string): Promise<boolean> {
  try {
    return !!(await caches.match(url.replace(/model\.json$/, 'group1-shard1of1.bin')));
  } catch {
    return false;
  }
}

function convert(audio: Float32Array, report: (p: number, phase: string) => void, modelLabel: string, signal?: AbortSignal) {
  return new Promise<{ notes: AudioNote[]; backend: string }>((resolve, reject) => {
    const w = getWorker();
    const id = nextId++;
    const done = () => {
      pending.delete(id);
      w.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      stopWorker(new MidiImportError(CONVERT_ERROR));
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const onMessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'model') report(10 + 10 * m.fraction, modelLabel);
      else if (m.type === 'progress') {
        modelReady = true;
        report(20 + 75 * m.fraction, 'Converting');
      } else if (m.type === 'notes') report(95, 'Building notes');
      else if (m.type === 'done') {
        done();
        resolve(m);
      } else if (m.type === 'error') {
        done();
        console.error('Keys audio conversion failed:', m.message);
        reject(new MidiImportError(m.model ? MODEL_OFFLINE : CONVERT_ERROR));
      }
    };
    pending.set(id, (err) => {
      done();
      reject(err);
    });
    w.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    const req: WorkerRequest = { type: 'run', id, audio, modelUrl: modelUrl() };
    w.postMessage(req, [audio.buffer]);
  });
}

/** Throws MidiImportError with a friendly message; a DOMException named 'AbortError' when aborted. */
export async function audioToMidi(file: Blob, opts: AudioConvertOptions = {}): Promise<AudioConvertResult> {
  const { signal, onProgress } = opts;
  let shown = '';
  const report = (p: number, phase: string) => {
    const key = `${Math.floor(p)}|${phase}`;
    if (key === shown) return;
    shown = key;
    onProgress?.(Math.floor(p), phase);
  };
  const aborted = () => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  };
  aborted();
  const name = (file as Partial<File>).name;
  if (name && !AUDIO_FILE.test(name) && !/^(audio|video)\//.test(file.type)) throw new MidiImportError(DECODE_ERROR);
  if (file.size > MAX_AUDIO_BYTES) {
    throw new MidiImportError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; Keys can load audio files up to ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`);
  }

  report(0, 'Decoding');
  const buffer = await decode(await file.arrayBuffer());
  aborted();
  const durationSec = buffer.duration;
  if (durationSec > MAX_AUDIO_SECONDS + 0.5) throw new MidiImportError(tooLongMessage(durationSec));
  report(5, 'Decoding');
  const samples = await toModelRate(buffer);
  aborted();

  let modelLabel = 'Loading the note model';
  if (!modelReady) {
    if (!(await modelCached(modelUrl()))) modelLabel = 'Downloading the note model (1 MB, first time only)';
    report(10, modelLabel);
  } else report(20, 'Converting');
  aborted();
  const { notes, backend } = await convert(samples, report, modelLabel, signal);
  lastBackend = backend;
  const midi = notesToMidi(notes);
  report(100, 'Building notes');
  return { midi, durationSec };
}

// Dev-only benchmark hook: __keysAudioBench(file) in the console. Tree-shaken from production.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__keysAudioBench = async (file: Blob) => {
    const t0 = performance.now();
    const r = await audioToMidi(file, { onProgress: (p, ph) => console.log(p, ph) });
    return { ms: Math.round(performance.now() - t0), notes: r.midi.notes.length, durationSec: r.durationSec, backend: lastBackend };
  };
}
