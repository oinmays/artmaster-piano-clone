import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import '@fontsource/fraunces/500.css';
import './styles/tokens.css';
import './styles/base.css';
import { route, startRouter } from './core/router';
import { getSettings } from './core/store';
import { setVolume, unlockAudio } from './core/audio';

// ---- Routes (each screen module is its own lazy chunk) ----------------------
route('/', () => import('./screens/home').then((m) => m.default));
route('/library', () => import('./screens/library').then((m) => m.default));
route('/song/:id', () => import('./screens/song').then((m) => m.default));
route('/play/:id', () => import('./screens/player').then((m) => m.default), true);
route('/results', () => import('./screens/results').then((m) => m.default));
route('/progress', () => import('./screens/progress').then((m) => m.default));
route('/tools', () => import('./screens/tools').then((m) => m.default));
route('/tools/metronome', () => import('./screens/metronome').then((m) => m.default));
route('/tools/chords', () => import('./screens/chords').then((m) => m.default));
route('/tools/mic', () => import('./screens/miccheck').then((m) => m.default));
route('/tools/keyboard', () => import('./screens/keyboardguide').then((m) => m.default));
route('/tools/tuner', () => import('./screens/tuner').then((m) => m.default));
route('/settings', () => import('./screens/settings').then((m) => m.default));
route('/settings/changelog', () => import('./screens/changelog').then((m) => m.default));

// ---- Shell ------------------------------------------------------------------
const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const TABS = [
  { href: '/', label: 'Home', match: /^\/$/, svg: icon('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>') },
  { href: '/library', label: 'Songs', match: /^\/(library|song)/, svg: icon('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>') },
  { href: '/tools', label: 'Tools', match: /^\/tools/, svg: icon('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>') },
  { href: '/progress', label: 'Progress', match: /^\/(progress|results|settings)/, svg: icon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>') },
];

const app = document.getElementById('app')!;
const main = document.createElement('main');
const tabbar = document.createElement('nav');
tabbar.className = 'tabbar';
tabbar.setAttribute('aria-label', 'Main');
tabbar.innerHTML = TABS.map((t) => `<a href="#${t.href}">${t.svg}<span>${t.label}</span></a>`).join('');
app.append(main, tabbar);

startRouter(main, (path, full) => {
  tabbar.hidden = full;
  tabbar.querySelectorAll('a').forEach((a, i) => {
    if (TABS[i].match.test(path)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
});

setVolume(getSettings().volume);
// Any first touch unlocks Web Audio on iOS.
window.addEventListener('pointerdown', () => void unlockAudio(), { once: true, capture: true });

// ---- Offline support and updates --------------------------------------------
// sw.js activates a new build as soon as it installs (skipWaiting + clients.claim). When that
// happens under an open page, offer a reload; the page itself is still the old build.
function showUpdateBar(): void {
  if (document.querySelector('.update-bar')) return;
  const style = document.createElement('style');
  style.textContent = `.update-bar { position: fixed; z-index: 50; left: 50%; transform: translateX(-50%);
  bottom: calc(var(--safe-bottom) + var(--tabbar-h) + 0.75rem); min-height: 44px; max-width: calc(100vw - 2rem);
  padding: 0 1.25rem; border-radius: var(--radius-pill); border: 0; background: var(--accent); color: #fff;
  font: inherit; font-weight: 600; box-shadow: 0 6px 24px rgb(0 0 0 / 0.35); cursor: pointer; }`;
  const bar = document.createElement('button');
  bar.className = 'update-bar';
  bar.textContent = 'Update available, tap to reload';
  bar.addEventListener('click', () => location.reload());
  document.head.appendChild(style);
  document.body.appendChild(bar);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) showUpdateBar();
    });
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // Home-screen apps stay open for days: look for a new build whenever the app comes back.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}
