/**
 * Microphone capture → a steady stream of analysis frames (~80 per second).
 *
 * Preferred path: an AudioWorklet (loaded from a Blob URL) that posts hop-sized chunks
 * into a ring buffer. Fallback: an AnalyserNode polled on a timer. Both deliver the
 * latest `windowSize` samples plus the hop length and a performance.now() timestamp.
 */
import { getAudioContext, setAudioSession } from '../core/audio';

export interface RawFrame {
  /** Latest samples, newest last. Reused between frames: copy if you keep it. */
  samples: Float32Array;
  /** How many of the newest samples are new since the previous frame. */
  hop: number;
  /** performance.now() estimate of the newest sample. */
  time: number;
  sampleRate: number;
}

export interface MicSource {
  sampleRate: number;
  stop(): void;
}

const WORKLET = `
class KeysTap extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.hop = (o.processorOptions && o.processorOptions.hop) || 512;
    this.buf = new Float32Array(this.hop);
    this.n = 0;
    this.alive = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.alive = false; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.hop) {
          this.port.postMessage({ s: this.buf, t: currentTime + (i + 1) / sampleRate }, [this.buf.buffer]);
          this.buf = new Float32Array(this.hop);
          this.n = 0;
        }
      }
    }
    return this.alive;
  }
}
registerProcessor('keys-tap', KeysTap);
`;

const workletLoaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

function loadWorklet(ctx: AudioContext): Promise<boolean> {
  let p = workletLoaded.get(ctx);
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch {
        return false;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    workletLoaded.set(ctx, p);
  }
  return p;
}

// Several listeners (e.g. a meter and a calibration) may hold the mic; only the last
// one to stop puts the audio session back to "playback".
let sessionUsers = 0;

export class MicError extends Error {
  constructor(
    public code: 'insecure' | 'unsupported' | 'denied' | 'no-device' | 'busy' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'MicError';
  }
}

/** A sentence a screen can show for any error thrown while starting the mic. */
export function micErrorMessage(err: unknown): string {
  const code =
    err instanceof MicError
      ? err.code
      : (err as { name?: string })?.name === 'NotAllowedError' || (err as { name?: string })?.name === 'SecurityError'
        ? 'denied'
        : (err as { name?: string })?.name === 'NotFoundError'
          ? 'no-device'
          : (err as { name?: string })?.name === 'NotReadableError'
            ? 'busy'
            : 'unknown';
  switch (code) {
    case 'insecure':
      return 'The microphone only works over a secure (https://) connection. Open the app from its https address.';
    case 'unsupported':
      return "This browser can't use the microphone. On iPhone or iPad, use Safari.";
    case 'denied':
      return 'Microphone access was blocked. In Safari, tap "aA" in the address bar → Website Settings → Microphone → Allow, then try again. In the installed app: Settings → Safari → Microphone.';
    case 'no-device':
      return 'No microphone was found on this device.';
    case 'busy':
      return 'The microphone is in use by another app (a call or recording?). Close it and try again.';
    default:
      return `Couldn't start the microphone${err instanceof Error && err.message ? `: ${err.message}` : '.'}`;
  }
}

export interface OpenOptions {
  /** Samples per frame delivered. Default: next power of two ≥ 85 ms. */
  windowSize?: number;
  /** Frames per second to aim for. Default 80. */
  rate?: number;
}

/**
 * Ask for the mic (rejects with MicError / DOMException) and call `onFrame` ~80×/s.
 * Call from a user gesture on iOS (after `unlockAudio()`).
 */
export async function openMic(onFrame: (f: RawFrame) => void, opts: OpenOptions = {}): Promise<MicSource> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new MicError('insecure', 'Insecure context');
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError('unsupported', 'getUserMedia unavailable');

  // Must happen before getUserMedia, or iOS keeps the playback-only category.
  setAudioSession('play-and-record');
  sessionUsers++;
  let released = false;
  const releaseSession = () => {
    if (released) return;
    released = true;
    sessionUsers = Math.max(0, sessionUsers - 1);
    if (sessionUsers === 0) setAudioSession('playback');
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (e) {
    releaseSession();
    throw e;
  }

  const ctx = getAudioContext();
  // iOS may suspend/interrupt the context when capture starts.
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      /* resumed by the next gesture */
    }
  }

  const sr = ctx.sampleRate;
  const windowSize = opts.windowSize ?? 2 ** Math.ceil(Math.log2(sr * 0.085));
  const hop = Math.max(128, Math.round(sr / (opts.rate ?? 80)));
  const source = ctx.createMediaStreamSource(stream);
  const sink = ctx.createGain();
  sink.gain.value = 0; // keep the node pulled by the graph without making a sound
  sink.connect(ctx.destination);

  const ring = new Float32Array(windowSize);
  let stopped = false;
  let teardown: () => void;

  if (await loadWorklet(ctx)) {
    const node = new AudioWorkletNode(ctx, 'keys-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { hop },
    });
    node.port.onmessage = (e: MessageEvent<{ s: Float32Array; t: number }>) => {
      if (stopped) return;
      const chunk = e.data.s;
      const n = chunk.length;
      ring.copyWithin(0, n);
      ring.set(chunk, windowSize - n);
      const time = performance.now() - (ctx.currentTime - e.data.t) * 1000;
      onFrame({ samples: ring, hop: n, time, sampleRate: sr });
    };
    source.connect(node).connect(sink);
    teardown = () => {
      node.port.onmessage = null;
      node.port.postMessage('stop');
      try {
        source.disconnect();
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  } else {
    const an = ctx.createAnalyser();
    an.fftSize = Math.min(32768, Math.max(2048, windowSize));
    an.smoothingTimeConstant = 0;
    source.connect(an).connect(sink);
    const data = new Float32Array(an.fftSize);
    let last = performance.now();
    const timer = window.setInterval(() => {
      if (stopped) return;
      an.getFloatTimeDomainData(data);
      const now = performance.now();
      const newSamples = Math.min(windowSize, Math.max(1, Math.round(((now - last) / 1000) * sr)));
      last = now;
      ring.set(data.subarray(data.length - windowSize));
      onFrame({ samples: ring, hop: newSamples, time: now, sampleRate: sr });
    }, Math.round(1000 / (opts.rate ?? 80)));
    teardown = () => {
      clearInterval(timer);
      try {
        source.disconnect();
        an.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  return {
    sampleRate: sr,
    stop() {
      if (stopped) return;
      stopped = true;
      teardown();
      try {
        sink.disconnect();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((t) => t.stop());
      releaseSession();
    },
  };
}
