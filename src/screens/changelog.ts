/**
 * What's new: #/settings/changelog — the build the app is running and the recent commits,
 * read from git at build time (vite.config.ts, T20). No manual upkeep.
 */
import type { Screen } from '../core/types';
import entries from 'virtual:changelog';

const css = `
.cl { display: flex; flex-direction: column; gap: 1rem; max-width: 720px; }
.cl-back { align-self: flex-start; min-height: 44px; display: inline-flex; align-items: center;
  color: var(--text-muted); text-decoration: none; }
.cl-head h1 { margin: 0; }
.cl-build { margin: 0.25rem 0 0; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.cl-day h2 { margin: 0 0 0.5rem; font-size: 1rem; color: var(--text-muted); font-weight: 500; }
.cl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.cl-item { display: flex; gap: 0.75rem; align-items: baseline; padding: 0.625rem 0; min-height: 44px;
  border-top: 1px solid var(--border); }
.cl-item:first-child { border-top: 0; }
.cl-sha { flex: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8125rem;
  color: var(--text-muted); min-width: 4.5rem; }
.cl-subject { flex: 1; min-width: 0; overflow-wrap: anywhere; line-height: 1.4; }
.cl-item.is-current { background: var(--surface-2); margin: 0 -0.75rem; padding-left: 0.75rem; padding-right: 0.75rem;
  border-radius: var(--radius-sm); }
.cl-badge { display: inline-block; margin-top: 0.25rem; font-size: 0.8125rem; font-weight: 600; color: var(--good); }
.cl-empty { margin: 0; color: var(--text-muted); }

.app-version { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
  min-height: 44px; padding: 0.5rem 0.25rem; color: var(--text-muted); text-decoration: none; font-size: 0.875rem;
  font-variant-numeric: tabular-nums; }
.app-version:hover, .app-version:focus-visible { color: var(--text); }
.app-version-go { color: var(--accent); white-space: nowrap; }
`;

let styled = false;
function injectStyles(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "17 Oct 2026, 6:42 pm" in the viewer's own time zone. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "v0.1.27 · 7f5abdf · 17 Oct 2026, 6:42 pm" */
export function versionLine(): string {
  return [`v${__BUILD__.version}`, __BUILD__.sha, when(__BUILD__.time)].filter(Boolean).join(' · ');
}

/** Footer link for the bottom of Settings. */
export function versionFooter(): string {
  injectStyles();
  return `<a class="app-version" href="#/settings/changelog"><span>${esc(versionLine())}</span><span class="app-version-go">What's new ›</span></a>`;
}

/** Entries grouped by local calendar day, newest first. */
function byDay(): { day: string; items: typeof entries }[] {
  const groups: { day: string; items: typeof entries }[] = [];
  for (const e of [...entries].sort((a, b) => b.date.localeCompare(a.date))) {
    const d = new Date(e.date);
    const day = Number.isNaN(d.getTime())
      ? 'Undated'
      : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }
  return groups;
}

const screen: Screen = (root) => {
  injectStyles();
  const groups = byDay();
  root.innerHTML = `
  <section class="screen cl">
    <a class="cl-back" href="#/settings">‹ Settings</a>
    <div class="cl-head">
      <p class="eyebrow">Keys</p>
      <h1>What's new</h1>
      <p class="cl-build">You're on ${esc(versionLine())}</p>
    </div>
    ${
      groups.length
        ? groups
            .map(
              (g) => `
    <div class="card cl-day">
      <h2>${esc(g.day)}</h2>
      <ul class="cl-list">
        ${g.items
          .map((e) => {
            const current = !!__BUILD__.sha && e.sha === __BUILD__.sha;
            return `<li class="cl-item${current ? ' is-current' : ''}"${current ? ' aria-current="true"' : ''}>
          <span class="cl-sha">${esc(e.sha)}</span>
          <span class="cl-subject">${esc(e.subject)}${current ? `<br><span class="cl-badge">You're on this version</span>` : ''}</span>
        </li>`;
          })
          .join('')}
      </ul>
    </div>`,
            )
            .join('')
        : `<div class="card"><p class="cl-empty">No change history in this build.</p></div>`
    }
  </section>`;
};

export default screen;
