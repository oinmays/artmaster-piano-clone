import type { Screen, Song } from '../core/types';
import { SONGS, allTags } from '../songs';
import { esc, injectStyle, songCardHtml } from '../songs/ui';
import { MidiImportError } from '../songs/midifile';
import { deleteMySong, importMidiFile, mySongs, renameMySong } from '../songs/mine';

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
.lb-mine-item { display: flex; flex-direction: column; gap: 0.5rem; }
.lb-mine-item > .k-card { flex: 1; }
.lb-mine-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.lb-mine-actions .btn { min-height: 44px; }
.lb-mine-actions input { flex: 1 1 140px; min-height: 44px; padding: 0 0.75rem; border-radius: var(--radius-pill);
  border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 16px;
  -webkit-user-select: text; user-select: text; }
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
        <button class="btn btn--primary" type="button" data-load>Load a MIDI file</button>
        <input class="lb-file" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" tabindex="-1" aria-hidden="true" data-file>
      </div>
      <p class="lb-mine-note muted">Your file stays on this device. Use songs you own.</p>
      <details class="lb-mine-help">
        <summary>Where do I get a MIDI file?</summary>
        <ul class="muted">
          <li>Buy one from a sheet-music or MIDI store that sells MIDI downloads for the song.</li>
          <li>Make one in <a href="https://musescore.org" target="_blank" rel="noopener">MuseScore</a> (free): open or write the score, then <a href="https://handbook.musescore.org/file-management/file-export" target="_blank" rel="noopener">File → Export → MIDI</a>.</li>
          <li>From GarageBand: it only saves audio, so open the project in Logic Pro, select the regions and choose File → Export → Selection as MIDI File.</li>
          <li>Piano arrangements with separate right- and left-hand tracks work best.</li>
        </ul>
      </details>
      <p class="lb-msg" role="status" aria-live="polite" hidden></p>
      <div class="grid" data-mine></div>
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
  const fail = (err: unknown) =>
    say(err instanceof MidiImportError ? err.message : 'Keys couldn’t read that file. Try exporting it again as a standard MIDI file.', 'error');

  const renderMine = () => {
    const list = mySongs();
    mineEl.hidden = !list.length;
    mineEl.innerHTML = list
      .map((s) => {
        const id = esc(s.id);
        const actions =
          editing === s.id
            ? `<form class="lb-mine-actions" data-rename="${id}">
                 <input name="title" value="${esc(s.title)}" maxlength="80" aria-label="Song title" autocomplete="off" enterkeyhint="done">
                 <button class="btn btn--primary" type="submit">Save</button>
                 <button class="btn btn--ghost" type="button" data-cancel>Cancel</button></form>`
            : confirming === s.id
              ? `<div class="lb-mine-actions"><span class="muted" style="align-self:center">Delete “${esc(s.title)}”?</span>
                 <button class="btn" type="button" data-delete-yes="${id}">Delete</button>
                 <button class="btn btn--ghost" type="button" data-cancel>Keep</button></div>`
              : `<div class="lb-mine-actions">
                 <button class="btn btn--ghost" type="button" data-edit="${id}" aria-label="Rename ${esc(s.title)}">Rename</button>
                 <button class="btn btn--ghost" type="button" data-delete="${id}" aria-label="Delete ${esc(s.title)}">Delete</button></div>`;
        return `<div class="lb-mine-item">${songCardHtml(s)}${actions}</div>`;
      })
      .join('');
    mineEl.querySelector<HTMLInputElement>('form input')?.focus();
  };

  loadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    loadBtn.disabled = true;
    say('Reading your file…');
    try {
      const song = await importMidiFile(file);
      say(`Added “${song.title}”: ${song.levels.hard.length} notes, ${song.bpm} BPM.`);
      editing = confirming = '';
      renderMine();
    } catch (err) {
      fail(err);
    } finally {
      loadBtn.disabled = false;
    }
  });
  mineEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLButtonElement>('button');
    if (!b) return;
    try {
      if (b.dataset.edit) [editing, confirming] = [b.dataset.edit, ''];
      else if (b.dataset.delete) [confirming, editing] = [b.dataset.delete, ''];
      else if (b.dataset.deleteYes) {
        const title = mySongs().find((s) => s.id === b.dataset.deleteYes)?.title ?? 'Song';
        deleteMySong(b.dataset.deleteYes);
        confirming = '';
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
    try {
      renameMySong(form.dataset.rename!, (form.elements.namedItem('title') as HTMLInputElement).value);
      say('');
    } catch (err) {
      fail(err);
    }
    editing = '';
    renderMine();
  });

  renderMine();
  render();
};

export default screen;
