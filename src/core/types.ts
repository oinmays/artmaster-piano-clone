/** Shared contracts. Every module builds against these; change them only in the core ticket. */

export type Hand = 'L' | 'R';
export type Level = 'easy' | 'medium' | 'hard';
export type HandsMode = 'both' | 'L' | 'R';

/** One note in a song. Times are in beats (quarter notes), not seconds. */
export interface NoteEvent {
  midi: number;
  start: number;
  dur: number;
  hand: Hand;
}

export interface Song {
  id: string;
  title: string;
  composer: string;
  /** Short line shown on the card, e.g. "Romantic · 1810". */
  blurb: string;
  bpm: number;
  beatsPerBar: number;
  /** e.g. "C major". */
  key: string;
  tags: string[];
  levels: Record<Level, NoteEvent[]>;
}

/** Options chosen on the song screen and passed to the player in the URL. */
export interface PlayOptions {
  songId: string;
  level: Level;
  hands: HandsMode;
  /** Percentage of the song's bpm, 25–150. */
  tempo: number;
  /** Wait mode: the music pauses until the right note is played. */
  wait: boolean;
  /** Optional loop, in bars (1-based, inclusive). */
  loopFrom?: number;
  loopTo?: number;
}

/** A note the learner played, from any input source. */
export interface PlayedNote {
  midi: number;
  /**
   * performance.now() timestamp in ms of the note's attack. Mic events are already
   * compensated for settings.micLatencyMs; consumers must not subtract it again.
   */
  time: number;
  source: 'touch' | 'mic' | 'midi';
  velocity?: number;
}

export interface PlayResult {
  songId: string;
  level: Level;
  hands: HandsMode;
  tempo: number;
  wait: boolean;
  notesTotal: number;
  notesHit: number;
  /** Hits whose timing was within the "perfect" window. */
  perfect: number;
  early: number;
  late: number;
  missed: number;
  /** Wrong notes played (not counted against notesTotal). */
  wrong: number;
  /** 0–100. */
  accuracy: number;
  /** 0–100; only meaningful when wait=false. */
  timing: number;
  stars: 0 | 1 | 2 | 3;
  durationMs: number;
  at: number;
}

/** A screen mounts into `root` and may return a cleanup function. */
export type Screen = (
  root: HTMLElement,
  params: Record<string, string>,
) => void | (() => void);
