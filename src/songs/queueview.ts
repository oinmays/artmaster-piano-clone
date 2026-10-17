/** The visible import queue panel (T24 — stub). */
import type { ImportQueue } from './queue';

/** Render the queue into `el` and keep it current; returns a cleanup function. Hidden when the queue is empty. */
export function mountQueueView(_el: HTMLElement, _queue: ImportQueue): () => void {
  return () => {};
}
