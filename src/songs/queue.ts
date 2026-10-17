/**
 * Import queue (T24 — stub): files are processed one after another, in the background
 * (a module singleton, so it keeps going while the learner moves between screens).
 */
export type QueueStatus = 'waiting' | 'working' | 'done' | 'failed' | 'cancelled' | 'duplicate';

export interface QueueItem {
  id: string;
  name: string;
  kind: 'midi' | 'audio';
  size: number;
  status: QueueStatus;
  /** 0–100 while working. */
  progress: number;
  /** Short label while working, e.g. "Converting". */
  phase?: string;
  /** Reason, shown as is, for failed and duplicate items. */
  error?: string;
  /** The stored song, for done items (and the existing one for duplicates). */
  songId?: string;
  /** True when the done song came from a multi-track MIDI file (offer "Pick tracks"). */
  multiTrack?: boolean;
}

export interface ProcessContext {
  signal: AbortSignal;
  onProgress: (percent: number, phase?: string) => void;
}
export interface ProcessResult {
  songId: string;
  multiTrack?: boolean;
}
export type Processor = (file: File, ctx: ProcessContext) => Promise<ProcessResult>;

/** Thrown by a Processor when the file is already in My songs. */
export class DuplicateSongError extends Error {
  constructor(message: string, readonly songId: string) {
    super(message);
  }
}

export interface ImportQueue {
  /** Queue files (MIDI and audio; anything else is added as failed). Returns the new items. */
  add(files: File[]): QueueItem[];
  cancel(id: string): void;
  cancelAll(): void;
  /** Drop done, failed, cancelled and duplicate items from the list. */
  clearFinished(): void;
  items(): QueueItem[];
  /** True while any item is waiting or working. */
  busy(): boolean;
  /** Called now and on every change. Returns an unsubscribe function. */
  subscribe(fn: (items: QueueItem[]) => void): () => void;
}

export function createQueue(_process: Processor): ImportQueue {
  throw new Error('T24: createQueue not built yet');
}
