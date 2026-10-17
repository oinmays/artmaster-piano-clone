/**
 * Stand-in for '@tonejs/midi' (T23). Basic Pitch imports it only to write .mid files, which Keys
 * never does, so vite.config.ts aliases it here to keep it out of the audio worker.
 */
export class Midi {}
