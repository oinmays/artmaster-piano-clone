import type { PlayResult, Screen } from '../core/types';
import { getResults, save, streakDays, totalPracticeMs } from '../core/store';
import { getSong } from '../songs';
import { LEVEL_LABEL, esc, formatDate, formatDuration, injectStyle, starsHtml } from '../songs/ui';

const RECENT = 30;

const css = `
.pg-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.75rem; margin-bottom: 1rem; }
.pg-head h1 { margin: 0; }
.pg-head a { min-height: 44px; }
.pg-stats { display: grid; gap: 0.625rem; grid-template-columns: repeat(2, 1fr); }
@media (min-width: 700px) { .pg-stats { grid-template-columns: repeat(4, 1fr); } }
.pg-stat b { display: block; font-family: var(--font-serif); font-weight: 500; font-size: 1.875rem; color: var(--beige); line-height: 1.1; }
.pg-stat span { font-size: 0.8125rem; color: var(--text-muted); }
.pg-week { margin-top: 1rem; }
.pg-bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; align-items: end; height: 120px; margin-top: 0.5rem; }
.pg-bar { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 0.25rem; height: 100%; font-size: 0.6875rem; color: var(--text-muted); }
.pg-bar i { display: block; width: 100%; max-width: 36px; min-height: 3px; border-radius: 4px 4px 2px 2px; background: var(--surface-3); }
.pg-bar.is-on i { background: var(--accent); }
.pg-bar.is-today span { color: var(--beige); font-weight: 600; }
.pg-section { margin-top: 1.5rem; }
.pg-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
.pg-item a { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 0.75rem; align-items: center; min-height: 56px;
  color: inherit; text-decoration: none; padding: 0.75rem 1rem; }
.pg-item b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg-item .pg-acc { font-family: var(--font-serif); font-size: 1.25rem; color: var(--beige); text-align: right; }
.pg-item .pg-meta { font-size: 0.8125rem; color: var(--text-muted); }
.pg-empty { text-align: center; padding: 2rem 1rem; }
.pg-danger { margin-top: 2rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: space-between; }
.pg-danger .btn { border-color: var(--bad); color: var(--bad); background: transparent; }
`;

function weekHtml(results: PlayResult[]): string {
  const days: { label: string; ms: number; today: boolean }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toDateString();
    const ms = results.filter((r) => new Date(r.at).toDateString() === key).reduce((s, r) => s + r.durationMs, 0);
    days.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), ms, today: i === 0 });
  }
  const max = Math.max(60_000, ...days.map((d) => d.ms));
  return `<div class="card pg-week">
    <p class="eyebrow">Last 7 days</p>
    <div class="pg-bars">${days
      .map(
        (d) => `<div class="pg-bar${d.ms > 0 ? ' is-on' : ''}${d.today ? ' is-today' : ''}" title="${formatDuration(d.ms)}">
          <i style="height:${Math.round((d.ms / max) * 85)}%"></i><span>${esc(d.label)}</span></div>`,
      )
      .join('')}</div>
  </div>`;
}

function itemHtml(r: PlayResult): string {
  const song = getSong(r.songId);
  const title = song?.title ?? r.songId;
  const hands = r.hands === 'both' ? 'both hands' : r.hands === 'L' ? 'left hand' : 'right hand';
  const inner = `<b>${esc(title)}</b><span class="pg-acc">${Math.round(r.accuracy)}%</span>
    <span class="pg-meta">${LEVEL_LABEL[r.level] ?? r.level} · ${hands} · ${r.tempo}% · ${esc(formatDate(r.at))}</span>${starsHtml(r.stars)}`;
  return `<li class="pg-item">${
    song ? `<a class="card" href="#/song/${encodeURIComponent(song.id)}">${inner}</a>` : `<a class="card">${inner}</a>`
  }</li>`;
}

const screen: Screen = (root) => {
  injectStyle('pg-style', css);

  const render = () => {
    const results = getResults();
    const avg = results.length ? Math.round(results.reduce((s, r) => s + r.accuracy, 0) / results.length) : 0;
    const recent = results.slice(-RECENT).reverse();

    root.innerHTML = `<section class="screen pg">
      <div class="pg-head">
        <div><p class="eyebrow">Progress</p><h1>Your practice</h1></div>
        <a class="btn btn--sm" href="#/settings">Settings</a>
      </div>
      <div class="pg-stats">
        <div class="card pg-stat"><b>${results.length}</b><span>${results.length === 1 ? 'session' : 'sessions'}</span></div>
        <div class="card pg-stat"><b>${formatDuration(totalPracticeMs())}</b><span>total practice</span></div>
        <div class="card pg-stat"><b>${streakDays()}</b><span>day streak</span></div>
        <div class="card pg-stat"><b>${results.length ? `${avg}%` : '–'}</b><span>average accuracy</span></div>
      </div>
      ${weekHtml(results)}
      <section class="pg-section">
        <h2>Recent sessions</h2>
        ${
          recent.length
            ? `<ul class="pg-list">${recent.map(itemHtml).join('')}</ul>`
            : `<div class="card pg-empty"><p class="muted">No sessions yet. Play a song and your results show up here.</p>
               <a class="btn btn--primary" href="#/library">Pick a song</a></div>`
        }
      </section>
      <div class="pg-danger">
        <p class="muted" style="margin:0">Progress is stored on this device only.</p>
        <button type="button" class="btn" data-reset ${results.length ? '' : 'disabled'}>Reset progress</button>
      </div>
    </section>`;

    root.querySelector('[data-reset]')?.addEventListener('click', () => {
      if (!confirm('Reset all progress? This deletes every session, star and streak on this device.')) return;
      save('results', []);
      save('lastResult', null);
      render();
    });
  };

  render();
};

export default screen;
