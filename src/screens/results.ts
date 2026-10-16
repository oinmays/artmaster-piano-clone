/** After-session breakdown: stars, accuracy, timing, counts, tricky bars, coaching. */
import type { Screen } from '../core/types';
import { getLastResult } from '../core/store';
import { getSong } from '../songs';
import type { PlayResultExt } from '../player/engine';
import { coachingLine, playPath } from '../player/options';
import { findTrickyRange, trickyBars } from '../player/scoring';

const CSS = `
.kr { display: flex; flex-direction: column; gap: 1rem; max-width: 720px; position: relative; }
.kr-head { text-align: center; padding-top: 0.5rem; }
.kr-stars { display: flex; justify-content: center; gap: 0.5rem; margin: 0.5rem 0 0.25rem; }
.kr-stars svg { width: 56px; height: 56px; }
.kr-star { fill: var(--surface-3); }
.kr-star.is-on { fill: var(--warn); animation: kr-pop 420ms cubic-bezier(.3,1.6,.5,1) both; }
.kr-star.is-on:nth-child(2) { animation-delay: 120ms; }
.kr-star.is-on:nth-child(3) { animation-delay: 240ms; }
@keyframes kr-pop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.kr-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
.kr-tile { text-align: center; }
.kr-big { font-family: var(--font-serif); font-size: 2.25rem; line-height: 1.1; }
.kr-counts { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.5rem; text-align: center; }
.kr-counts b { display: block; font-size: 1.25rem; font-variant-numeric: tabular-nums; }
.kr-counts span { font-size: 0.75rem; color: var(--text-muted); }
.kr-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: 1px; }
.kr-bars { display: flex; flex-direction: column; gap: 0.5rem; }
.kr-bar { display: grid; grid-template-columns: 4.5rem 1fr 3rem; gap: 0.5rem; align-items: center; font-size: 0.875rem; }
.kr-meter { height: 8px; background: var(--surface-3); border-radius: 4px; overflow: hidden; }
.kr-meter i { display: block; height: 100%; background: var(--bad); border-radius: 4px; }
.kr-coach { border-left: 3px solid var(--accent); }
.kr-coach p { margin: 0; font-size: 1.0625rem; }
.kr-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.kr-actions .btn { flex: 1 1 180px; }
.kr-confetti { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 60; }
.kr-confetti i { position: absolute; top: -12px; left: var(--x); width: 8px; height: 12px; border-radius: 2px;
  background: var(--c); opacity: 0; animation: kr-fall var(--d) ease-in var(--delay) 1 forwards; }
@keyframes kr-fall {
  0% { opacity: 1; transform: translate3d(0, 0, 0) rotate(0); }
  100% { opacity: 0; transform: translate3d(var(--dx), 70vh, 0) rotate(var(--r)); }
}
@media (prefers-reduced-motion: reduce) {
  .kr-confetti { display: none; }
  .kr-star.is-on { animation: none; }
}
@media (max-width: 420px) {
  .kr-counts { grid-template-columns: repeat(3, 1fr); }
}
`;

let styled = false;
function injectStyles(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.dataset.screen = 'results';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const STAR = '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/>';
const LEVEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;
const HANDS = { both: 'Both hands', L: 'Left hand', R: 'Right hand' } as const;
const HEADLINE = ['Keep going', 'Getting there', 'Nice playing', 'Brilliant'] as const;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

const screen: Screen = (root) => {
  injectStyles();
  const r = getLastResult() as PlayResultExt | null;
  if (!r) {
    root.innerHTML = `<section class="screen"><p class="eyebrow">Results</p><h1>No session yet</h1>
      <p class="muted">Play a song and your breakdown will appear here.</p>
      <a class="btn btn--primary" href="#/library">Choose a song</a></section>`;
    return;
  }

  const song = getSong(r.songId);
  const title = song?.title ?? 'Your session';
  const bars = r.bars ?? [];
  const worst = trickyBars(bars, 85, 3);
  let tricky = findTrickyRange(bars, 2);
  if (tricky && r.loopFrom != null && r.loopTo != null) {
    tricky = { ...tricky, from: Math.max(r.loopFrom, tricky.from), to: Math.min(r.loopTo, tricky.to) };
  }
  const loopNote = r.loopFrom != null ? ` · Bars ${r.loopFrom}–${r.loopTo}` : '';

  const retryPath = playPath({
    songId: r.songId,
    level: r.level,
    hands: r.hands,
    tempo: r.tempo,
    wait: r.wait,
    loopFrom: r.loopFrom,
    loopTo: r.loopTo,
  });
  const trickyPath = tricky
    ? playPath({ songId: r.songId, level: r.level, hands: r.hands, tempo: r.tempo, wait: true, loopFrom: tricky.from, loopTo: tricky.to })
    : '';

  const count = (label: string, n: number, color: string) =>
    `<div class="card" style="padding:0.625rem 0.25rem"><b>${n}</b><span><i class="kr-dot" style="background:${color}"></i>${label}</span></div>`;

  root.innerHTML = `
  <section class="screen kr">
    <div class="kr-head">
      <p class="eyebrow">${esc(title)} · ${LEVEL[r.level]} · ${HANDS[r.hands]} · ${r.tempo}%${r.wait ? ' · Wait Mode' : ''}${loopNote}</p>
      <div class="kr-stars" role="img" aria-label="${r.stars} of 3 stars">
        ${[0, 1, 2].map((i) => `<svg viewBox="0 0 24 24" class="kr-star ${i < r.stars ? 'is-on' : ''}">${STAR}</svg>`).join('')}
      </div>
      <h1>${HEADLINE[r.stars]}</h1>
    </div>

    <div class="kr-tiles">
      <div class="card kr-tile"><div class="kr-big">${r.accuracy}%</div><div class="muted">Accuracy</div>
        <div class="muted" style="font-size:0.8125rem">${r.notesHit} of ${r.notesTotal} notes</div></div>
      ${
        r.wait
          ? ''
          : `<div class="card kr-tile"><div class="kr-big">${r.timing}%</div><div class="muted">Timing</div>
             <div class="muted" style="font-size:0.8125rem">Rhythm on the beat</div></div>`
      }
      <div class="card kr-tile"><div class="kr-big">${fmtDuration(r.durationMs)}</div><div class="muted">Practice time</div></div>
    </div>

    <div class="kr-counts">
      ${count(r.wait ? 'Played' : 'Perfect', r.perfect, 'var(--good)')}
      ${r.wait ? '' : count('Early', r.early, 'var(--warn)')}
      ${r.wait ? '' : count('Late', r.late, 'var(--accent)')}
      ${count('Missed', r.missed, 'var(--text-muted)')}
      ${count('Wrong', r.wrong, 'var(--bad)')}
    </div>

    <div class="card kr-coach"><p class="eyebrow">Coach</p><p class="kr-coach-line"></p></div>

    <div class="card">
      <p class="eyebrow">Tricky bars</p>
      ${
        worst.length
          ? `<div class="kr-bars">${worst
              .map(
                (b) => `<div class="kr-bar"><span>Bar ${b.bar}</span>
                  <div class="kr-meter" aria-hidden="true"><i style="width:${Math.max(4, 100 - b.accuracy)}%"></i></div>
                  <span class="muted">${b.accuracy}%</span></div>`,
              )
              .join('')}</div>`
          : `<p class="muted" style="margin:0">No trouble spots. Every bar was 85% or better.</p>`
      }
    </div>

    <div class="kr-actions">
      <a class="btn btn--primary" href="#${retryPath}">Try again</a>
      ${tricky ? `<a class="btn" href="#${trickyPath}">Practise tricky part (bars ${tricky.from}–${tricky.to})</a>` : ''}
      <a class="btn btn--ghost" href="#/song/${encodeURIComponent(r.songId)}">Back to song</a>
    </div>
  </section>`;

  root.querySelector('.kr-coach-line')!.textContent = coachingLine(r, bars);

  // Subtle celebration for three stars.
  let confetti: HTMLElement | null = null;
  if (r.stars === 3) {
    confetti = document.createElement('div');
    confetti.className = 'kr-confetti';
    confetti.setAttribute('aria-hidden', 'true');
    const colors = ['var(--accent)', 'var(--good)', 'var(--warn)', 'var(--beige)'];
    let html = '';
    for (let i = 0; i < 36; i++) {
      // Deterministic spread (golden-ratio steps) keeps it even without Math.random.
      const f = (i * 0.618034) % 1;
      html += `<i style="--x:${(f * 100).toFixed(1)}%;--c:${colors[i % 4]};--d:${(1.6 + ((i * 7) % 10) / 10).toFixed(2)}s;--delay:${(
        ((i * 13) % 20) / 40
      ).toFixed(2)}s;--dx:${((i % 2 ? 1 : -1) * (10 + ((i * 11) % 40))).toFixed(0)}px;--r:${(i % 2 ? 1 : -1) * (180 + i * 20)}deg"></i>`;
    }
    confetti.innerHTML = html;
    document.body.appendChild(confetti);
  }

  return () => {
    confetti?.remove();
  };
};

export default screen;
