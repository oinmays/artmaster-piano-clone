import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DuplicateSongError,
  FALLBACK_MESSAGE,
  IN_LIST_MESSAGE,
  MAX_ITEMS,
  UNSUPPORTED_MESSAGE,
  createQueue,
  summary,
  type ProcessContext,
  type ProcessResult,
  type QueueItem,
} from '../src/songs/queue';
import { MidiImportError } from '../src/songs/midifile';

let stamp = 1_700_000_000_000;
const file = (name: string, type = '', bytes = 8) => new File([new Uint8Array(bytes)], name, { type, lastModified: stamp++ });
const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A processor whose jobs the test finishes by hand. */
function manual() {
  const jobs: { file: File; ctx: ProcessContext; resolve: (r: ProcessResult) => void; reject: (e: unknown) => void }[] = [];
  const process = (f: File, ctx: ProcessContext) =>
    new Promise<ProcessResult>((resolve, reject) => {
      jobs.push({ file: f, ctx, resolve, reject });
    });
  return { jobs, process };
}

/** Like manual(), but rejects with an AbortError when the signal aborts. */
function honouring() {
  const m = manual();
  const process = (f: File, ctx: ProcessContext) => {
    const p = m.process(f, ctx);
    ctx.signal.addEventListener('abort', () => m.jobs.find((j) => j.ctx === ctx)?.reject(new DOMException('Aborted', 'AbortError')));
    return p;
  };
  return { jobs: m.jobs, process };
}

const statuses = (items: QueueItem[]) => items.map((i) => i.status);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('import queue', () => {
  it('processes items one at a time, in order', async () => {
    let active = 0;
    let most = 0;
    const order: string[] = [];
    const q = createQueue(async (f) => {
      active++;
      most = Math.max(most, active);
      order.push(f.name);
      await settle();
      active--;
      return { songId: `s-${f.name}` };
    });
    q.add([file('a.mid'), file('b.mp3'), file('c.wav')]);
    while (q.busy()) await settle();
    expect(most).toBe(1);
    expect(order).toEqual(['a.mid', 'b.mp3', 'c.wav']);
    expect(q.items().map((i) => [i.status, i.songId, i.progress])).toEqual([
      ['done', 's-a.mid', 100],
      ['done', 's-b.mp3', 100],
      ['done', 's-c.wav', 100],
    ]);
  });

  it('classifies kinds by extension and MIME type', () => {
    const q = createQueue(() => new Promise(() => {}));
    const items = q.add([file('a.MID'), file('b.kar'), file('noext', 'audio/midi'), file('c.m4a'), file('d.flac'), file('e', 'audio/ogg')]);
    expect(items.map((i) => i.kind)).toEqual(['midi', 'midi', 'midi', 'audio', 'audio', 'audio']);
    expect(statuses(items)).toEqual(Array(6).fill('waiting'));
  });

  it('adds unsupported files as failed without processing them', async () => {
    const process = vi.fn(async () => ({ songId: 'x' }));
    const q = createQueue(process);
    const [it] = q.add([file('notes.pdf', 'application/pdf')]);
    expect(it).toMatchObject({ status: 'failed', error: UNSUPPORTED_MESSAGE, unsupported: true });
    await settle();
    expect(process).not.toHaveBeenCalled();
    expect(q.busy()).toBe(false);
  });

  it('reports progress, clamped and rounded, with the phase', async () => {
    const { jobs, process } = manual();
    const q = createQueue(process);
    q.add([file('a.mp3')]);
    await tick();
    jobs[0].ctx.onProgress(41.6, 'Converting');
    expect(q.items()[0]).toMatchObject({ status: 'working', progress: 42, phase: 'Converting' });
    jobs[0].ctx.onProgress(140);
    expect(q.items()[0]).toMatchObject({ progress: 100, phase: 'Converting' });
    jobs[0].ctx.onProgress(-5, 'Reading');
    expect(q.items()[0]).toMatchObject({ progress: 0, phase: 'Reading' });
    jobs[0].resolve({ songId: 's1', multiTrack: true });
    await settle();
    expect(q.items()[0]).toMatchObject({ status: 'done', progress: 100, songId: 's1', multiTrack: true });
    expect(q.items()[0].phase).toBeUndefined();
  });

  it('throttles progress notifications but always notifies status changes', async () => {
    vi.useFakeTimers();
    const { jobs, process } = manual();
    const q = createQueue(process);
    const seen: QueueItem[][] = [];
    q.subscribe((items) => seen.push(items));
    q.add([file('a.mp3')]);
    await tick();
    const before = seen.length; // initial + added + working
    expect(seen.at(-1)![0].status).toBe('working');
    for (let p = 1; p <= 20; p++) jobs[0].ctx.onProgress(p, 'Converting');
    expect(seen.length).toBe(before); // within 100 ms of starting: deferred
    vi.advanceTimersByTime(120);
    expect(seen.length).toBe(before + 1);
    expect(seen.at(-1)![0].progress).toBe(20);
    jobs[0].resolve({ songId: 's' });
    await vi.runAllTimersAsync();
    expect(seen.at(-1)![0].status).toBe('done');
  });

  it('cancels a waiting item at once', async () => {
    const { jobs, process } = manual();
    const q = createQueue(process);
    const [, b] = q.add([file('a.mid'), file('b.mid')]);
    q.cancel(b.id);
    expect(statuses(q.items())).toEqual(['waiting', 'cancelled']);
    await tick();
    jobs[0].resolve({ songId: 's' });
    await settle();
    expect(jobs).toHaveLength(1);
    expect(statuses(q.items())).toEqual(['done', 'cancelled']);
  });

  it('cancels a working item through its signal and moves on', async () => {
    const { jobs, process } = honouring();
    const q = createQueue(process);
    const [a] = q.add([file('a.mp3'), file('b.mp3')]);
    await tick();
    q.cancel(a.id);
    expect(jobs[0].ctx.signal.aborted).toBe(true);
    expect(q.items()[0].status).toBe('cancelled');
    await settle();
    expect(jobs).toHaveLength(2);
    expect(statuses(q.items())).toEqual(['cancelled', 'working']);
  });

  it('moves on even when the processor ignores the signal, and ignores its late result', async () => {
    const { jobs, process } = manual();
    const q = createQueue(process);
    const [a] = q.add([file('a.mp3'), file('b.mp3')]);
    await tick();
    q.cancel(a.id);
    await settle();
    expect(jobs).toHaveLength(2);
    jobs[0].ctx.onProgress(50);
    jobs[0].resolve({ songId: 'late' });
    await settle();
    expect(q.items()[0]).toMatchObject({ status: 'cancelled', progress: 0 });
    expect(q.items()[0].songId).toBeUndefined();
  });

  it('treats an AbortError from the processor as cancelled', async () => {
    const q = createQueue(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    q.add([file('a.mid')]);
    await settle();
    expect(q.items()[0].status).toBe('cancelled');
  });

  it('cancelAll stops the working item and everything waiting', async () => {
    const { jobs, process } = honouring();
    const q = createQueue(process);
    q.add([file('a.mid'), file('b.mid'), file('c.mid')]);
    await tick();
    q.cancelAll();
    await settle();
    expect(statuses(q.items())).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(jobs).toHaveLength(1);
    expect(q.busy()).toBe(false);
  });

  it('marks DuplicateSongError as duplicate with the existing song', async () => {
    const q = createQueue(async () => {
      throw new DuplicateSongError('Already in My songs as “Für Elise”.', 'my-123');
    });
    q.add([file('fur.mid')]);
    await settle();
    expect(q.items()[0]).toMatchObject({ status: 'duplicate', error: 'Already in My songs as “Für Elise”.', songId: 'my-123' });
  });

  it('shows a MidiImportError message as is', async () => {
    const q = createQueue(async () => {
      throw new MidiImportError('That file is 2.0 MB; Keys can load MIDI files up to 1 MB.');
    });
    q.add([file('big.mid')]);
    await settle();
    expect(q.items()[0]).toMatchObject({ status: 'failed', error: 'That file is 2.0 MB; Keys can load MIDI files up to 1 MB.' });
  });

  it('shows a friendly fallback for other errors and logs the original', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = new TypeError('x is undefined');
    const q = createQueue(async () => {
      throw boom;
    });
    q.add([file('a.mid')]);
    await settle();
    expect(q.items()[0]).toMatchObject({ status: 'failed', error: FALLBACK_MESSAGE });
    expect(warn).toHaveBeenCalledWith(expect.any(String), boom);
  });

  it('keeps going after a failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const q = createQueue(async (f) => {
      if (f.name === 'bad.mid') throw new Error('nope');
      return { songId: f.name };
    });
    q.add([file('bad.mid'), file('good.mid')]);
    while (q.busy()) await settle();
    expect(statuses(q.items())).toEqual(['failed', 'done']);
  });

  it('adds the same file twice as a duplicate in the list', async () => {
    const q = createQueue(async () => ({ songId: 'my-1' }));
    const f = file('a.mid');
    const [, again] = q.add([f, f]);
    expect(again).toMatchObject({ status: 'duplicate', error: IN_LIST_MESSAGE });
    await settle();
    const [third] = q.add([f]);
    expect(third).toMatchObject({ status: 'duplicate', songId: 'my-1' });
    // Same name but a different file is fine.
    const [other] = q.add([new File([new Uint8Array(9)], 'a.mid', { lastModified: 1 })]);
    expect(other.status).toBe('waiting');
  });

  it('allows a file again after it failed or was cancelled', async () => {
    const q = createQueue(() => new Promise(() => {}));
    const f = file('a.mid');
    const [a] = q.add([f]);
    q.cancel(a.id);
    const [b] = q.add([f]);
    expect(b.status).toBe('waiting');
  });

  it('clearFinished drops finished items only', async () => {
    const { jobs, process } = manual();
    const q = createQueue(process);
    q.add([file('a.mid'), file('x.txt'), file('b.mid')]);
    await tick();
    jobs[0].resolve({ songId: 's' });
    await settle();
    expect(statuses(q.items())).toEqual(['done', 'failed', 'working']);
    q.clearFinished();
    expect(q.items().map((i) => i.name)).toEqual(['b.mid']);
  });

  it('busy() is true while anything is waiting or working', async () => {
    const { jobs, process } = manual();
    const q = createQueue(process);
    expect(q.busy()).toBe(false);
    q.add([file('a.mid')]);
    expect(q.busy()).toBe(true);
    await tick();
    jobs[0].resolve({ songId: 's' });
    await settle();
    expect(q.busy()).toBe(false);
  });

  it('subscribe calls now and on changes; unsubscribe stops it', async () => {
    const q = createQueue(async () => ({ songId: 's' }));
    const fn = vi.fn();
    const off = q.subscribe(fn);
    expect(fn).toHaveBeenCalledWith([]);
    q.add([file('a.mid')]);
    await settle();
    const calls = fn.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(3); // initial, added, working, done
    off();
    q.add([file('b.mid')]);
    await settle();
    expect(fn.mock.calls.length).toBe(calls);
  });

  it('items() returns a copy', () => {
    const q = createQueue(() => new Promise(() => {}));
    q.add([file('a.mid')]);
    const items = q.items();
    items[0].status = 'done';
    items.pop();
    expect(q.items()[0].status).toBe('waiting');
  });

  it('keeps the list bounded by dropping the oldest finished items', () => {
    const q = createQueue(() => new Promise(() => {}));
    q.add([file('keep.mid')]);
    q.add(Array.from({ length: MAX_ITEMS + 5 }, (_, i) => file(`bad${i}.txt`)));
    const items = q.items();
    expect(items).toHaveLength(MAX_ITEMS);
    expect(items[0].name).toBe('keep.mid');
    expect(items[1].name).toBe('bad6.txt');
  });

  it('summary counts items for a badge', async () => {
    const { jobs, process } = manual();
    const q = createQueue(process);
    const [, , , c] = q.add([file('a.mid'), file('x.txt'), file('b.mid'), file('c.mid')]);
    q.cancel(c.id);
    await tick();
    const s = summary(q.items());
    expect(s).toMatchObject({ total: 3, done: 0, failed: 1, duplicate: 0, waiting: 1 });
    expect(s.working?.name).toBe('a.mid');
    jobs[0].resolve({ songId: 's' });
    await settle();
    expect(summary(q.items())).toMatchObject({ total: 3, done: 1, failed: 1, waiting: 0, working: { name: 'b.mid' } });
    expect(summary([])).toEqual({ total: 0, done: 0, failed: 0, duplicate: 0, waiting: 0 });
  });
});
