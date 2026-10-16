import type { Screen, Song } from '../core/types';
import { SONGS, allTags } from '../songs';
import { esc, injectStyle, songCardHtml } from '../songs/ui';

const css = `
.lb-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.75rem; margin-bottom: 1rem; }
.lb-head h1 { margin: 0; }
.lb-search { position: relative; flex: 1 1 260px; max-width: 420px; }
.lb-search svg { position: absolute; left: 0.875rem; top: 50%; width: 18px; height: 18px; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
.lb-search input { width: 100%; min-height: 44px; padding: 0 1rem 0 2.5rem; border-radius: var(--radius-pill);
  border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 16px;
  -webkit-user-select: text; user-select: text; }
.lb-search input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.lb-search input::placeholder { color: var(--text-muted); }
.lb-tags { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.25rem; }
.lb-tags .chip { min-height: 44px; padding: 0 1rem; border: 1px solid transparent; cursor: pointer; font: inherit; font-size: 0.875rem; }
.lb-tags .chip[aria-pressed='true'] { background: var(--beige); color: var(--bg); }
.lb-count { font-size: 0.875rem; margin-bottom: 0.75rem; }
.lb-empty { text-align: center; padding: 2.5rem 1rem; }
`;

// Kept for the session so coming back from a song keeps the filter.
let query = '';
let tag = 'All';

function matches(song: Song): boolean {
  if (tag !== 'All' && !song.tags.includes(tag)) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [song.title, song.composer, song.blurb, song.key, ...song.tags].join(' ').toLowerCase().includes(q);
}

const screen: Screen = (root) => {
  injectStyle('lb-style', css);
  const tags = ['All', ...allTags()];
  if (!tags.includes(tag)) tag = 'All';

  root.innerHTML = `<section class="screen lb">
    <div class="lb-head">
      <div><p class="eyebrow">Library</p><h1>Songs</h1></div>
      <label class="lb-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input type="search" placeholder="Search songs or composers" aria-label="Search songs" autocomplete="off" enterkeyhint="search" value="${esc(query)}">
      </label>
    </div>
    <div class="lb-tags" role="group" aria-label="Filter by tag">
      ${tags.map((t) => `<button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="${t === tag}">${esc(t)}</button>`).join('')}
    </div>
    <p class="lb-count muted" aria-live="polite"></p>
    <div class="grid" data-grid></div>
  </section>`;

  const grid = root.querySelector<HTMLElement>('[data-grid]')!;
  const count = root.querySelector<HTMLElement>('.lb-count')!;
  const input = root.querySelector<HTMLInputElement>('input')!;

  const render = () => {
    const list = SONGS.filter(matches);
    count.textContent = `${list.length} ${list.length === 1 ? 'song' : 'songs'}, easiest first`;
    grid.innerHTML = list.length
      ? list.map(songCardHtml).join('')
      : `<div class="card lb-empty"><p>No songs match “${esc(query)}”.</p><button class="btn" type="button" data-clear>Clear filters</button></div>`;
  };

  input.addEventListener('input', () => {
    query = input.value;
    render();
  });
  root.querySelector('.lb-tags')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tag]');
    if (!b) return;
    tag = b.dataset.tag!;
    root.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  });
  grid.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-clear]')) return;
    query = '';
    tag = 'All';
    input.value = '';
    root.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tag === 'All')));
    render();
  });

  render();
};

export default screen;
