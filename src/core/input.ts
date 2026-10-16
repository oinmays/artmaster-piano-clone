/**
 * Input bus. Every source (on-screen keys, microphone, Web MIDI) publishes here;
 * the player and tools subscribe. Keeps sources and consumers decoupled.
 */
import type { PlayedNote } from './types';

type NoteListener = (n: PlayedNote) => void;

const onListeners = new Set<NoteListener>();
const offListeners = new Set<NoteListener>();

export function emitNoteOn(n: PlayedNote): void {
  onListeners.forEach((l) => l(n));
}

export function emitNoteOff(n: PlayedNote): void {
  offListeners.forEach((l) => l(n));
}

/** Returns an unsubscribe function. */
export function onNoteOn(l: NoteListener): () => void {
  onListeners.add(l);
  return () => onListeners.delete(l);
}

export function onNoteOff(l: NoteListener): () => void {
  offListeners.add(l);
  return () => offListeners.delete(l);
}
