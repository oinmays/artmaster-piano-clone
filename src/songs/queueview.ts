/**
 * The visible import queue panel (T24): one row per file with its status, a progress bar while
 * it converts, and Cancel / Open / Pick tracks. The list is re-rendered when an item's status
 * changes and patched in place for progress ticks, so focus and screen readers aren't disturbed;
 * status changes (not every %) are announced politely.
 */
import { esc, injectStyle } from './ui';
import { isFinished, type ImportQueue, type QueueItem } from './queue';

const css = `
.iq { padding: 0.75rem 1rem; }
.iq-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
.iq-head h2 { margin: 0; font-size: 1rem; }
.iq-head-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.iq .btn--sm { min-height: 44px; }
.iq-list { list-style: none; margin: 0.5rem 0 0; padding: 0; }
.iq-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0; border-top: 1px solid var(--surface-3); min-width: 0; }
.iq-row:first-child { border-top: 0; }
.iq-main { flex: 1 1 auto; min-width: 0; }
.iq-line { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.iq-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.iq-kind { flex: none; padding: 0.125rem 0.5rem; border-radius: var(--radius-pill); background: var(--surface-3); color: var(--beige); font-size: 0.75rem; }
.iq-status { font-size: 0.875rem; color: var(--text-muted); overflow-wrap: anywhere; }
.iq-row[data-status='done'] .iq-status { color: var(--good); }
.iq-row[data-status='failed'] .iq-status { color: var(--bad); }
.iq-row[data-status='duplicate'] .iq-status { color: var(--beige); }
.iq-bar { height: 4px; margin-top: 0.375rem; border-radius: var(--radius-pill); background: var(--surface-3); overflow: hidden; }
.iq-bar > span { display: block; height: 100%; background: var(--accent); border-radius: inherit; transition: width 0.2s; }
.iq-links { display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; margin-top: 0.125rem; }
.iq-links a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 0.25rem; color: var(--beige); font-size: 0.875rem; }
.iq-cancel { flex: none; }
.iq-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`;

const kindLabel = (it: QueueItem) => (it.unsupported ? '' : it.kind === 'midi' ? 'MIDI' : 'Audio');
const workingText = (it: QueueItem) => `${it.phase || 'Importing'} ${it.progress}%`;

function statusText(it: QueueItem): string {
  switch (it.status) {
    case 'waiting':
      return 'Waiting';
    case 'working':
      return workingText(it);
    case 'done':
      return 'Added';
    case 'failed':
      return `Failed: ${it.error ?? 'Keys couldn’t read that file.'}`;
    case 'duplicate':
      return it.error ?? 'Already in My songs.';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** What a screen reader hears when an item reaches this status ('' for none). */
function announcement(it: QueueItem): string {
  switch (it.status) {
    case 'done':
      return `${it.name} added.`;
    case 'failed':
      return `${it.name} failed: ${it.error ?? ''}`;
    case 'duplicate':
      return `${it.name}: ${it.error ?? 'already in My songs.'}`;
    default:
      return '';
  }
}

function rowHtml(it: QueueItem): string {
  const name = esc(it.name);
  const kind = kindLabel(it);
  const links: string[] = [];
  if ((it.status === 'done' || it.status === 'duplicate') && it.songId) {
    const id = encodeURIComponent(it.songId);
    links.push(`<a href="#/song/${id}" aria-label="Open ${name}">Open</a>`);
    if (it.status === 'done' && it.multiTrack) links.push(`<a href="#/tracks/${id}" aria-label="Pick tracks for ${name}">Pick tracks</a>`);
  }
  const bar =
    it.status === 'working'
      ? `<div class="iq-bar" role="progressbar" aria-label="${name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${it.progress}" aria-valuetext="${esc(workingText(it))}"><span style="width:${it.progress}%"></span></div>`
      : '';
  const cancel = isFinished(it.status)
    ? ''
    : `<button type="button" class="btn btn--ghost btn--sm iq-cancel" data-cancel="${esc(it.id)}" aria-label="Cancel ${name}">Cancel</button>`;
  return `<li class="iq-row" data-id="${esc(it.id)}" data-status="${it.status}">
    <div class="iq-main">
      <div class="iq-line"><span class="iq-name" title="${name}">${name}</span>${kind ? `<span class="iq-kind">${kind}</span>` : ''}</div>
      <div class="iq-status">${esc(statusText(it))}</div>
      ${bar}
      ${links.length ? `<div class="iq-links">${links.join('')}</div>` : ''}
    </div>
    ${cancel}
  </li>`;
}

/** Everything that needs a full re-render when it changes (progress and phase don't). */
const shapeOf = (items: QueueItem[]) => items.map((it) => `${it.id}:${it.status}:${it.songId ?? ''}:${it.multiTrack ? 1 : 0}`).join('|');

/** A selector for the focused control, to put focus back after a re-render. */
function focusKey(el: HTMLElement): string | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !el.contains(a)) return null;
  for (const attr of ['data-cancel', 'data-cancel-all', 'data-clear']) {
    if (a.hasAttribute(attr)) return attr === 'data-cancel' ? `[data-cancel="${a.getAttribute(attr)}"]` : `[${attr}]`;
  }
  const href = a.getAttribute('href');
  return href ? `a[href="${href}"]` : null;
}

/** Render the queue into `el` and keep it current; returns a cleanup function. Hidden when the queue is empty. */
export function mountQueueView(el: HTMLElement, queue: ImportQueue): () => void {
  injectStyle('iq-style', css);
  el.innerHTML = `<section class="card iq" aria-labelledby="iq-title">
    <div data-iq-body></div>
    <p class="iq-sr" role="status" aria-live="polite" data-iq-live></p>
  </section>`;
  const body = el.querySelector<HTMLElement>('[data-iq-body]')!;
  const live = el.querySelector<HTMLElement>('[data-iq-live]')!;
  let shape: string | null = null;
  let wasBusy = false;
  const seen = new Map<string, string>();

  const render = (items: QueueItem[]) => {
    el.hidden = items.length === 0;
    const busy = items.some((it) => !isFinished(it.status));

    // Announce status changes since the last render (not on first render).
    if (shape !== null) {
      const said = items.filter((it) => seen.get(it.id) !== it.status).map(announcement).filter(Boolean);
      if (wasBusy && !busy && items.length) said.push('Imports finished.');
      if (said.length) live.textContent = said.join(' ');
    }
    seen.clear();
    for (const it of items) seen.set(it.id, it.status);
    wasBusy = busy;

    const next = `${shapeOf(items)}#${busy}`;
    if (next === shape) {
      // Only progress moved: patch the working rows in place.
      for (const it of items) {
        if (it.status !== 'working') continue;
        const row = body.querySelector<HTMLElement>(`[data-id="${it.id}"]`);
        if (!row) continue;
        const text = workingText(it);
        row.querySelector('.iq-status')!.textContent = text;
        const bar = row.querySelector<HTMLElement>('.iq-bar');
        if (bar) {
          bar.setAttribute('aria-valuenow', String(it.progress));
          bar.setAttribute('aria-valuetext', text);
          (bar.firstElementChild as HTMLElement).style.width = `${it.progress}%`;
        }
      }
      return;
    }
    shape = next;
    const focused = focusKey(el);
    const hadFocus = focused !== null || (document.activeElement instanceof HTMLElement && body.contains(document.activeElement));
    const finished = items.some((it) => isFinished(it.status));
    body.innerHTML = `<div class="iq-head">
        <h2 id="iq-title" tabindex="-1">${busy ? 'Importing' : 'Imports'}</h2>
        <div class="iq-head-actions">
          ${busy ? '<button type="button" class="btn btn--ghost btn--sm" data-cancel-all aria-label="Cancel all imports">Cancel all</button>' : ''}
          ${finished ? '<button type="button" class="btn btn--ghost btn--sm" data-clear aria-label="Clear finished imports">Clear</button>' : ''}
        </div>
      </div>
      <ul class="iq-list">${items.map(rowHtml).join('')}</ul>`;
    if (hadFocus) {
      const target =
        (focused && body.querySelector<HTMLElement>(focused)) ||
        body.querySelector<HTMLElement>('[data-cancel], [data-cancel-all], [data-clear]') ||
        (el.hidden ? null : body.querySelector<HTMLElement>('#iq-title'));
      target?.focus();
    }
  };

  const onClick = (ev: MouseEvent) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-cancel], [data-cancel-all], [data-clear]');
    if (!t || !el.contains(t)) return;
    if (t.hasAttribute('data-cancel')) queue.cancel(t.getAttribute('data-cancel')!);
    else if (t.hasAttribute('data-cancel-all')) queue.cancelAll();
    else queue.clearFinished();
  };
  el.addEventListener('click', onClick);
  const off = queue.subscribe(render);
  return () => {
    off();
    el.removeEventListener('click', onClick);
  };
}
