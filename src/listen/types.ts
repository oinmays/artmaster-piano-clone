export interface MicOptions {
  a4?: number;
  /**
   * The notes the player currently expects. When provided, the detector can
   * confirm those pitches directly (far more reliable for chords than blind
   * polyphonic detection).
   */
  expected?: () => number[];
  /**
   * Milliseconds subtracted from each emitted note's `time` to undo mic latency.
   * Defaults to the saved `settings.micLatencyMs`.
   */
  latencyMs?: number;
  /** Called every analysis frame (~80/s) for meters and diagnostics. */
  onFrame?: (f: MicFrameInfo) => void;
  /** Also run single-note pitch detection every frame and report it in `onFrame` (costs CPU). */
  livePitch?: boolean;
}

export interface MicFrameInfo {
  /** RMS of the newest samples. */
  rms: number;
  /** Adaptive noise floor (RMS). */
  floor: number;
  /** Level the sound must exceed to count as playing (RMS). */
  gate: number;
  /** True on the frame a new note starts. */
  onset: boolean;
  /** Live pitch in Hz (0 = none); only when `livePitch` is set. */
  freq: number;
  clarity: number;
}

export interface Listener {
  stop(): void;
}

/** One analysis frame for the pitch stream (tuner, meters, calibration). */
export interface PitchFrame {
  /** Hz, 0 when no confident pitch. */
  freq: number;
  /** 0..1 YIN clarity. */
  clarity: number;
  /** RMS of the newest hop of samples. */
  rms: number;
  /** performance.now() estimate of this frame. */
  time: number;
  /** True on the frame where a new sound (note or click) starts. */
  onset: boolean;
  /** Current adaptive noise floor (RMS). */
  floor: number;
}

export interface PitchStreamOptions {
  minFreq?: number;
  maxFreq?: number;
  /** Analysis window for YIN; default ~85 ms (4096 at 48 kHz). */
  windowSize?: number;
}
