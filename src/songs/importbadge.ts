/**
 * Imports keep running while the learner browses (T24); a small pill above the tab bar says so
 * on every screen except the library, where the full queue is visible. Started by the library
 * screen, which is where imports begin.
 */
import { importQueue } from './importer';
import { summary } from './queue';
import { injectStyle } from './ui';

let started = false;

export function ensureImportBadge(): void {
  if (started) return;
  started = true;
  injectStyle(
    'import-badge-style',
    `.import-badge { position: fixed; z-index: 40; right: 1rem; bottom: calc(var(--safe-bottom) + var(--tabbar-h) + 0.75rem);
       display: inline-flex; align-items: center; min-height: 44px; max-width: calc(100vw - 2rem); padding: 0 1rem;
       border-radius: var(--radius-pill); background: var(--surface-3); color: var(--text); text-decoration: none;
       font-size: 0.875rem; box-shadow: 0 6px 24px rgb(0 0 0 / 0.35); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
     .import-badge[hidden] { display: none; }`,
  );
  const badge = document.createElement('a');
  badge.className = 'import-badge';
  badge.href = '#/library';
  badge.hidden = true;
  badge.setAttribute('aria-live', 'polite');
  document.body.appendChild(badge);

  const q = importQueue();
  const update = () => {
    // Hidden on the library (the queue is shown there) and in the player (full screen).
    badge.hidden = !q.busy() || /^#\/(library|play\/)/.test(location.hash);
    const s = summary(q.items());
    const pct = s.working ? ` · ${Math.round(s.working.progress)}%` : '';
    const left = s.waiting + (s.working ? 1 : 0);
    badge.textContent = `Importing songs · ${left} left${pct}`;
  };
  q.subscribe(update);
  window.addEventListener('hashchange', update);
}
