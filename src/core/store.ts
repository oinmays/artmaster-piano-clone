/** Device-local persistence. Every access is guarded: private mode can throw. */
import type { Level, PlayResult } from './types';

const PREFIX = 'keys.v1.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or private mode */
  }
}

/** Like save(), but says whether it worked (false when storage is full or blocked). */
export function trySave<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---- Settings ---------------------------------------------------------------

export interface Settings {
  /** Which input the player listens to. A connected MIDI keyboard is used whatever this says. */
  input: 'mic' | 'touch' | 'midi';
  /** Show note names on keys and falling notes. */
  showNoteNames: boolean;
  /** Extra latency compensation for the mic, in ms. */
  micLatencyMs: number;
  /** Mic only: count the right note in the wrong octave as correct (beginners rarely know which octave). */
  anyOctave: boolean;
  volume: number;
  a4: number;
  /**
   * Mic only, 0–100: how quiet a note may be and still count. Higher = quieter notes count.
   * Mapped to a threshold scale factor by sensitivityFactor() in src/listen/sensitivity.ts.
   */
  micSensitivity: number;
}

/** Default mic sensitivity: threshold factor 0.75, 25% lower than before T16. */
export const DEFAULT_MIC_SENSITIVITY = 50;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  input: 'touch',
  showNoteNames: true,
  micLatencyMs: 80,
  anyOctave: true,
  volume: 0.8,
  a4: 440,
  micSensitivity: DEFAULT_MIC_SENSITIVITY,
};

export const getSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) });

const settingsListeners = new Set<(s: Settings) => void>();

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  save('settings', next);
  settingsListeners.forEach((cb) => cb(next));
  return next;
}

/** Called after every updateSettings(). Returns an unsubscribe function. */
export function onSettingsChange(cb: (s: Settings) => void): () => void {
  settingsListeners.add(cb);
  return () => settingsListeners.delete(cb);
}

// ---- Progress ---------------------------------------------------------------

export function getResults(): PlayResult[] {
  return load<PlayResult[]>('results', []);
}

export function addResult(r: PlayResult): void {
  const all = getResults();
  all.push(r);
  save('results', all.slice(-500));
  save('lastResult', r);
}

export const getLastResult = (): PlayResult | null => load<PlayResult | null>('lastResult', null);

/** Best stars per song+level, for library badges. */
export function bestStars(songId: string, level: Level): number {
  return getResults()
    .filter((r) => r.songId === songId && r.level === level)
    .reduce((m, r) => Math.max(m, r.stars), 0);
}

/** Consecutive days (ending today or yesterday) with at least one result. */
export function streakDays(now = Date.now()): number {
  const days = new Set(getResults().map((r) => new Date(r.at).toDateString()));
  let streak = 0;
  const d = new Date(now);
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function totalPracticeMs(): number {
  return getResults().reduce((s, r) => s + r.durationMs, 0);
}
