/**
 * "My songs" cards, grouped by artist (T25).
 *
 * Cards use the same shell as songCardHtml in ui.ts (.card.k-card link, eyebrow row, h3, composer
 * line, muted meta line, level stars). The actions sit under the card, outside the link, so the
 * buttons are never nested inside an <a>.
 */
import type { NoteEvent } from '../core/types';
import { bestStars } from '../core/store';
import type { MySong } from './mine';
import { LEVELS, LEVEL_LABEL, clock, esc, injectStyle, starsHtml } from './ui';

export interface ArtistGroup {
  /** '' for songs with no artist (shown as "Unknown artist", last). */
  artist: string;
  songs: MySong[];
}

export type CardMode = 'view' | 'edit' | 'confirm';
export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const sortKey = (artist: string) => artist.trim().replace(/^the\s+/i, '');

/** Groups sorted by artist (case-insensitive, "The " ignored), songs by title inside. */
export function groupByArtist(list: MySong[]): ArtistGroup[] {
  const groups = new Map<string, ArtistGroup>();
  for (const song of list) {
    const artist = (song.artist ?? '').trim();
    const key = artist.toLowerCase();
    const g = groups.get(key);
    if (g) g.songs.push(song);
    else groups.set(key, { artist, songs: [song] });
  }
  const out = [...groups.values()];
  for (const g of out) g.songs.sort((a, b) => collator.compare(a.title, b.title));
  return out.sort((a, b) => {
    if (!a.artist !== !b.artist) return a.artist ? -1 : 1;
    return collator.compare(sortKey(a.artist), sortKey(b.artist)) || collator.compare(a.artist, b.artist);
  });
}

/**
 * Difficulty from the hard level, measured at the song's own tempo:
 *   - notes per second over the span from the first to the last note;
 *   - chord share: of each hand's onsets, how many have 2+ notes at once;
 *   - the widest spread (both hands) in semitones.
 * Beginner:  < 1.5 notes/s, chords on under 20% of onsets, at most 3 notes at once.
 * Advanced:  ≥ 4.5 notes/s, or ≥ 3 notes/s with chords on 40%+ of onsets or a range over 4 octaves,
 *            or 6+ notes at once with ≥ 2.5 notes/s.
 * Everything else is Intermediate. An empty song is Beginner.
 */
export function difficultyOf(song: MySong): Difficulty {
  const notes: NoteEvent[] = song.levels?.hard ?? [];
  if (!notes.length) return 'Beginner';
  const bpm = song.bpm > 0 ? song.bpm : 120;
  let first = Infinity;
  let last = 0;
  let low = 127;
  let high = 0;
  const perHand = new Map<string, number>();
  const together = new Map<number, number>();
  for (const n of notes) {
    first = Math.min(first, n.start);
    last = Math.max(last, n.start + n.dur);
    low = Math.min(low, n.midi);
    high = Math.max(high, n.midi);
    const t = Math.round(n.start * 48);
    perHand.set(`${n.hand}${t}`, (perHand.get(`${n.hand}${t}`) ?? 0) + 1);
    together.set(t, (together.get(t) ?? 0) + 1);
  }
  const seconds = Math.max(1, ((last - first) * 60) / bpm);
  const nps = notes.length / seconds;
  const onsets = [...perHand.values()];
  const chordShare = onsets.filter((c) => c > 1).length / onsets.length;
  const maxTogether = Math.max(...together.values());
  const range = high - low;
  if (nps >= 4.5 || (nps >= 3 && (chordShare >= 0.4 || range > 48)) || (maxTogether >= 6 && nps >= 2.5)) return 'Advanced';
  if (nps < 1.5 && chordShare < 0.2 && maxTogether <= 3) return 'Beginner';
  return 'Intermediate';
}

const handsOf = (song: MySong) => (song.levels?.hard ?? []).some((n) => n.hand === 'L') ? 'Both hands' : 'Right hand';
const sourceLabel = (song: MySong) => (song.source === 'audio' ? 'From audio' : 'MIDI');

const CSS = `
.my-groups { display: flex; flex-direction: column; gap: 1.5rem; }
.my-group { min-width: 0; }
.my-group-h { display: flex; align-items: baseline; gap: 0.5rem; margin: 0 0 0.625rem; font-size: 1rem; color: var(--beige); min-width: 0; }
.my-group-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.my-group-count { flex: none; font-size: 0.8125rem; font-weight: 400; }
.my-item { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
.my-item > .k-card { flex: 1; min-width: 0; }
.my-card h3 { overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.my-card .k-card-composer, .my-card .k-card-blurb { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.my-card .k-card-top .eyebrow { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.my-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; }
.my-actions .btn { min-height: 44px; flex: 1 1 auto; }
.my-actions a.btn { text-decoration: none; color: inherit; }
.my-rename { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
.my-rename label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8125rem; min-width: 0; }
.my-rename input { width: 100%; box-sizing: border-box; min-height: 44px; padding: 0 0.875rem; border-radius: var(--radius-pill);
  border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 16px;
  -webkit-user-select: text; user-select: text; }
.my-rename input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.my-rename input::placeholder { color: var(--text-muted); }
.my-rename .my-actions { margin-top: 0.125rem; }
.my-confirm-q { flex: 1 1 100%; margin: 0; font-size: 0.9375rem; overflow-wrap: anywhere; }
`;
const style = () => {
  if (typeof document !== 'undefined') injectStyle('my-cards-style', CSS);
};

/**
 * One card plus its actions, in the same visual language as songCardHtml in ui.ts.
 * `mode` 'edit' shows an artist + title form (data-rename=id, inputs name="artist" and "title"),
 * 'confirm' a delete confirmation (data-delete-yes=id, data-cancel), otherwise buttons
 * data-edit=id, data-delete=id and, for multi-track MIDI songs, a link to #/tracks/<id>.
 */
export function mySongCardHtml(song: MySong, mode: CardMode = 'view'): string {
  style();
  const id = esc(song.id);
  const title = esc(song.title);
  const levels = LEVELS.map(
    (l) => `<span class="k-card-level"><span class="muted">${LEVEL_LABEL[l][0]}</span>${starsHtml(bestStars(song.id, l), false)}</span>`,
  ).join('');
  const aria = LEVELS.map((l) => `${LEVEL_LABEL[l]} ${bestStars(song.id, l)} stars`).join(', ');
  const meta = [song.durationSec > 0 ? clock(song.durationSec) : '', handsOf(song), difficultyOf(song)].filter(Boolean).join(' · ');
  const card = `<a class="card k-card my-card" href="#/song/${encodeURIComponent(song.id)}">
    <span class="k-card-top"><span class="eyebrow">${sourceLabel(song)}</span><span class="k-card-bpm muted">${song.bpm} BPM</span></span>
    <h3>${title}</h3>
    <span class="k-card-composer">${esc(song.artist || 'Unknown artist')}</span>
    <span class="k-card-blurb muted">${esc(meta)}</span>
    <span class="k-card-levels" aria-label="Best: ${aria}">${levels}</span>
  </a>`;

  let actions: string;
  if (mode === 'edit') {
    actions = `<form class="my-rename" data-rename="${id}">
      <label><span class="muted">Artist</span><input name="artist" value="${esc(song.artist)}" placeholder="Artist" maxlength="80" autocomplete="off" enterkeyhint="next"></label>
      <label><span class="muted">Title</span><input name="title" value="${title}" placeholder="Title" maxlength="80" required autocomplete="off" enterkeyhint="done"></label>
      <div class="my-actions">
        <button class="btn btn--primary" type="submit">Save</button>
        <button class="btn btn--ghost" type="button" data-cancel>Cancel</button>
      </div>
    </form>`;
  } else if (mode === 'confirm') {
    actions = `<div class="my-actions" role="group" aria-label="Delete ${title}">
      <p class="my-confirm-q">Delete “${title}”?</p>
      <button class="btn" type="button" data-delete-yes="${id}">Delete</button>
      <button class="btn btn--ghost" type="button" data-cancel>Keep</button>
    </div>`;
  } else {
    const tracks =
      song.multiTrack && song.source === 'midi'
        ? `<a class="btn btn--ghost" href="#/tracks/${encodeURIComponent(song.id)}" aria-label="Tracks of ${title}">Tracks</a>`
        : '';
    actions = `<div class="my-actions">
      <button class="btn btn--ghost" type="button" data-edit="${id}" aria-label="Rename ${title}">Rename</button>
      ${tracks}
      <button class="btn btn--ghost" type="button" data-delete="${id}" aria-label="Delete ${title}">Delete</button>
    </div>`;
  }
  return `<div class="my-item" data-song="${id}">${card}${actions}</div>`;
}

/**
 * The whole "My songs" list: one <section> per artist (groupByArtist order) with an h3 heading
 * ("Unknown artist" for songs with none) and a .grid of mySongCardHtml items. `modeFor(id)` says
 * which items are being renamed or confirming a delete. '' for an empty list.
 */
export function myGroupsHtml(list: MySong[], modeFor: (id: string) => CardMode): string {
  if (!list.length) return '';
  style();
  return `<div class="my-groups">${groupByArtist(list)
    .map((g) => {
      const name = esc(g.artist || 'Unknown artist');
      const n = g.songs.length;
      return `<section class="my-group" aria-label="${name}">
        <h3 class="my-group-h"><span class="my-group-name">${name}</span><span class="my-group-count muted">${n} ${n === 1 ? 'song' : 'songs'}</span></h3>
        <div class="grid">${g.songs.map((s) => mySongCardHtml(s, modeFor(s.id))).join('')}</div>
      </section>`;
    })
    .join('')}</div>`;
}
