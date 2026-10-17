/**
 * Mic sensitivity (settings.micSensitivity, 0–100) → threshold scale factor.
 *
 * The listener decides "is someone playing?" with two loudness thresholds in OnsetDetector
 * (src/listen/pitch.ts): the RMS must beat `BASE_GATE × noise floor` and an absolute
 * `BASE_MIN_RMS`. Before T16 those were fixed at 2.5× and 0.0008, which on a real piano and
 * an iPad mic only let through notes played very loudly. The sensitivity setting multiplies
 * both by one factor f:
 *
 *   gate   = BASE_GATE    · f   (× noise floor)
 *   minRms = BASE_MIN_RMS · f
 *   minSnr = BASE_MIN_SNR · √f  (chord confirmation, see minSnrFor)
 *
 * The map is geometric (equal slider steps = equal dB steps): f = 0.75 · (2/3)^((s − 50)/50),
 * so 0 → 1.125, 50 (default) → exactly 0.75, 100 → 0.5. f = 1.0 (the pre-T16 behaviour) sits
 * at s ≈ 14.5. At maximum the gate is still 1.25× the adaptive floor: steady room noise sits
 * at the floor (it *is* the floor) so it can never hold the gate open, and onsets still need a
 * spectral-flux spike or a +5 dB energy jump on top of that.
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

/** Factor at the default sensitivity (50). */
export const DEFAULT_SENSITIVITY_FACTOR = 0.75;

/** 0 → 1.125, 50 (default) → 0.75, 100 → 0.5; ≈ 14.5 reproduces the pre-T16 thresholds (1.0). */
export function sensitivityFactor(sensitivity: number): number {
  if (!Number.isFinite(sensitivity)) return DEFAULT_SENSITIVITY_FACTOR;
  const s = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, sensitivity));
  return DEFAULT_SENSITIVITY_FACTOR * (2 / 3) ** ((s - SENSITIVITY_DEFAULT) / 50);
}

/**
 * Chord-confirmation SNR for a factor. Scaled by √f, not f: the SNR is measured against the
 * local spectral floor of the same frame, so a quieter note does not lower it 1:1 the way it
 * lowers RMS. Dropping it too far turns room noise and stray overtones into false notes.
 * 1.125 → 5.30, 1.0 → 5, 0.75 → 4.33, 0.5 → 3.54.
 */
export function minSnrFor(factor: number): number {
  return BASE_MIN_SNR * Math.sqrt(factor);
}

/** RMS a sound must exceed to count as playing, given the adaptive noise floor and a factor. */
export function gateFromFloor(floor: number, factor = DEFAULT_SENSITIVITY_FACTOR): number {
  return Math.max(floor * BASE_GATE * factor, BASE_MIN_RMS * factor);
}
