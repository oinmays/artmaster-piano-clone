import type { Screen, Song } from '../core/types';
import { SONGS, allTags } from '../songs';
import { esc, injectStyle, songCardHtml } from '../songs/ui';
import { MidiImportError } from '../songs/midifile';
import { deleteMySong, getMySong, mySongs, onMySongsChange, updateMySong } from '../songs/mine';
import { importQueue } from '../songs/importer';
import { mountQueueView } from '../songs/queueview';
import { ensureImportBadge } from '../songs/importbadge';
import { myGroupsHtml } from '../songs/mycards';

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
.lb-mine { margin-bottom: 1.75rem; }
.lb-mine-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.5rem; }
.lb-mine-head h2 { margin: 0; }
.lb-mine-note { font-size: 0.875rem; margin: 0 0 0.75rem; }
.lb-mine-help { font-size: 0.875rem; margin-bottom: 0.875rem; }
.lb-mine-help summary { min-height: 44px; padding: 0.75rem 0; box-sizing: border-box; cursor: pointer; color: var(--beige); }
.lb-mine-help ul { margin: 0.25rem 0 0; padding-left: 1.25rem; }
.lb-mine-help li { margin-bottom: 0.375rem; }
.lb-mine-help a { color: var(--beige); }
.lb-msg { font-size: 0.875rem; margin: 0 0 0.75rem; }
.lb-msg[data-kind='error'] { color: var(--bad); }
[data-queue] { margin-bottom: 1rem; }
.lb-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
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
    <section class="lb-mine" aria-labelledby="lb-mine-title">
      <div class="lb-mine-head">
        <h2 id="lb-mine-title">My songs</h2>
        <button class="btn btn--primary" type="button" data-load>Load songs</button>
        <input class="lb-file" type="file" multiple accept=".mid,.midi,.kar,audio/midi,audio/x-midi,.mp3,.m4a,.aac,.wav,.aif,.aiff,audio/*" tabindex="-1" aria-hidden="true" data-file>
      </div>
      <p class="lb-mine-note muted">MIDI files or audio recordings (MP3, M4A, WAV). Pick several at once. They stay on this device; use songs you own.</p>
      <details class="lb-mine-help">
        <summary>Which files work best?</summary>
        <ul class="muted">
          <li><b>MIDI</b> is exact. Buy one from a sheet-music or MIDI store, or make one in <a href="https://musescore.org" target="_blank" rel="noopener">MuseScore</a> (free): <a href="https://handbook.musescore.org/file-management/file-export" target="_blank" rel="noopener">File → Export → MIDI</a>. Piano arrangements with separate right- and left-hand tracks work best; for band files, pick the parts under Tracks.</li>
          <li><b>Audio</b> is turned into notes on this device, which takes about as long as the song. Solo piano recordings work best: search “&lt;song&gt; easy piano” for a piano cover. Full band mixes with vocals and drums give messy notes. Up to 6 minutes per song.</li>
          <li>The first audio file downloads the note model (about 1 MB), once.</li>
        </ul>
      </details>
      <p class="lb-msg" role="status" aria-live="polite" hidden></p>
      <div data-queue hidden></div>
      <div data-mine></div>
    </section>
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

  // ---- My songs ----
  const mineEl = root.querySelector<HTMLElement>('[data-mine]')!;
  const msg = root.querySelector<HTMLElement>('.lb-msg')!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-file]')!;
  const loadBtn = root.querySelector<HTMLButtonElement>('[data-load]')!;
  let editing = '';
  let confirming = '';

  const say = (text: string, kind: 'ok' | 'error' = 'ok') => {
    msg.hidden = !text;
    msg.textContent = text;
    msg.dataset.kind = kind;
  };
  const fail = (err: unknown) => say(err instanceof MidiImportError ? err.message : 'Keys couldn’t save that change.', 'error');

  const renderMine = () => {
    const list = mySongs();
    mineEl.hidden = !list.length;
    mineEl.innerHTML = myGroupsHtml(list, (id) => (editing === id ? 'edit' : confirming === id ? 'confirm' : 'view'));
    mineEl.querySelector<HTMLInputElement>('form input[name=title]')?.focus();
  };

  const queue = importQueue();
  ensureImportBadge();
  const stopQueueView = mountQueueView(root.querySelector<HTMLElement>('[data-queue]')!, queue);
  const stopMine = onMySongsChange(() => {
    if (!editing && !confirming) renderMine();
  });

  loadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (!files.length) return;
    say('');
    queue.add(files);
  });
  mineEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLButtonElement>('button');
    if (!b) return;
    try {
      if (b.dataset.edit) [editing, confirming] = [b.dataset.edit, ''];
      else if (b.dataset.delete) [confirming, editing] = [b.dataset.delete, ''];
      else if (b.dataset.deleteYes) {
        const title = getMySong(b.dataset.deleteYes)?.title ?? 'Song';
        confirming = '';
        deleteMySong(b.dataset.deleteYes);
        say(`Deleted “${title}”.`);
      } else if (b.hasAttribute('data-cancel')) editing = confirming = '';
      else return;
    } catch (err) {
      fail(err);
    }
    renderMine();
  });
  mineEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const field = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value;
    editing = '';
    try {
      updateMySong(form.dataset.rename!, { artist: field('artist') ?? undefined, title: field('title') ?? undefined });
      say('');
    } catch (err) {
      fail(err);
    }
    renderMine();
  });

  renderMine();
  render();
  return () => {
    stopQueueView();
    stopMine();
  };
};

export default screen;
