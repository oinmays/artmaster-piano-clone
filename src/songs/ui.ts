/** Small DOM helpers shared by the Home, Library, Song and Progress screens. */
import type { Level, Song } from '../core/types';
import { bestStars } from '../core/store';

export const LEVELS: Level[] = ['easy', 'medium', 'hard'];
export const LEVEL_LABEL: Record<Level, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Inject a screen's CSS once, keyed by id. */
export function injectStyle(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

export function starsHtml(n: number, label = true): string {
  const filled = Math.max(0, Math.min(3, Math.round(n)));
  const aria = label ? ` role="img" aria-label="${filled} of 3 stars"` : ' aria-hidden="true"';
  return `<span class="k-stars"${aria}><span class="k-stars-on">${'★'.repeat(filled)}</span>${'★'.repeat(3 - filled)}</span>`;
}

/** 3_725_000 -> "1 h 2 min"; 95_000 -> "1 min"; 20_000 -> "20 s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** "3:05" from seconds. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDate(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** Shared bits used by several screens (stars colour). */
injectStyle(
  'k-shared-style',
  `.k-stars { color: var(--surface-3); letter-spacing: 0.05em; white-space: nowrap; }
   .k-stars-on { color: var(--warn); }`,
);

// ---- Song card (Library grid, Home featured row) ---------------------------------


export function songCardHtml(song: Song): string {
  const levels = LEVELS.map(
    (l) => `<span class="k-card-level"><span class="muted">${LEVEL_LABEL[l][0]}</span>${starsHtml(bestStars(song.id, l), false)}</span>`,
  ).join('');
  const aria = LEVELS.map((l) => `${LEVEL_LABEL[l]} ${bestStars(song.id, l)} stars`).join(', ');
  return `<a class="card k-card" href="#/song/${encodeURIComponent(song.id)}">
    <span class="k-card-top"><span class="eyebrow">${esc(song.tags[0] ?? '')}</span><span class="k-card-bpm muted">${song.bpm} BPM</span></span>
    <h3>${esc(song.title)}</h3>
    <span class="k-card-composer">${esc(song.composer)}</span>
    <span class="k-card-blurb muted">${esc(song.blurb)}</span>
    <span class="k-card-levels" aria-label="Best: ${aria}">${levels}</span>
  </a>`;
}

injectStyle(
  'k-card-style',
  `.k-card { display: flex; flex-direction: column; gap: 0.25rem; color: inherit; text-decoration: none;
     min-height: 44px; transition: border-color 120ms, transform 120ms; }
   .k-card:hover { border-color: var(--border); }
   .k-card:active { transform: scale(0.99); }
   .k-card h3 { margin: 0.25rem 0 0; line-height: 1.2; }
   .k-card-top { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
   .k-card-top .eyebrow { margin: 0; }
   .k-card-bpm { font-size: 0.75rem; }
   .k-card-composer { font-size: 0.9375rem; color: var(--beige); }
   .k-card-blurb { font-size: 0.8125rem; }
   .k-card-levels { display: flex; gap: 0.875rem; margin-top: auto; padding-top: 0.625rem; font-size: 0.8125rem; }
   .k-card-level { display: inline-flex; gap: 0.25rem; align-items: center; }`,
);
