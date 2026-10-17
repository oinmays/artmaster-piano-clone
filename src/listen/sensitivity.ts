/**
 * Mic sensitivity (settings.micSensitivity, 0–100) → threshold scale factor.
 *
 * The listener decides "is someone playing?" with two loudness thresholds in OnsetDetector
 * (src/listen/pitch.ts): the RMS must beat `BASE_GATE × noise floor` and an absolute
 * `BASE_MIN_RMS`. Before T16 those were fixed at 2.5× and 0.0008, which on a real piano and
 * an iPad mic only let through notes played very loudly. The sensitivity setting multiplies
 * both by one factor f:
 *
 *   gate   = max(BASE_GATE · f, MIN_GATE_RATIO)  (× noise floor, see gateRatio)
 *   minRms = BASE_MIN_RMS · f
 *   minSnr = max(BASE_MIN_SNR · √f, MIN_SNR)      (chord confirmation, see minSnrFor)
 *
 * The map is geometric in two halves (equal slider steps = equal dB steps within each half):
 *   s ≤ 50: f = 0.75 · (2/3)^((s − 50)/50)   0 → 1.125, 50 (default) → exactly 0.75
 *   s > 50: f = 0.75 · 0.4^((s − 50)/50)      100 → 0.3 (T18; was 0.5 in T16)
 * f = 1.0 (the pre-T16 behaviour) sits at s ≈ 14.5.
 *
 * Safety at the top end: the floor-relative gate never drops below 1.2× the adaptive floor
 * (reached at s ≈ 74). Steady room noise sits at the floor (it *is* the floor), so it cannot
 * hold the gate open, and onsets still need a spectral-flux spike or a +5 dB energy jump that
 * also beats the recent peak. Above s ≈ 74 the extra sensitivity comes from the absolute
 * minimum (quiet rooms) and, down to MIN_SNR, from chord confirmation.
 */
import { DEFAULT_MIC_SENSITIVITY } from '../core/store';

export const SENSITIVITY_MIN = 0;
export const SENSITIVITY_MAX = 100;
/** The settings default (DEFAULT_MIC_SENSITIVITY), maps to exactly DEFAULT_SENSITIVITY_FACTOR. */
export const SENSITIVITY_DEFAULT = DEFAULT_MIC_SENSITIVITY;

/** Factor-1.0 thresholds (what the detector used before T16). */
export const BASE_GATE = 2.5;
export const BASE_MIN_RMS = 0.0008;
export const BASE_MIN_SNR = 5;

/** The floor-relative gate never goes below this, however high the sensitivity. */
export const MIN_GATE_RATIO = 1.2;
/** Chord-confirmation SNR never goes below this (≈ 9.5 dB). */
export const MIN_SNR = 3;

/** Factor at the default sensitivity (50). */
export const DEFAULT_SENSITIVITY_FACTOR = 0.75;
/** Factor at maximum sensitivity (100). */
export const MAX_SENSITIVITY_FACTOR = 0.3;

/** 0 → 1.125, 50 (default) → 0.75, 100 → 0.3; ≈ 14.5 reproduces the pre-T16 thresholds (1.0). */
export function sensitivityFactor(sensitivity: number): number {
  if (!Number.isFinite(sensitivity)) return DEFAULT_SENSITIVITY_FACTOR;
  const s = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, sensitivity));
  const t = (s - SENSITIVITY_DEFAULT) / (SENSITIVITY_MAX - SENSITIVITY_DEFAULT);
  if (t <= 0) return DEFAULT_SENSITIVITY_FACTOR * (2 / 3) ** t;
  return DEFAULT_SENSITIVITY_FACTOR * (MAX_SENSITIVITY_FACTOR / DEFAULT_SENSITIVITY_FACTOR) ** t;
}

/**
 * Floor multiple the RMS must beat: `gate · f`, clamped at MIN_GATE_RATIO.
 * 1.125 → 2.81, 1.0 → 2.5, 0.75 → 1.875, 0.5 → 1.25, ≤ 0.48 → 1.2.
 */
export function gateRatio(factor: number, gate = BASE_GATE): number {
  return Math.max(gate * factor, MIN_GATE_RATIO);
}

/**
 * Chord-confirmation SNR for a factor. Scaled by √f, not f: the SNR is measured against the
 * local spectral floor of the same frame, so a quieter note does not lower it 1:1 the way it
 * lowers RMS. Dropping it too far turns room noise and stray overtones into false notes, so it
 * stops at MIN_SNR. 1.125 → 5.30, 1.0 → 5, 0.75 → 4.33, 0.5 → 3.54, 0.36 and below → 3.
 */
export function minSnrFor(factor: number): number {
  return Math.max(BASE_MIN_SNR * Math.sqrt(factor), MIN_SNR);
}

/** RMS a sound must exceed to count as playing, given the adaptive noise floor and a factor. */
export function gateFromFloor(floor: number, factor = DEFAULT_SENSITIVITY_FACTOR): number {
  return Math.max(floor * gateRatio(factor), BASE_MIN_RMS * factor);
}
