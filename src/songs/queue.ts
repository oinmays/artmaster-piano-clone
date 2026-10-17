/**
 * Import queue (T24): files are processed one after another, in the background
 * (a module singleton, so it keeps going while the learner moves between screens).
 * No DOM and no window: the processor does the real work, so this runs (and is tested) in Node.
 *
 * Rules:
 * - Strictly one item works at a time, in the order added.
 * - Unsupported files are added already failed. A file with the same name, size and
 *   lastModified as one waiting, working or done in this queue is added as 'duplicate'.
 * - Cancelling a working item aborts its signal and moves on at once, even if the processor
 *   ignores the signal; its later result is ignored. (A processor that ignores the signal may
 *   still have stored the song by then: it then shows up in My songs although the row says
 *   "Cancelled". importFile checks the signal before it stores, so this is only a race.)
 * - Progress notifications are throttled to ~10 a second per item; status changes always notify.
 * - The list keeps at most MAX_ITEMS; the oldest finished items are dropped beyond that.
 */
import { AUDIO_FILE } from './audio';
import { MidiImportError } from './midifile';

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
  /** True for files Keys can't import (failed on add); `kind` is then only a placeholder. */
  unsupported?: boolean;
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

export const UNSUPPORTED_MESSAGE = 'Keys can load MIDI files (.mid) and audio files (MP3, M4A, WAV).';
export const IN_LIST_MESSAGE = 'Already in the list.';
export const FALLBACK_MESSAGE = 'Keys couldn’t read that file.';
/** Most items kept in the list; the oldest finished ones go first. */
export const MAX_ITEMS = 50;
/** Least time between two progress notifications for one item. */
const PROGRESS_MS = 100;

/** 'midi', 'audio' or null, by extension or MIME type (same rules as mine.ts fileKind). */
export function kindOf(f: File): 'midi' | 'audio' | null {
  if (/\.(midi?|kar)$/i.test(f.name) || /midi/i.test(f.type)) return 'midi';
  if (AUDIO_FILE.test(f.name) || f.type.startsWith('audio/')) return 'audio';
  return null;
}

export const isFinished = (s: QueueStatus) => s !== 'waiting' && s !== 'working';

export interface QueueSummary {
  /** Items not cancelled. */
  total: number;
  done: number;
  failed: number;
  duplicate: number;
  waiting: number;
  /** The item being imported now, if any. */
  working?: QueueItem;
}

/**
 * Counts for a compact badge. While busy, "Importing {done + failed + duplicate + 1} of {total}…"
 * reads right for the current list (cleared or dropped items no longer count).
 */
export function summary(items: QueueItem[]): QueueSummary {
  const s: QueueSummary = { total: 0, done: 0, failed: 0, duplicate: 0, waiting: 0 };
  for (const it of items) {
    if (it.status === 'cancelled') continue;
    s.total++;
    if (it.status === 'done') s.done++;
    else if (it.status === 'failed') s.failed++;
    else if (it.status === 'duplicate') s.duplicate++;
    else if (it.status === 'waiting') s.waiting++;
    else s.working = { ...it };
  }
  return s;
}

interface Entry {
  item: QueueItem;
  file: File;
  key: string;
  /** Set while working. */
  abort?: AbortController;
  /** Resolves the race against the processor when cancelled while working. */
  stop?: () => void;
  lastNotify: number;
  timer?: ReturnType<typeof setTimeout>;
}

const fileKey = (f: File) => `${f.name}\u0000${f.size}\u0000${f.lastModified}`;
const isAbort = (e: unknown) => typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

export function createQueue(process: Processor): ImportQueue {
  let list: Entry[] = [];
  const listeners = new Set<(items: QueueItem[]) => void>();
  let running = false;
  let seq = 0;

  const snapshot = (): QueueItem[] => list.map((e) => ({ ...e.item }));

  function notify(): void {
    const items = snapshot();
    for (const fn of [...listeners]) {
      try {
        fn(items);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function clearTimer(e: Entry): void {
    if (e.timer !== undefined) clearTimeout(e.timer);
    e.timer = undefined;
  }

  /** Finish an entry (any terminal status) and notify. */
  function settle(e: Entry, patch: Partial<QueueItem>): void {
    clearTimer(e);
    e.abort = undefined;
    e.stop = undefined;
    e.item = { ...e.item, phase: undefined, ...patch };
    trim();
    notify();
  }

  function trim(): void {
    let extra = list.length - MAX_ITEMS;
    if (extra <= 0) return;
    list = list.filter((e) => !(extra > 0 && isFinished(e.item.status) && extra-- > 0));
  }

  function progressFor(e: Entry, percent: number, phase?: string): void {
    if (e.item.status !== 'working') return;
    const p = Number.isFinite(percent) ? Math.round(Math.min(100, Math.max(0, percent))) : e.item.progress;
    const ph = phase ?? e.item.phase;
    if (p === e.item.progress && ph === e.item.phase) return;
    e.item = { ...e.item, progress: p, phase: ph };
    const wait = e.lastNotify + PROGRESS_MS - Date.now();
    if (wait <= 0) {
      clearTimer(e);
      e.lastNotify = Date.now();
      notify();
    } else {
      e.timer ??= setTimeout(() => {
        e.timer = undefined;
        if (e.item.status !== 'working') return;
        e.lastNotify = Date.now();
        notify();
      }, wait);
    }
  }

  async function runOne(e: Entry): Promise<void> {
    const abort = new AbortController();
    e.abort = abort;
    e.item = { ...e.item, status: 'working', progress: 0, phase: undefined };
    e.lastNotify = Date.now();
    notify();

    const stopped = new Promise<{ stopped: true }>((resolve) => (e.stop = () => resolve({ stopped: true })));
    const ctx: ProcessContext = { signal: abort.signal, onProgress: (p, ph) => progressFor(e, p, ph) };
    const work = Promise.resolve()
      .then(() => process(e.file, ctx))
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
    const out = await Promise.race([work, stopped]);

    if ('stopped' in out || abort.signal.aborted || e.item.status !== 'working') {
      // cancel() has already settled it; nothing to do.
      if (e.item.status === 'working') settle(e, { status: 'cancelled' });
      return;
    }
    if ('result' in out) {
      const { songId, multiTrack } = out.result;
      settle(e, { status: 'done', progress: 100, songId, ...(multiTrack ? { multiTrack: true } : {}) });
      return;
    }
    const err = out.error;
    if (err instanceof DuplicateSongError) settle(e, { status: 'duplicate', error: err.message, songId: err.songId });
    else if (isAbort(err)) settle(e, { status: 'cancelled' });
    else if (err instanceof MidiImportError && err.message) settle(e, { status: 'failed', error: err.message });
    else {
      console.warn('Import failed:', err);
      settle(e, { status: 'failed', error: FALLBACK_MESSAGE });
    }
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (let next = list.find((e) => e.item.status === 'waiting'); next; next = list.find((e) => e.item.status === 'waiting')) {
        await runOne(next);
      }
    } finally {
      running = false;
    }
  }

  function cancelEntry(e: Entry): boolean {
    if (e.item.status === 'waiting') {
      e.item = { ...e.item, status: 'cancelled' };
      return true;
    }
    if (e.item.status === 'working') {
      const stop = e.stop;
      e.abort?.abort();
      clearTimer(e);
      e.abort = undefined;
      e.stop = undefined;
      e.item = { ...e.item, status: 'cancelled', phase: undefined };
      stop?.();
      return true;
    }
    return false;
  }

  return {
    add(files) {
      const added: Entry[] = [];
      for (const file of files) {
        const key = fileKey(file);
        const kind = kindOf(file);
        const item: QueueItem = { id: `q${++seq}`, name: file.name, kind: kind ?? 'midi', size: file.size, status: 'waiting', progress: 0 };
        if (!kind) Object.assign(item, { status: 'failed', error: UNSUPPORTED_MESSAGE, unsupported: true });
        else {
          const twin = list.find((e) => e.key === key && (e.item.status === 'waiting' || e.item.status === 'working' || e.item.status === 'done'));
          if (twin) Object.assign(item, { status: 'duplicate', error: IN_LIST_MESSAGE, ...(twin.item.songId ? { songId: twin.item.songId } : {}) });
        }
        const e: Entry = { item, file, key, lastNotify: 0 };
        list.push(e);
        added.push(e);
      }
      if (!added.length) return [];
      trim();
      notify();
      if (added.some((e) => e.item.status === 'waiting')) void Promise.resolve().then(pump);
      return added.map((e) => ({ ...e.item }));
    },
    cancel(id) {
      const e = list.find((x) => x.item.id === id);
      if (e && cancelEntry(e)) notify();
    },
    cancelAll() {
      let changed = false;
      // Waiting first, so cancelling the working one doesn't start the next.
      for (const e of list) if (e.item.status === 'waiting') changed = cancelEntry(e) || changed;
      for (const e of list) changed = cancelEntry(e) || changed;
      if (changed) notify();
    },
    clearFinished() {
      const before = list.length;
      list = list.filter((e) => !isFinished(e.item.status));
      if (list.length !== before) notify();
    },
    items: snapshot,
    busy: () => list.some((e) => !isFinished(e.item.status)),
    subscribe(fn) {
      listeners.add(fn);
      fn(snapshot());
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
