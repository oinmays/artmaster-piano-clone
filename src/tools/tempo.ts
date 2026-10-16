/** Pure metronome helpers: tempo names, tap tempo, meters. No DOM, no audio. */

export const MIN_BPM = 30;
export const MAX_BPM = 260;

export const clampBpm = (bpm: number): number => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));

/** Traditional tempo marking for a bpm. */
export function tempoMarking(bpm: number): string {
  if (bpm < 66) return 'Largo';
  if (bpm < 76) return 'Adagio';
  if (bpm < 108) return 'Andante';
  if (bpm < 120) return 'Moderato';
  if (bpm < 168) return 'Allegro';
  return 'Presto';
}

export interface Meter {
  id: string;
  /** Clicks per bar. In x/8 meters each click is an eighth note. */
  beats: number;
  /** Beat indexes that start a group (drawn larger), e.g. 6/8 -> [0, 3]. */
  groups: number[];
}

export const METERS: Meter[] = [
  { id: '2/4', beats: 2, groups: [0] },
  { id: '3/4', beats: 3, groups: [0] },
  { id: '4/4', beats: 4, groups: [0] },
  { id: '5/4', beats: 5, groups: [0] },
  { id: '6/8', beats: 6, groups: [0, 3] },
  { id: '7/8', beats: 7, groups: [0, 2, 4] },
];

export const meterById = (id: string): Meter => METERS.find((m) => m.id === id) ?? METERS[2];

export const SUBDIVISIONS = [
  { id: 1, label: 'None' },
  { id: 2, label: '8ths' },
  { id: 3, label: 'Triplets' },
  { id: 4, label: '16ths' },
] as const;

/**
 * Tap tempo. Feed it timestamps in ms; it averages the intervals between the
 * last 4 taps and forgets everything after a pause of `resetMs`.
 */
export class TapTempo {
  private taps: number[] = [];
  constructor(
    private readonly window = 4,
    private readonly resetMs = 2000,
  ) {}

  /** Register a tap; returns the bpm once there are at least two taps, else null. */
  tap(nowMs: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last != null && (nowMs - last > this.resetMs || nowMs <= last)) this.taps = [];
    this.taps.push(nowMs);
    if (this.taps.length > this.window) this.taps.splice(0, this.taps.length - this.window);
    if (this.taps.length < 2) return null;
    const avg = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
    return clampBpm(60000 / avg);
  }

  get count(): number {
    return this.taps.length;
  }

  reset(): void {
    this.taps = [];
  }
}
