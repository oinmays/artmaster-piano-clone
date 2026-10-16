/** Tiny hash router. Hash routing works on GitHub Pages and in iOS standalone mode. */
import type { Screen } from './types';

interface Route {
  pattern: RegExp;
  keys: string[];
  screen: () => Promise<Screen>;
  /** Full-bleed screens hide the tab bar. */
  full?: boolean;
}

const routes: Route[] = [];
let cleanup: (() => void) | void;
let mountEl: HTMLElement;
let onChange: (path: string, full: boolean) => void = () => {};

/** Register "/song/:id"-style paths. `screen` is lazy so each module code-splits. */
export function route(path: string, screen: () => Promise<Screen>, full = false): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$',
  );
  routes.push({ pattern, keys, screen, full });
}

export function navigate(path: string, replace = false): void {
  const h = '#' + path;
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (replace) void render();
}

/** Parse "#/play/x?level=easy" -> { path: "/play/x", query: {level: "easy"} } */
export function currentLocation(): { path: string; query: Record<string, string> } {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

async function render(): Promise<void> {
  const { path, query } = currentLocation();
  const match = routes.find((r) => r.pattern.test(path)) ?? routes.find((r) => r.keys.length === 0 && r.pattern.test('/'))!;
  const m = match.pattern.exec(path);
  const params: Record<string, string> = { ...query };
  match.keys.forEach((k, i) => (params[k] = decodeURIComponent(m?.[i + 1] ?? '')));

  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  let screen: Screen;
  try {
    screen = await match.screen();
    sessionStorage.removeItem('keys.reloaded');
  } catch (err) {
    // A deploy replaced the hashed chunks this page was built against. Reload once to pick up the new build.
    if (!sessionStorage.getItem('keys.reloaded')) {
      sessionStorage.setItem('keys.reloaded', '1');
      location.reload();
      return;
    }
    throw err;
  }
  mountEl.replaceChildren();
  mountEl.scrollTop = 0;
  window.scrollTo(0, 0);
  onChange(path, !!match.full);
  cleanup = screen(mountEl, params);
}

export function startRouter(el: HTMLElement, changed: (path: string, full: boolean) => void): void {
  mountEl = el;
  onChange = changed;
  window.addEventListener('hashchange', () => void render());
  void render();
}
