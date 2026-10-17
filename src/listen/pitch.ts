/**
 * Pure, DOM-free DSP for listening to a piano through a microphone.
 *
 *  - `fft` / `magnitudeSpectrum`: radix-2 FFT and a Hann-windowed, amplitude-normalised
 *    magnitude spectrum (a full-scale sine of amplitude A peaks at ~A).
 *  - `detectPitch`: YIN monophonic f0 estimator (difference function computed with the FFT),
 *    with a 0..1 clarity (1 - aperiodicity).
 *  - `confirmNotes`: "is this expected note sounding?" for 1–4 note chords, from harmonic
 *    peaks (f0, 2f0, 3f0, …) measured against a local median noise floor.
 *  - `OnsetDetector`: spectral-flux + energy-rise onsets, so a repeated note counts twice.
 *  - `RollingFloor`: adaptive noise floor (low percentile of recent RMS).
 *
 * Everything is sample-rate agnostic and safe to unit test in Node.
 */
import { BASE_GATE, BASE_MIN_RMS, BASE_MIN_SNR, DEFAULT_SENSITIVITY_FACTOR } from './sensitivity';

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

interface FftPlan {
  n: number;
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

const plans = new Map<number, FftPlan>();

function plan(n: number): FftPlan {
  let p = plans.get(n);
  if (p) return p;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  p = { n, rev, cos, sin };
  plans.set(n, p);
  return p;
}

/** In-place complex FFT (inverse when `inverse`, unscaled). Arrays must be a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { rev, cos, sin } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sgn = inverse ? -1 : 1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sgn * sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>();
function hann(n: number): Float64Array {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return w;
}

/**
 * Hann-windowed magnitude spectrum of the last `size` samples of `buf` (default: all of it,
 * which must be a power of two). Returns `size / 2` bins; bin k is at k * sampleRate / size Hz.
 * Normalised so a sine of amplitude A shows a peak of ~A.
 */
export function magnitudeSpectrum(buf: ArrayLike<number>, size = buf.length, out?: Float32Array): Float32Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const w = hann(size);
  const off = buf.length - size;
  for (let i = 0; i < size; i++) re[i] = buf[off + i] * w[i];
  fft(re, im);
  const half = size / 2;
  const mag = out && out.length === half ? out : new Float32Array(half);
  const norm = 4 / size; // 2 / sum(hann) where sum(hann) ≈ size/2
  for (let k = 0; k < half; k++) mag[k] = Math.hypot(re[k], im[k]) * norm;
  return mag;
}

export function rms(buf: ArrayLike<number>, from = 0, to = buf.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return to > from ? Math.sqrt(s / (to - from)) : 0;
}

// ---------------------------------------------------------------------------
// YIN pitch detection
// ---------------------------------------------------------------------------

export interface PitchResult {
  /** Hz; 0 when nothing periodic was found. */
  freq: number;
  /** 0..1, 1 - YIN aperiodicity at the chosen lag. > ~0.85 is a confident pitch. */
  clarity: number;
}

export interface PitchOptions {
  /** Lowest detectable f0 in Hz. Default 50 (just below A1). */
  minFreq?: number;
  /** Highest detectable f0 in Hz. Default 2200 (just above C7). */
  maxFreq?: number;
  /** YIN absolute threshold on the normalised difference. Default 0.15. */
  threshold?: number;
}

/**
 * YIN (de Cheveigné & Kawahara 2002) on the whole buffer (length must be a power of two;
 * 2048 at 44.1/48 kHz covers A1 upwards, 4096 is steadier for a tuner).
 * The difference function is d(τ) = e(0..W) + e(τ..τ+W) - 2·r(τ), with r from one FFT pair.
 */
export function detectPitch(buf: ArrayLike<number>, sampleRate: number, opts: PitchOptions = {}): PitchResult {
  const n = buf.length;
  const minFreq = opts.minFreq ?? 50;
  const maxFreq = opts.maxFreq ?? 2200;
  const threshold = opts.threshold ?? 0.15;
  const tauMax = Math.min(Math.floor(sampleRate / minFreq), Math.floor(n / 2));
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const w = n - tauMax;
  if (tauMax <= tauMin + 2) return { freq: 0, clarity: 0 };

  // Cross-correlation r(τ) = Σ_{j<W} x[j]·x[j+τ] via FFT (no wrap-around because j+τ < n).
  const aRe = new Float64Array(n);
  const aIm = new Float64Array(n);
  const xRe = new Float64Array(n);
  const xIm = new Float64Array(n);
  for (let i = 0; i < n; i++) xRe[i] = buf[i];
  for (let i = 0; i < w; i++) aRe[i] = buf[i];
  fft(aRe, aIm);
  fft(xRe, xIm);
  for (let k = 0; k < n; k++) {
    // conj(A) * X
    const r = aRe[k] * xRe[k] + aIm[k] * xIm[k];
    const i = aRe[k] * xIm[k] - aIm[k] * xRe[k];
    aRe[k] = r;
    aIm[k] = i;
  }
  fft(aRe, aIm, true);

  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + buf[i] * buf[i];
  const e0 = prefix[w];
  if (e0 < 1e-12) return { freq: 0, clarity: 0 };

  // Cumulative-mean-normalised difference d'(τ).
  const dn = new Float64Array(tauMax + 1);
  dn[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    const r = aRe[tau] / n;
    const d = Math.max(0, e0 + (prefix[tau + w] - prefix[tau]) - 2 * r);
    running += d;
    dn[tau] = running > 0 ? (d * tau) / running : 1;
  }

  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (dn[t] < threshold) {
      while (t + 1 <= tauMax && dn[t + 1] < dn[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // No dip below threshold: report the global minimum with its (low) clarity.
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (dn[t] < dn[best]) best = t;
    tau = best;
  }

  let refined = tau;
  if (tau > 1 && tau < tauMax) {
    const a = dn[tau - 1];
    const b = dn[tau];
    const c = dn[tau + 1];
    const den = a - 2 * b + c;
    if (den > 0) refined = tau + (0.5 * (a - c)) / den;
  }
  const clarity = Math.max(0, Math.min(1, 1 - dn[tau]));
  // A lag stuck at the search edge is not a real period.
  if (tau <= tauMin || tau >= tauMax) return { freq: 0, clarity: Math.min(clarity, 0.3) };
  return { freq: sampleRate / refined, clarity };
}

// ---------------------------------------------------------------------------
// Expected-note confirmation (chords)
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  a4?: number;
  /**
   * Required peak-to-local-floor magnitude ratio. Default 5 (~14 dB), the factor-1.0 value;
   * the mic listener passes minSnrFor(sensitivityFactor) (4.33 at the default sensitivity).
   */
  minSnr?: number;
  /** How far (cents) a partial may sit from its ideal frequency. Default 40. */
  tolCents?: number;
  /** Ignore peaks this far below the loudest partial in the frame. Default 0.01 (-40 dB). */
  minRelative?: number;
  /**
   * Spectrum from just before the onset. When given, a partial only counts if it rose by
   * `riseRatio`, so a note still ringing from earlier is not confirmed as freshly played.
   */
  baseline?: ArrayLike<number>;
  /** Default 1.6 (~4 dB). */
  riseRatio?: number;
}

export interface NoteEvidence {
  midi: number;
  present: boolean;
  /** Mean SNR (dB) of the partials found; 0 when none. */
  score: number;
  /** Which harmonic numbers were found. */
  found: number[];
}

interface Peak {
  bin: number;
  freq: number;
  mag: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const m = values.length >> 1;
  return values.length % 2 ? values[m] : 0.5 * (values[m - 1] + values[m]);
}

/** Local maxima of the spectrum, with log-parabolic (≈ Gaussian) frequency interpolation. */
function findPeaks(mag: ArrayLike<number>, binHz: number, minMag: number): Peak[] {
  const peaks: Peak[] = [];
  for (let k = 2; k < mag.length - 1; k++) {
    const m = mag[k];
    if (m < minMag || m <= mag[k - 1] || m < mag[k + 1]) continue;
    const a = Math.log(mag[k - 1] + 1e-12);
    const b = Math.log(m + 1e-12);
    const c = Math.log(mag[k + 1] + 1e-12);
    const den = a - 2 * b + c;
    const p = den < 0 ? (0.5 * (a - c)) / den : 0;
    const height = Math.exp(b - 0.25 * (a - c) * p);
    peaks.push({ bin: k + p, freq: (k + p) * binHz, mag: height });
  }
  return peaks;
}

/**
 * Given a magnitude spectrum (`magnitudeSpectrum` output, fftSize/2 bins) and the notes the
 * learner should be playing, decide which of them are actually sounding.
 *
 * Per note we look for spectral peaks at its partials (within ±tolCents) whose height beats
 * the local median floor by `minSnr`. Rules:
 *  - midi ≥ 84 (C6+): the fundamental alone is enough (upper partials leave the mic's band).
 *  - midi 45–83: at least two of h1..h3, one of them h1 or h2.
 *  - midi < 45: phone mics barely capture the fundamental, so two of h1..h4 including h2 or h3.
 * Octave-down guard: if unexplained peaks sit at f0/2 and 1.5·f0, the learner most likely
 * played the octave below, so the note is rejected.
 */
export function confirmNotes(
  mag: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  expected: number[],
  opts: ConfirmOptions = {},
): NoteEvidence[] {
  const a4 = opts.a4 ?? 440;
  const minSnr = opts.minSnr ?? BASE_MIN_SNR;
  const tolCents = opts.tolCents ?? 40;
  const riseRatio = opts.riseRatio ?? 1.6;
  const binHz = sampleRate / fftSize;
  const nyq = Math.min(sampleRate / 2, mag.length * binHz) * 0.95;

  let maxMag = 0;
  for (let k = 1; k < mag.length; k++) if (mag[k] > maxMag) maxMag = mag[k];
  if (maxMag <= 0) return expected.map((midi) => ({ midi, present: false, score: 0, found: [] }));
  const peaks = findPeaks(mag, binHz, maxMag * (opts.minRelative ?? 0.01));

  const floorCache = new Map<number, number>();
  const floorAt = (bin: number): number => {
    const key = Math.round(bin);
    let f = floorCache.get(key);
    if (f == null) {
      const half = Math.max(8, Math.min(64, Math.round(key * 0.25)));
      const vals: number[] = [];
      for (let k = Math.max(1, key - half); k <= Math.min(mag.length - 1, key + half); k++) vals.push(mag[k]);
      f = median(vals) + 1e-9;
      floorCache.set(key, f);
    }
    return f;
  };

  const tolFor = (freq: number): number => {
    const byCents = freq * (2 ** (tolCents / 1200) - 1);
    const cap = freq * (2 ** (48 / 1200) - 1);
    return Math.min(Math.max(byCents, 0.3 * binHz), cap);
  };

  /** Strongest qualifying peak near `freq`, as SNR (linear), or 0. */
  const partial = (freq: number, useBaseline: boolean): number => {
    if (freq >= nyq) return 0;
    const tol = tolFor(freq);
    let best = 0;
    for (const p of peaks) {
      if (Math.abs(p.freq - freq) > tol) continue;
      const snr = p.mag / floorAt(p.bin);
      if (snr < minSnr) continue;
      if (useBaseline && opts.baseline) {
        let prev = 0;
        const lo = Math.max(0, Math.floor((freq - tol) / binHz) - 1);
        const hi = Math.min(opts.baseline.length - 1, Math.ceil((freq + tol) / binHz) + 1);
        for (let k = lo; k <= hi; k++) prev = Math.max(prev, opts.baseline[k]);
        if (p.mag < prev * riseRatio) continue;
      }
      best = Math.max(best, snr);
    }
    return best;
  };

  const freqs = expected.map((m) => a4 * 2 ** ((m - 69) / 12));
  /** Is `freq` a partial (h1..h4) of some expected note? */
  const explained = (freq: number): boolean =>
    freqs.some((f0) => {
      for (let h = 1; h <= 4; h++) if (Math.abs(f0 * h - freq) <= tolFor(freq)) return true;
      return false;
    });

  return expected.map((midi, i) => {
    const f0 = freqs[i];
    const hs = midi >= 84 ? [1, 2] : midi >= 45 ? [1, 2, 3] : [1, 2, 3, 4];
    const snrs = new Map<number, number>();
    for (const h of hs) {
      const s = partial(f0 * h, true);
      if (s > 0) snrs.set(h, s);
    }
    const found = [...snrs.keys()];
    let present: boolean;
    if (midi >= 84) present = snrs.has(1);
    else if (midi >= 45) present = found.length >= 2 && (snrs.has(1) || snrs.has(2));
    else present = found.length >= 2 && (snrs.has(2) || snrs.has(3));

    if (present && !expected.includes(midi - 12)) {
      const sub = f0 / 2;
      const fifth = f0 * 1.5;
      if (!explained(sub) && !explained(fifth) && partial(sub, false) > 0 && partial(fifth, false) > 0) {
        present = false;
      }
    }
    const score = found.length
      ? found.reduce((s, h) => s + 20 * Math.log10(snrs.get(h)!), 0) / found.length
      : 0;
    return { midi, present, score, found };
  });
}

// ---------------------------------------------------------------------------
// Onsets and noise floor
// ---------------------------------------------------------------------------

/** Adaptive noise floor: a low percentile of the RMS over the last few seconds. */
export class RollingFloor {
  private hist: number[] = [];
  private value = 0;
  private sinceCalc = 0;

  constructor(
    private size = 240,
    private percentile = 0.1,
    private minimum = 1e-5,
  ) {}

  update(v: number): number {
    this.hist.push(v);
    if (this.hist.length > this.size) this.hist.shift();
    if (this.hist.length < 8 || ++this.sinceCalc >= 8) {
      this.sinceCalc = 0;
      const s = [...this.hist].sort((a, b) => a - b);
      this.value = s[Math.floor((s.length - 1) * this.percentile)];
    }
    return this.floor;
  }

  get floor(): number {
    return Math.max(this.minimum, this.value);
  }
}

export interface OnsetOptions {
  /** Refractory period between onsets. Default 70 ms. */
  minIntervalMs?: number;
  /** Flux must exceed median + k·(1.4826·MAD). Default 6. */
  k?: number;
  /** Absolute flux margin above the median. Default 0.015. */
  delta?: number;
  /** Short-term RMS rise that also counts as an onset. Default 1.8 (≈ +5 dB). */
  energyRise?: number;
  /** Highest frequency (Hz) used for flux. Default 6000. */
  maxFluxHz?: number;
  /** RMS must be this many times the noise floor, at sensitivity factor 1. Default 2.5 (≈ 8 dB). */
  gate?: number;
  /** Absolute RMS gate at sensitivity factor 1. Default 0.0008. */
  minRms?: number;
  /**
   * Sensitivity factor (sensitivityFactor() in ./sensitivity). Scales `gate` and `minRms` only.
   * Default 0.75 (settings default 50). 1.0 reproduces the pre-T16 thresholds.
   *
   * Not scaled, on purpose: `energyRise`, `k`, `delta` (flux) are ratios/relative measures of
   * change, not loudness, so a quiet note produces the same relative jump as a loud one;
   * lowering them would only add false onsets from noise flicker.
   */
  sensitivity?: number;
}

export interface OnsetFrame {
  /** Timestamp of this frame (ms, any clock). */
  time: number;
  /** RMS of the newest hop of samples. */
  rms: number;
  /** Optional magnitude spectrum (magnitudeSpectrum) for spectral flux; with no spectrum only energy is used. */
  mag?: ArrayLike<number>;
  sampleRate?: number;
}

/**
 * Real-time onset detector. Feed it one frame per hop; `process` returns true on the frame
 * where a new note starts. Uses half-wave rectified log-spectral flux with a median/MAD
 * adaptive threshold, OR a short-term RMS jump, gated on an adaptive noise floor, with
 * hysteresis (must fall back below threshold) and a refractory period.
 */
export class OnsetDetector {
  readonly floor = new RollingFloor();
  private prevLog: Float32Array | null = null;
  private fluxHist: number[] = [];
  private rmsHist: number[] = [];
  private armed = true;
  private lastOnset = -Infinity;
  private o: Required<OnsetOptions>;
  /** Last computed flux, exposed for debugging/meters. */
  flux = 0;

  constructor(opts: OnsetOptions = {}) {
    this.o = {
      minIntervalMs: 70,
      k: 6,
      delta: 0.015,
      energyRise: 1.8,
      maxFluxHz: 6000,
      gate: BASE_GATE,
      minRms: BASE_MIN_RMS,
      sensitivity: DEFAULT_SENSITIVITY_FACTOR,
      ...opts,
    };
  }

  /** Current sensitivity factor. */
  get sensitivity(): number {
    return this.o.sensitivity;
  }

  /** Change the sensitivity factor live (no reset of the floor or onset state). */
  setSensitivity(factor: number): void {
    if (Number.isFinite(factor) && factor > 0) this.o.sensitivity = factor;
  }

  /** The RMS the signal must reach to count as playing: max(floor · gate · f, minRms · f). */
  gateLevel(): number {
    const f = this.o.sensitivity;
    return Math.max(this.floor.floor * this.o.gate * f, this.o.minRms * f);
  }

  /** Whether the current frame is above the noise gate. */
  gateOpen(rmsValue: number): boolean {
    return rmsValue >= this.gateLevel();
  }

  process(f: OnsetFrame): boolean {
    this.floor.update(f.rms);
    const open = this.gateOpen(f.rms);

    // Spectral flux.
    let flux = 0;
    let fluxOnset = false;
    if (f.mag) {
      const sr = f.sampleRate ?? 48000;
      const bins = Math.min(f.mag.length, Math.max(4, Math.floor((this.o.maxFluxHz * f.mag.length * 2) / sr)));
      const cur = new Float32Array(bins);
      for (let k = 0; k < bins; k++) cur[k] = Math.log1p(1000 * f.mag[k]);
      if (this.prevLog && this.prevLog.length === bins) {
        for (let k = 1; k < bins; k++) {
          const d = cur[k] - this.prevLog[k];
          if (d > 0) flux += d;
        }
        flux /= bins;
      }
      this.prevLog = cur;
      const hist = this.fluxHist;
      const med = median([...hist]);
      const mad = median(hist.map((v) => Math.abs(v - med)));
      const thr = med + Math.max(this.o.k * 1.4826 * mad, this.o.delta);
      fluxOnset = hist.length >= 3 && flux > thr;
      hist.push(flux);
      if (hist.length > 30) hist.shift();
    }
    this.flux = flux;

    // Energy rise vs. the quietest of the last few frames, and clearly above the loudest of them
    // (by √energyRise, ≈ +2.5 dB). The second test rejects ripple: a hop (~12 ms) is shorter
    // than one cycle of 50/60 Hz mains hum or a low piano fundamental, so per-hop RMS of a
    // perfectly steady hum swings ~2× from frame to frame. Its peaks beat the troughs by 1.8×
    // but never beat earlier peaks; a real attack beats both. Without this, high sensitivity
    // (gate < ~1.6× floor) turned 50 Hz hum into a stream of onsets.
    const prevMin = this.rmsHist.length ? Math.min(...this.rmsHist) : Infinity;
    const prevMax = this.rmsHist.length ? Math.max(...this.rmsHist) : 0;
    const energyOnset =
      this.rmsHist.length >= 2 && f.rms > prevMin * this.o.energyRise && f.rms > prevMax * Math.sqrt(this.o.energyRise);
    this.rmsHist.push(f.rms);
    if (this.rmsHist.length > 5) this.rmsHist.shift();
    if (!fluxOnset && !energyOnset) this.armed = true;

    if (!open || !this.armed) return false;
    if (!(fluxOnset || energyOnset)) return false;
    if (f.time - this.lastOnset < this.o.minIntervalMs) return false;
    this.armed = false;
    this.lastOnset = f.time;
    return true;
  }
}

/** Frequency → nearest midi and cents offset, unrounded cents (for smooth needles). */
export function freqToNote(freq: number, a4 = 440): { midi: number; cents: number } {
  const exact = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}
