import type { HandsMode, Level, NoteEvent, Screen, Song } from '../core/types';
import { bestStars, load, save } from '../core/store';
import { getAudioContext, playNote, unlockAudio, type Voice } from '../core/audio';
import { navigate } from '../core/router';
import { barCount, getSong, lengthBeats, notesInBars } from '../songs';
import { LEVELS, LEVEL_LABEL, clock, esc, injectStyle, starsHtml } from '../songs/ui';

/** Options remembered per song. */
interface SongOptions {
  level: Level;
  hands: HandsMode;
  tempo: number;
  wait: boolean;
  /** True once the learner has flipped wait mode themselves (stops level changes overriding it). */
  waitSet: boolean;
  loop: boolean;
  loopFrom: number;
  loopTo: number;
}

const PREVIEW_BARS = 8;

const css = `
.sg-back { display: inline-flex; align-items: center; gap: 0.25rem; min-height: 44px; margin: -0.5rem 0 0.25rem;
  color: var(--text-muted); text-decoration: none; font-size: 0.9375rem; }
.sg-layout { display: grid; gap: 1rem; grid-template-columns: 1fr; align-items: start; }
@media (min-width: 900px) { .sg-layout { grid-template-columns: 1fr 1.15fr; } .sg-head { position: sticky; top: 1rem; } }
.sg-head h1 { color: var(--beige); margin-bottom: 0.25rem; }
.sg-head .sg-composer { font-size: 1.0625rem; margin-bottom: 0.25rem; }
.sg-head .row { margin: 0.75rem 0; }
.sg-head .sg-actions { margin-top: 1.25rem; display: grid; grid-template-columns: 1fr 1.6fr; gap: 0.625rem; }
.sg-head .sg-actions .btn { min-height: 52px; font-size: 1.0625rem; }
.sg-opts { display: grid; gap: 1.25rem; }
.sg-field > .sg-label { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; margin-bottom: 0.5rem; }
.sg-field > .sg-label b { font-weight: 500; }
.sg-field > .sg-label span { font-size: 0.875rem; color: var(--text-muted); text-align: right; }
.sg-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.375rem; }
.sg-seg .btn { padding: 0 0.5rem; min-width: 0; }
.sg-level { flex-direction: column; gap: 0.125rem; min-height: 72px; padding: 0.5rem; }
.sg-level small { font-size: 0.75rem; opacity: 0.8; font-weight: 400; }
.sg-level[aria-pressed='true'] .k-stars { color: rgba(21, 21, 20, 0.25); }
.sg-level[aria-pressed='true'] .k-stars-on { color: var(--accent); }
.sg-range { width: 100%; height: 44px; margin: 0; accent-color: var(--accent); touch-action: pan-y; }
.sg-scale { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); }
.sg-presets { display: flex; gap: 0.375rem; margin-top: 0.5rem; flex-wrap: wrap; }
.sg-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 44px; }
.sg-toggle-row p { margin: 0.125rem 0 0; font-size: 0.875rem; }
.sg-switch { flex: none; position: relative; width: 56px; height: 44px; border: 0; background: none; padding: 0; cursor: pointer; }
.sg-switch::before { content: ''; position: absolute; left: 0; right: 0; top: 8px; height: 28px; border-radius: 999px; background: var(--surface-3); transition: background 150ms; }
.sg-switch::after { content: ''; position: absolute; left: 3px; top: 11px; width: 22px; height: 22px; border-radius: 50%; background: var(--beige); transition: transform 150ms; }
.sg-switch[aria-checked='true']::before { background: var(--accent); }
.sg-switch[aria-checked='true']::after { transform: translateX(28px); background: #fff; }
.sg-loop { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.75rem; }
.sg-loop[hidden] { display: none; }
.sg-stepper { display: flex; align-items: center; justify-content: space-between; gap: 0.25rem; background: var(--surface-2);
  border-radius: var(--radius-sm); padding: 0.25rem; }
.sg-stepper .btn { width: 44px; padding: 0; font-size: 1.25rem; }
.sg-stepper output { text-align: center; line-height: 1.1; }
.sg-stepper output small { display: block; font-size: 0.6875rem; color: var(--text-muted); }
.sg-stepper output b { font-size: 1.25rem; font-weight: 500; }
.sg-preview[aria-pressed='true'] { background: var(--surface-3); color: var(--text); border-color: var(--accent); }
.sg-missing { text-align: center; padding: 3rem 1rem; }
`;

function defaults(song: Song): SongOptions {
  return { level: 'easy', hands: 'R', tempo: 100, wait: true, waitSet: false, loop: false, loopFrom: 1, loopTo: Math.min(4, barCount(song, 'easy')) };
}

function loadOptions(song: Song): SongOptions {
  const saved = load<Partial<SongOptions>>(`songOpts.${song.id}`, {});
  const o = { ...defaults(song), ...saved };
  if (!LEVELS.includes(o.level)) o.level = 'easy';
  if (!['both', 'L', 'R'].includes(o.hands)) o.hands = 'R';
  if (o.level === 'easy') o.hands = 'R';
  o.tempo = Math.max(25, Math.min(150, Math.round(Number(o.tempo) || 100)));
  return o;
}

function handsFilter(notes: NoteEvent[], hands: HandsMode): NoteEvent[] {
  return hands === 'both' ? notes : notes.filter((n) => n.hand === hands);
}

const screen: Screen = (root, params) => {
  injectStyle('sg-style', css);
  const song = getSong(params.id ?? '');
  if (!song) {
    root.innerHTML = `<section class="screen"><div class="card sg-missing">
      <h2>Song not found</h2><p class="muted">It may have been removed from the library.</p>
      <a class="btn btn--primary" href="#/library">Browse songs</a></div></section>`;
    return;
  }

  const o = loadOptions(song);
  const persist = () => save(`songOpts.${song.id}`, o);
  const eighthBeats = song.id === 'fur-elise'; // written in eighth-note beats (3/8)
  const meter = eighthBeats ? '3/8' : `${song.beatsPerBar}/4`;

  root.innerHTML = `<section class="screen sg">
    <a class="sg-back" href="#/library">‹ Songs</a>
    <div class="sg-layout">
      <header class="card sg-head">
        <p class="eyebrow">${esc(song.blurb)}</p>
        <h1>${esc(song.title)}</h1>
        <p class="sg-composer muted">${esc(song.composer)}</p>
        <div class="row">
          <span class="chip">${esc(song.key)}</span><span class="chip">${meter}</span><span class="chip">${song.bpm} BPM</span>
          ${song.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
        </div>
        <p class="muted" data-summary></p>
        <div class="sg-actions">
          <button type="button" class="btn sg-preview" data-preview aria-pressed="false">Preview</button>
          <button type="button" class="btn btn--primary" data-start>Start</button>
        </div>
      </header>

      <div class="card sg-opts">
        <div class="sg-field">
          <div class="sg-label"><b>Level</b><span data-level-hint></span></div>
          <div class="sg-seg" role="group" aria-label="Level">
            ${LEVELS.map(
              (l) => `<button type="button" class="btn sg-level" data-level="${l}" aria-pressed="false">
                <span>${LEVEL_LABEL[l]}</span><small>${song.levels[l].length} notes</small>${starsHtml(bestStars(song.id, l))}
              </button>`,
            ).join('')}
          </div>
        </div>

        <div class="sg-field">
          <div class="sg-label"><b>Hands</b><span data-hands-hint></span></div>
          <div class="sg-seg" role="group" aria-label="Hands">
            <button type="button" class="btn" data-hands="both" aria-pressed="false">Both</button>
            <button type="button" class="btn" data-hands="R" aria-pressed="false">Right</button>
            <button type="button" class="btn" data-hands="L" aria-pressed="false">Left</button>
          </div>
        </div>

        <div class="sg-field">
          <div class="sg-label"><b>Tempo</b><span data-tempo-out></span></div>
          <input class="sg-range" type="range" min="25" max="150" step="5" aria-label="Tempo percent" data-tempo>
          <div class="sg-scale"><span>25%</span><span>100%</span><span>150%</span></div>
          <div class="sg-presets">
            ${[50, 75, 100].map((p) => `<button type="button" class="btn btn--sm" data-tempo-preset="${p}">${p}%</button>`).join('')}
          </div>
        </div>

        <div class="sg-field">
          <div class="sg-toggle-row">
            <div><b>Wait mode</b><p class="muted">The music waits until you play the right note.</p></div>
            <button type="button" class="sg-switch" role="switch" aria-label="Wait mode" data-wait></button>
          </div>
        </div>

        <div class="sg-field">
          <div class="sg-toggle-row">
            <div><b>Loop a section</b><p class="muted" data-loop-hint></p></div>
            <button type="button" class="sg-switch" role="switch" aria-label="Loop a section" data-loop></button>
          </div>
          <div class="sg-loop" data-loop-box>
            <div class="sg-stepper">
              <button type="button" class="btn" data-step="from:-1" aria-label="Loop start earlier">−</button>
              <output data-from-out><small>From bar</small><b></b></output>
              <button type="button" class="btn" data-step="from:1" aria-label="Loop start later">+</button>
            </div>
            <div class="sg-stepper">
              <button type="button" class="btn" data-step="to:-1" aria-label="Loop end earlier">−</button>
              <output data-to-out><small>To bar</small><b></b></output>
              <button type="button" class="btn" data-step="to:1" aria-label="Loop end later">+</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>`;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const tempoInput = $<HTMLInputElement>('[data-tempo]');
  tempoInput.value = String(o.tempo);

  const bars = () => barCount(song, o.level);
  const clampLoop = () => {
    const n = bars();
    o.loopFrom = Math.max(1, Math.min(n, Math.round(o.loopFrom) || 1));
    o.loopTo = Math.max(o.loopFrom, Math.min(n, Math.round(o.loopTo) || n));
  };

  const update = () => {
    clampLoop();
    const n = bars();
    const bpm = Math.round((song.bpm * o.tempo) / 100);
    const notes = handsFilter(song.levels[o.level], o.hands);
    const beats = o.loop ? (o.loopTo - o.loopFrom + 1) * song.beatsPerBar : lengthBeats(song.levels[o.level]);
    const secs = (beats * 60) / bpm;

    $$('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === o.level)));
    $('[data-level-hint]').textContent =
      o.level === 'easy' ? 'Right-hand melody' : o.level === 'medium' ? 'Melody + left-hand roots' : 'Melody + full left hand';

    $$<HTMLButtonElement>('[data-hands]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.hands === o.hands));
      b.disabled = o.level === 'easy' && b.dataset.hands !== 'R';
    });
    $('[data-hands-hint]').textContent = o.level === 'easy' ? 'Easy is right hand only' : `${notes.length} notes to play`;

    $('[data-tempo-out]').textContent = `${o.tempo}% · ${bpm} BPM`;
    $$('[data-tempo-preset]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.tempoPreset) === o.tempo)));

    $('[data-wait]').setAttribute('aria-checked', String(o.wait));
    $('[data-loop]').setAttribute('aria-checked', String(o.loop));
    $('[data-loop-box]').hidden = !o.loop;
    $('[data-loop-hint]').textContent = o.loop ? `Bars ${o.loopFrom}–${o.loopTo} of ${n}` : `Repeat any bars, ${n} in this level`;
    $('[data-from-out] b').textContent = String(o.loopFrom);
    $('[data-to-out] b').textContent = String(o.loopTo);
    $$<HTMLButtonElement>('[data-step]').forEach((b) => {
      const [which, d] = b.dataset.step!.split(':');
      const v = (which === 'from' ? o.loopFrom : o.loopTo) + Number(d);
      b.disabled = which === 'from' ? v < 1 || v > o.loopTo : v < o.loopFrom || v > n;
    });

    $('[data-summary]').textContent = `${LEVEL_LABEL[o.level]} · ${n} bars · about ${clock(secs)}${o.loop ? ' per loop' : ''} at ${bpm} BPM`;
  };

  // ---- Preview ------------------------------------------------------------
  let preview: { timer: number; voices: Voice[] } | null = null;
  const previewBtn = $<HTMLButtonElement>('[data-preview]');

  const stopPreview = () => {
    if (!preview) return;
    clearInterval(preview.timer);
    preview.voices.forEach((v) => v.stop());
    preview = null;
    previewBtn.setAttribute('aria-pressed', 'false');
    previewBtn.textContent = 'Preview';
  };

  const startPreview = async () => {
    await unlockAudio();
    if (preview) return;
    const ctx = getAudioContext();
    const from = o.loop ? o.loopFrom : 1;
    const to = o.loop ? o.loopTo : Math.min(bars(), PREVIEW_BARS);
    const sel = notesInBars(song, handsFilter(song.levels[o.level], o.hands), from, to);
    if (!sel.length) return;
    const spb = 60 / ((song.bpm * o.tempo) / 100);
    const offset = (from - 1) * song.beatsPerBar;
    const t0 = ctx.currentTime + 0.15;
    const end = t0 + (lengthBeats(sel) - offset) * spb + 0.3;
    const voices: Voice[] = [];
    let i = 0;
    const tick = () => {
      const horizon = ctx.currentTime + 0.35;
      while (i < sel.length && t0 + (sel[i].start - offset) * spb < horizon) {
        const n = sel[i++];
        voices.push(
          playNote(n.midi, {
            when: Math.max(ctx.currentTime, t0 + (n.start - offset) * spb),
            duration: Math.min(2.5, Math.max(0.3, n.dur * spb + 0.25)),
            velocity: n.hand === 'L' ? 0.5 : 0.8,
          }),
        );
      }
      if (voices.length > 64) voices.splice(0, voices.length - 64);
      if (i >= sel.length && ctx.currentTime > end) stopPreview();
    };
    preview = { timer: window.setInterval(tick, 50), voices };
    previewBtn.setAttribute('aria-pressed', 'true');
    previewBtn.textContent = 'Stop';
    tick();
  };

  // ---- Events ---------------------------------------------------------------
  const change = (fn: () => void) => {
    fn();
    stopPreview();
    update();
    persist();
  };

  root.querySelector('.sg-opts')!.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const level = t.closest<HTMLElement>('[data-level]')?.dataset.level as Level | undefined;
    if (level) {
      return change(() => {
        const wasEasy = o.level === 'easy';
        o.level = level;
        if (level === 'easy') o.hands = 'R';
        else if (wasEasy) o.hands = 'both';
        if (!o.waitSet) o.wait = level === 'easy';
      });
    }
    const hands = t.closest<HTMLButtonElement>('[data-hands]');
    if (hands && !hands.disabled) return change(() => (o.hands = hands.dataset.hands as HandsMode));
    const preset = t.closest<HTMLElement>('[data-tempo-preset]');
    if (preset) {
      return change(() => {
        o.tempo = Number(preset.dataset.tempoPreset);
        tempoInput.value = String(o.tempo);
      });
    }
    if (t.closest('[data-wait]')) {
      return change(() => {
        o.wait = !o.wait;
        o.waitSet = true;
      });
    }
    if (t.closest('[data-loop]')) return change(() => (o.loop = !o.loop));
    const step = t.closest<HTMLButtonElement>('[data-step]');
    if (step && !step.disabled) {
      const [which, d] = step.dataset.step!.split(':');
      return change(() => {
        if (which === 'from') o.loopFrom += Number(d);
        else o.loopTo += Number(d);
      });
    }
  });

  tempoInput.addEventListener('input', () => change(() => (o.tempo = Number(tempoInput.value))));

  previewBtn.addEventListener('click', () => {
    if (preview) stopPreview();
    else void startPreview();
  });

  $('[data-start]').addEventListener('click', () => {
    stopPreview();
    persist();
    const q = new URLSearchParams({
      level: o.level,
      hands: o.level === 'easy' ? 'R' : o.hands,
      tempo: String(o.tempo),
      wait: o.wait ? '1' : '0',
    });
    if (o.loop) {
      q.set('loopFrom', String(o.loopFrom));
      q.set('loopTo', String(o.loopTo));
    }
    void unlockAudio();
    navigate(`/play/${encodeURIComponent(song.id)}?${q.toString()}`);
  });

  update();
  return stopPreview;
};

export default screen;
