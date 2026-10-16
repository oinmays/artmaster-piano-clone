import type { Screen } from '../core/types';
import { getLastResult, getResults, load, save, streakDays, totalPracticeMs } from '../core/store';
import { SONGS, getSong } from '../songs';
import { LEVEL_LABEL, esc, formatDate, formatDuration, injectStyle, songCardHtml, starsHtml } from '../songs/ui';

const FEATURED = ['twinkle-twinkle', 'ode-to-joy', 'canon-in-d', 'fur-elise'];

const css = `
.hm-hero { padding: 1.5rem 0 1.25rem; }
.hm-hero h1 { font-size: clamp(2.125rem, 8vw, 3.5rem); line-height: 1.05; color: var(--beige); max-width: 14ch; margin-bottom: 0.75rem; }
.hm-hero h1 em { font-style: italic; color: var(--accent); }
.hm-hero p { max-width: 38ch; font-size: 1.0625rem; }
.hm-hero .row { margin-top: 1rem; }
.hm-section { margin-top: 1.75rem; }
.hm-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.75rem; }
.hm-section-head h2 { margin: 0; }
.hm-section-head a { min-height: 44px; display: inline-flex; align-items: center; text-decoration: none; font-weight: 500; }
.hm-top { display: grid; gap: 0.875rem; grid-template-columns: 1fr; }
@media (min-width: 760px) { .hm-top { grid-template-columns: 1.4fr 1fr; } }
.hm-onboard { border-color: var(--accent); background: linear-gradient(160deg, rgba(254, 88, 38, 0.12), var(--surface) 60%); }
.hm-onboard ol { list-style: none; margin: 0.75rem 0 1rem; padding: 0; display: grid; gap: 0.75rem; }
.hm-onboard li { display: flex; gap: 0.75rem; align-items: flex-start; line-height: 1.4; }
.hm-onboard .hm-num { flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: #fff;
  display: grid; place-items: center; font-weight: 700; font-size: 0.875rem; }
.hm-onboard li strong { display: block; color: var(--beige); font-weight: 500; }
.hm-continue { display: flex; flex-direction: column; gap: 0.5rem; }
.hm-continue h3 { font-size: 1.375rem; margin: 0; }
.hm-continue .row { margin-top: auto; padding-top: 0.5rem; }
.hm-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
.hm-stat { background: var(--surface-2); border-radius: var(--radius-sm); padding: 0.75rem; min-width: 0; }
.hm-stat b { display: block; font-family: var(--font-serif); font-weight: 500; font-size: clamp(1.125rem, 4.6vw, 1.5rem); color: var(--beige); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hm-stat span { font-size: 0.75rem; color: var(--text-muted); }
.hm-tools { display: grid; gap: 0.625rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); }
.hm-tool { display: flex; align-items: center; gap: 0.75rem; min-height: 64px; color: inherit; text-decoration: none; }
.hm-tool svg { width: 28px; height: 28px; flex: none; color: var(--accent); }
.hm-tool b { display: block; font-weight: 500; }
.hm-tool span { font-size: 0.8125rem; color: var(--text-muted); }
`;

const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const TOOLS = [
  { href: '#/tools/tuner', name: 'Tuner', desc: 'Check any note', svg: icon('<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 12l5-5"/>') },
  { href: '#/tools/metronome', name: 'Metronome', desc: 'Keep steady time', svg: icon('<path d="M8 3h8l4 18H4z"/><path d="M12 15l5-8"/>') },
  { href: '#/tools/chords', name: 'Chord Finder', desc: 'Name what you play', svg: icon('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M8 5v9M12 5v9M16 5v9"/>') },
];

function onboardingHtml(): string {
  return `<div class="card hm-onboard" data-onboard>
    <p class="eyebrow">Before you start</p>
    <h2>Three things, then play</h2>
    <ol>
      <li><span class="hm-num">1</span><span><strong>Put your phone or iPad on the music stand</strong>
        <span class="muted">Close to the piano, screen facing you.</span></span></li>
      <li><span class="hm-num">2</span><span><strong>Allow the microphone</strong>
        <span class="muted">Keys listens to your piano to check each note. Nothing is recorded or uploaded.</span></span></li>
      <li><span class="hm-num">3</span><span><strong>Follow the falling notes</strong>
        <span class="muted">Play each note as it reaches the keyboard. In wait mode the music waits for you.</span></span></li>
    </ol>
    <button class="btn btn--primary" type="button" data-dismiss>Got it</button>
  </div>`;
}

function continueHtml(): string {
  const last = getLastResult();
  const song = last ? getSong(last.songId) : undefined;
  if (last && song) {
    return `<div class="card hm-continue">
      <p class="eyebrow">Continue</p>
      <h3>${esc(song.title)}</h3>
      <p class="muted" style="margin:0">${LEVEL_LABEL[last.level]} · ${Math.round(last.accuracy)}% accuracy · ${esc(formatDate(last.at))}</p>
      ${starsHtml(last.stars)}
      <div class="row"><a class="btn btn--primary" href="#/song/${encodeURIComponent(song.id)}">Continue</a>
      <a class="btn btn--ghost" href="#/library">All songs</a></div>
    </div>`;
  }
  const first = SONGS[0];
  return `<div class="card hm-continue">
    <p class="eyebrow">Your first song</p>
    <h3>${esc(first.title)}</h3>
    <p class="muted" style="margin:0">Eight bars, five notes, right hand only. A perfect start.</p>
    <div class="row"><a class="btn btn--primary" href="#/song/${encodeURIComponent(first.id)}">Start playing</a></div>
  </div>`;
}

function statsHtml(): string {
  const streak = streakDays();
  const sessions = getResults().length;
  return `<div class="card">
    <p class="eyebrow">Your practice</p>
    <div class="hm-stats">
      <div class="hm-stat"><b>${streak}</b><span>day streak</span></div>
      <div class="hm-stat"><b>${formatDuration(totalPracticeMs())}</b><span>practised</span></div>
      <div class="hm-stat"><b>${sessions}</b><span>${sessions === 1 ? 'session' : 'sessions'}</span></div>
    </div>
    <p class="muted" style="margin:0.75rem 0 0;font-size:0.875rem">${
      streak > 0 ? 'Keep it going: a few minutes today counts.' : 'Play one song today to start a streak.'
    }</p>
  </div>`;
}

const screen: Screen = (root) => {
  injectStyle('hm-style', css);
  const featured = FEATURED.map(getSong).filter((s) => !!s);
  const showOnboarding = !load<boolean>('onboarded', false);

  root.innerHTML = `<section class="screen hm">
    <header class="hm-hero">
      <p class="eyebrow">Keys · your piano teacher</p>
      <h1>Play your first song <em>today</em></h1>
      <p class="muted">Follow the falling notes. Keys listens as you play and shows you what to fix, one song at a time.</p>
      <div class="row">
        <a class="btn btn--primary" href="#/song/${encodeURIComponent(SONGS[0].id)}">Start playing</a>
        <a class="btn" href="#/library">Browse songs</a>
      </div>
    </header>
    ${showOnboarding ? onboardingHtml() : ''}
    <div class="hm-top hm-section">${continueHtml()}${statsHtml()}</div>
    <section class="hm-section">
      <div class="hm-section-head"><h2>Featured songs</h2><a href="#/library">See all ${SONGS.length}</a></div>
      <div class="grid">${featured.map(songCardHtml).join('')}</div>
    </section>
    <section class="hm-section">
      <div class="hm-section-head"><h2>Tools</h2><a href="#/tools">All tools</a></div>
      <div class="hm-tools">${TOOLS.map(
        (t) => `<a class="card hm-tool" href="${t.href}">${t.svg}<span><b>${t.name}</b><span>${t.desc}</span></span></a>`,
      ).join('')}</div>
    </section>
  </section>`;

  root.querySelector('[data-dismiss]')?.addEventListener('click', () => {
    save('onboarded', true);
    root.querySelector('[data-onboard]')?.remove();
  });
};

export default screen;
