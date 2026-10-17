/**
 * Tracks sheet (T26): choose which parts of an imported MIDI song each hand plays.
 * Route: /tracks/:id. Saving re-splits the song from the original file and returns to its page.
 */
import type { Screen } from '../core/types';
import { navigate } from '../core/router';
import { midiToName } from '../core/music';
import { gmName } from '../songs/gm';
import { MidiImportError, autoRoles, partsOf, type RawNote, type TrackInfo, type TrackRole, type TrackRoles } from '../songs/midifile';
import { applyTrackRoles, getMySong, getSongTracks } from '../songs/mine';
import { esc, injectStyle } from '../songs/ui';

const css = `
.trk-back { display: inline-flex; align-items: center; gap: 0.25rem; min-height: 44px; margin: -0.5rem 0 0.25rem;
  color: var(--text-muted); text-decoration: none; font-size: 0.9375rem; }
.trk-head h1 { color: var(--beige); margin-bottom: 0.25rem; overflow-wrap: anywhere; }
.trk-head p { margin: 0.25rem 0 0; }
.trk-list { display: grid; gap: 0; padding-top: 0.25rem; padding-bottom: 0.25rem; margin-top: 1rem; }
.trk-row { display: grid; gap: 0.75rem; padding: 1rem 0; border-top: 1px solid var(--surface-3); min-width: 0; }
.trk-row:first-child { border-top: 0; }
.trk-info { min-width: 0; }
.trk-info b { display: block; font-weight: 500; font-size: 1.0625rem; overflow-wrap: anywhere; }
.trk-info span { display: block; font-size: 0.875rem; color: var(--text-muted); overflow-wrap: anywhere; }
.trk-info em { display: block; font-style: normal; font-size: 0.875rem; color: var(--text-muted); margin-top: 0.25rem; }
.trk-seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.375rem; }
.trk-seg .btn { min-height: 44px; min-width: 0; padding: 0.375rem 0.5rem; flex-direction: column; gap: 0; line-height: 1.2; white-space: normal; text-align: center; }
.trk-seg .btn small { font-size: 0.6875rem; opacity: 0.8; font-weight: 400; }
@media (min-width: 560px) { .trk-seg { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (min-width: 900px) {
  .trk-row { grid-template-columns: minmax(0, 1fr) minmax(0, 30rem); align-items: center; gap: 1.25rem; }
}
.trk-foot { display: grid; gap: 0.75rem; margin-top: 1rem; }
.trk-sum { margin: 0; }
.trk-msg { margin: 0; color: var(--bad); }
.trk-msg:empty { display: none; }
.trk-actions { display: flex; flex-wrap: wrap; gap: 0.625rem; }
.trk-actions .btn { min-height: 48px; flex: 1 1 10rem; }
.trk-missing { text-align: center; padding: 3rem 1rem; }
`;

const ROLES: { role: TrackRole; label: string; hint?: string }[] = [
  { role: 'R', label: 'Right hand' },
  { role: 'L', label: 'Left hand' },
  { role: 'split', label: 'Both', hint: 'Split at middle C' },
  { role: 'off', label: 'Ignore' },
];

/** Labels carry the automatic pick ("Piano (RH)"); here the buttons show the hand instead. */
const plainLabel = (t: TrackInfo) => t.label.replace(/ \((RH|LH)\)$/, '');
const instrument = (t: TrackInfo) => (t.drums ? 'Drums' : t.program === null ? 'No instrument set' : gmName(t.program));
const range = (t: TrackInfo) => (t.low === t.high ? midiToName(t.low) : `${midiToName(t.low)}–${midiToName(t.high)}`);
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

const screen: Screen = (root, params) => {
  injectStyle('trk-style', css);
  const id = params.id ?? '';
  const song = getMySong(id);
  const back = `#/song/${encodeURIComponent(id)}`;
  let alive = true;

  const missing = (title: string, body: string) => {
    root.innerHTML = `<section class="screen"><div class="card trk-missing">
      <h2>${esc(title)}</h2><p class="muted">${esc(body)}</p>
      <a class="btn btn--primary" href="${song ? back : '#/library'}">${song ? 'Back to the song' : 'Browse songs'}</a></div></section>`;
  };

  if (!song) {
    missing('Song not found', 'It may have been deleted from My songs.');
    return;
  }
  if (song.source !== 'midi') {
    missing('No tracks to choose', 'Only MIDI songs have tracks. This one was made from an audio recording.');
    return;
  }

  root.innerHTML = `<section class="screen trk"><p class="muted">Reading the tracks…</p></section>`;

  void (async () => {
    let found: Awaited<ReturnType<typeof getSongTracks>>;
    try {
      found = await getSongTracks(id);
    } catch (e) {
      if (alive) missing('Couldn’t read the tracks', e instanceof MidiImportError ? e.message : 'Something went wrong reading the original MIDI file.');
      return;
    }
    if (!alive) return;
    if (!found) {
      missing('Tracks aren’t available', 'The original MIDI file isn’t on this device, so its tracks can’t be changed. Import it again to choose tracks.');
      return;
    }
    render(found.tracks, found.roles, partsOf(found.midi));
  })();

  function render(tracks: TrackInfo[], saved: TrackRoles, parts: Map<number, RawNote[]>) {
    const roles: TrackRoles = {};
    for (const t of tracks) roles[String(t.key)] = t.drums ? 'off' : (saved[String(t.key)] ?? 'off');

    root.innerHTML = `<section class="screen trk">
      <a class="trk-back" href="${back}">‹ ${esc(song!.title)}</a>
      <header class="card trk-head">
        <p class="eyebrow">Tracks</p>
        <h1>${esc(song!.title)}</h1>
        <p class="muted">Choose which parts you play with each hand. Parts you ignore won’t appear in the song.</p>
      </header>
      <div class="card trk-list">
        ${tracks
          .map((t) => {
            const name = plainLabel(t);
            return `<div class="trk-row" data-key="${t.key}">
              <div class="trk-info">
                <b>${esc(name)}</b>
                <span>${esc(instrument(t))} · ${plural(t.notes, 'note')} · ${range(t)}</span>
                ${t.drums ? '<em>Drums can’t be played on the piano.</em>' : ''}
              </div>
              <div class="trk-seg" role="group" aria-label="${esc(`Hand for ${name}`)}">
                ${ROLES.map(
                  (r) => `<button type="button" class="btn" data-role="${r.role}" aria-pressed="false"${t.drums ? ' disabled' : ''}>
                    <span>${r.label}</span>${r.hint ? `<small>${r.hint}</small>` : ''}</button>`,
                ).join('')}
              </div>
            </div>`;
          })
          .join('')}
      </div>
      <div class="card trk-foot">
        <p class="trk-sum muted" data-sum aria-live="polite"></p>
        <p class="trk-msg" role="status" data-msg></p>
        <div class="trk-actions">
          <button type="button" class="btn btn--ghost" data-auto>Use Keys’ picks</button>
          <button type="button" class="btn btn--primary" data-save>Save</button>
        </div>
      </div>
    </section>`;

    const msg = root.querySelector<HTMLElement>('[data-msg]')!;
    const saveBtn = root.querySelector<HTMLButtonElement>('[data-save]')!;

    const update = () => {
      let right = 0;
      let left = 0;
      for (const t of tracks) {
        if (t.drums) continue;
        const role = roles[String(t.key)];
        const notes = parts.get(t.key) ?? [];
        if (role === 'R') right += notes.length;
        else if (role === 'L') left += notes.length;
        else if (role === 'split') {
          const high = notes.filter((n) => n.midi >= 60).length;
          right += high;
          left += notes.length - high;
        }
      }
      root.querySelectorAll<HTMLElement>('.trk-row').forEach((row) => {
        const role = roles[row.dataset.key!];
        row.querySelectorAll<HTMLElement>('[data-role]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.role === role)));
      });
      root.querySelector('[data-sum]')!.textContent =
        right + left ? `Right hand: about ${plural(right, 'note')} · Left hand: about ${plural(left, 'note')}` : 'No hand has anything to play yet.';
    };

    root.querySelector('.trk-list')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-role]');
      const row = b?.closest<HTMLElement>('.trk-row');
      if (!b || !row || b.disabled) return;
      roles[row.dataset.key!] = b.dataset.role as TrackRole;
      msg.textContent = '';
      update();
    });

    root.querySelector('[data-auto]')!.addEventListener('click', () => {
      Object.assign(roles, autoRoles(tracks));
      msg.textContent = '';
      update();
    });

    saveBtn.addEventListener('click', async () => {
      if (!tracks.some((t) => !t.drums && roles[String(t.key)] !== 'off')) {
        msg.textContent = 'Pick at least one track for a hand.';
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      msg.textContent = '';
      try {
        await applyTrackRoles(id, { ...roles });
        if (alive) navigate(`/song/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!alive) return;
        msg.textContent = e instanceof MidiImportError ? e.message : 'Keys couldn’t save those tracks. Please try again.';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });

    update();
  }

  return () => {
    alive = false;
  };
};

export default screen;
