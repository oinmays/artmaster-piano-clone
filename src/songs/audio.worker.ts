/// <reference lib="webworker" />
/**
 * Audio worker (T23): runs Spotify's Basic Pitch on 22050 Hz mono samples and posts back notes.
 * Loaded by audio.ts on first use and kept for the session; TensorFlow.js and the model live
 * only here, so neither weighs on the main bundle or the offline precache.
 *
 * Backend: WebGL through OffscreenCanvas (tfjs needs WebGL 2 in a worker; Safari 17+, Chrome,
 * Firefox), else the plain CPU backend, which is correct but several times slower.
 *
 * Inference follows Basic Pitch's own evaluateModel (2 s windows, 30-frame overlap, 15 frames
 * trimmed off each side) but runs window by window and frees each window's tensors, so a
 * 6-minute file never holds the whole framed signal or every window's outputs on the GPU.
 * Notes come out of audionotes.ts (Basic Pitch's decoding with its default thresholds).
 */
import * as tf from './tf-lean';
import type { WorkerReply, WorkerRequest } from './audio';
import { decodeNotes } from './audionotes';

const SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const FPS = Math.floor(SAMPLE_RATE / FFT_HOP);
const WINDOW = SAMPLE_RATE * 2 - FFT_HOP;
const HALF_OVERLAP_FRAMES = 15;
const OVERLAP = 2 * HALF_OVERLAP_FRAMES * FFT_HOP;
const HOP = WINDOW - OVERLAP;
/** Graph output names (see Basic Pitch's inference.ts). */
const FRAMES = 'Identity_1';
const ONSETS = 'Identity_2';

type Backend = 'webgl' | 'webgl-f16' | 'cpu';

/** WebGL when a worker can get a WebGL 2 context, else CPU. 'webgl-f16': the GPU can't render 32-bit floats. */
async function pickBackend(): Promise<Backend> {
  tf.enableProdMode();
  // tfjs 3.21's browser platform tests `!window` when WebGL polls a fence, which throws in a
  // worker (no window). The custom timer is an off-by-default main-thread trick; plain setTimeout is right here.
  tf.env().platform.setTimeoutCustom = (fn: () => void, delay: number) => void setTimeout(fn, delay);
  try {
    if (typeof OffscreenCanvas !== 'undefined' && (await tf.setBackend('webgl'))) {
      // One tiny op with a read-back: throws now, not mid-file, if the context is unusable.
      tf.tidy(() => tf.add(tf.scalar(1), tf.scalar(1)).dataSync());
      return tf.env().getBool('WEBGL_RENDER_FLOAT32_CAPABLE') ? 'webgl' : 'webgl-f16';
    }
  } catch {
    // fall through to the CPU
  }
  await tf.setBackend('cpu');
  return 'cpu';
}

/** Frame and onset probabilities (rows of 88 keys, 86 rows a second) for the whole recording. */
export async function transcribe(
  model: tf.GraphModel,
  audio: Float32Array,
  onFraction: (f: number) => void,
): Promise<{ frames: number[][]; onsets: number[][] }> {
  const pad = OVERLAP / 2;
  const windows = Math.ceil((pad + audio.length) / HOP);
  const wanted = Math.floor(audio.length * (FPS / SAMPLE_RATE));
  const frames: number[][] = [];
  const onsets: number[][] = [];
  for (let i = 0; i < windows && frames.length < wanted; i++) {
    onFraction(i / windows);
    // Window i covers the zero-padded signal from i * HOP, i.e. the audio from i * HOP - pad.
    const start = i * HOP - pad;
    const from = Math.max(0, start);
    const to = Math.min(audio.length, start + WINDOW);
    const input = new Float32Array(WINDOW);
    if (to > from) input.set(audio.subarray(from, to), from - start);
    const keep = wanted - frames.length;
    const [f, o] = tf.tidy(() => {
      const out = model.execute(tf.tensor3d(input, [1, WINDOW, 1]), [FRAMES, ONSETS]) as tf.Tensor3D[];
      return out.map((t) => {
        const rows = Math.min(t.shape[1] - 2 * HALF_OVERLAP_FRAMES, keep);
        return tf.reshape(tf.slice(t, [0, HALF_OVERLAP_FRAMES, 0], [1, rows, -1]), [rows, t.shape[2]]) as tf.Tensor2D;
      });
    });
    const [fa, oa] = await Promise.all([f.array(), o.array()]);
    tf.dispose([f, o]);
    for (const row of fa) frames.push(row);
    for (const row of oa) onsets.push(row);
  }
  onFraction(1);
  return { frames, onsets };
}

// ---- Messages -----------------------------------------------------------------------------

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerReply) => scope.postMessage(msg);

let backend: Promise<Backend> | undefined;
let model: Promise<tf.GraphModel> | undefined;
/** One job at a time: a second file waits for the first instead of sharing the GPU. */
let queue: Promise<void> = Promise.resolve();

async function run({ id, audio, modelUrl }: WorkerRequest): Promise<void> {
  try {
    const used = await (backend ??= pickBackend());
    let net: tf.GraphModel;
    try {
      net = await (model ??= tf.loadGraphModel(modelUrl, { onProgress: (fraction) => post({ type: 'model', id, fraction }) }));
    } catch (err) {
      model = undefined;
      post({ type: 'error', id, model: true, message: err instanceof Error ? err.message : String(err) });
      return;
    }
    const { frames, onsets } = await transcribe(net, audio, (fraction) => post({ type: 'progress', id, fraction }));
    post({ type: 'notes', id });
    post({ type: 'done', id, notes: decodeNotes(frames, onsets), backend: used });
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req?.type === 'run') queue = queue.then(() => run(req));
};
