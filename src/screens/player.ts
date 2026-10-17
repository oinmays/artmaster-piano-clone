/**
 * Player screen: `#/play/:id?level&hands&tempo&wait&loopFrom&loopTo`.
 * Top bar, falling-notes lane, shared keyboard. Full screen, no tab bar.
 */
import type { NoteEvent, Screen } from '../core/types';
import { createKeyboard, type KeyMark } from '../core/keyboard';
import { onNoteOn } from '../core/input';
import { unlockAudio } from '../core/audio';
import { navigate } from '../core/router';
import { addResult, getSettings, updateSettings } from '../core/store';
import { isBlack, midiToName } from '../core/music';
import { getSong } from '../songs';
import { micErrorMessage, micSupported, startMic, type Listener } from '../listen';
import { Engine, clampTempo } from '../player/engine';
import { createLane } from '../player/lane';
import { parsePlayParams, playPath } from '../player/options';
import { ST_PENDING } from '../player/scoring';
import { expandOctaves, octaveMatch } from '../player/octave';

const CSS = `
.kp { display: flex; flex-direction: column; height: 100dvh; background: var(--bg); position: relative;
  padding: var(--safe-top) var(--safe-right) 0 var(--safe-left); overflow: hidden; }
.kp-top { display: flex; align-items: center; gap: 0.375rem; padding: 0.375rem 0.5rem; min-height: 52px;
  border-bottom: 1px solid var(--surface-3); background: var(--surface); }
.kp-ibtn { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); border: 1px solid transparent; background: transparent; cursor: pointer; padding: 0 0.5rem; }
.kp-ibtn svg { width: 22px; height: 22px; }
.kp-ibtn:active { background: var(--surface-3); }
.kp-ibtn[aria-pressed='true'] { background: var(--beige); color: var(--bg); }
.kp-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 0 0.25rem; }
.kp-name { font-weight: 600; font-size: 0.9375rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kp-name small { color: var(--text-muted); font-weight: 500; margin-left: 0.375rem; }
.kp-prog { height: 4px; border-radius: 2px; background: var(--surface-3); overflow: hidden; }
.kp-prog i { display: block; height: 100%; width: 100%; background: var(--accent); transform-origin: left;
  transform: scaleX(0); }
.kp-tempo { display: flex; align-items: center; border: 1px solid var(--surface-3); border-radius: var(--radius-sm); }
.kp-tempo span { min-width: 3.2em; text-align: center; font-size: 0.875rem; font-variant-numeric: tabular-nums; }
.kp-wait { font-size: 0.8125rem; font-weight: 600; border-color: var(--surface-3); }
.kp-lane { flex: 1; min-height: 0; position: relative; touch-action: none; }
.kp-kb { height: clamp(96px, 24vh, 210px); flex: none; padding-bottom: var(--safe-bottom); background: #0b0b0a; }
.kp-toast { position: absolute; left: 50%; top: 0.75rem; transform: translateX(-50%); max-width: calc(100% - 2rem);
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill);
  padding: 0.5rem 0.875rem; font-size: 0.8125rem; color: var(--beige); pointer-events: none;
  opacity: 0; transition: opacity 250ms; text-align: center; }
.kp-toast.is-on { opacity: 1; }
.kp-wait-tag { position: absolute; left: 50%; bottom: 0.75rem; transform: translateX(-50%); font-size: 0.75rem;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--warn); opacity: 0; transition: opacity 150ms;
  pointer-events: none; }
.kp-wait-tag.is-on { opacity: 1; }
.kp-overlay { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: rgba(11, 11, 10, 0.78); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  padding: calc(var(--safe-top) + 1rem) calc(var(--safe-right) + 1rem) calc(var(--safe-bottom) + 1rem) calc(var(--safe-left) + 1rem); }
.kp-overlay[hidden] { display: none; }
.kp-card { width: min(420px, 100%); max-height: 100%; overflow: auto; text-align: center; display: flex; flex-direction: column;
  gap: 0.875rem; align-items: stretch; }
.kp-card h2 { margin: 0; font-size: 1.625rem; }
.kp-card .chip { align-self: center; }
.kp-seg { display: flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.kp-seg button { flex: 1; min-height: 44px; border: 0; background: var(--surface-2); cursor: pointer; font-weight: 500; }
.kp-seg button[aria-pressed='true'] { background: var(--beige); color: var(--bg); }
.kp-seg button:disabled { opacity: 0.4; }
.kp-go { min-height: 56px; font-size: 1.125rem; }
.kp-mic { display: flex; align-items: center; gap: 0.375rem; padding: 0 0.5rem; min-height: 36px; border-radius: var(--radius-pill);
  background: var(--surface-2); border: 1px solid var(--surface-3); font-size: 0.8125rem; font-weight: 600; flex: none; }
.kp-mic[hidden] { display: none; }
.kp-mic-bar { width: 34px; height: 6px; border-radius: 3px; background: var(--surface-3); overflow: hidden; }
.kp-mic-bar i { display: block; height: 100%; width: 0; background: var(--text-muted); }
.kp-mic.is-loud .kp-mic-bar i { background: var(--good); }
.kp-mic span { min-width: 2.2em; font-variant-numeric: tabular-nums; }
.kp-mic span[data-ok='1'] { color: var(--good); }
.kp-mic span[data-ok='0'] { color: var(--bad); }
.kp-link { font-size: 0.8125rem; color: var(--accent); }
.kp-msg { font-size: 0.875rem; color: var(--warn); margin: 0; }
.kp-rotate { font-size: 0.8125rem; color: var(--text-muted); margin: 0; display: flex; gap: 0.375rem;
  align-items: center; justify-content: center; }
.kp-rotate svg { width: 18px; height: 18px; }
.kp-small { font-size: 0.8125rem; color: var(--text-muted); margin: 0; }
@media (max-width: 520px) {
  .kp-tempo span { min-width: 2.6em; font-size: 0.8125rem; }
  .kp-ibtn { padding: 0 0.25rem; }
  .kp-name small { display: none; }
}
`;

const ic = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  close: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
  pause: ic('<path d="M9 5v14M15 5v14"/>'),
  play: ic('<path d="M7 5l12 7-12 7z"/>'),
  minus: ic('<path d="M5 12h14"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  rotate: ic('<rect x="3" y="7" width="18" height="11" rx="2"/><path d="M8 3h5a4 4 0 0 1 4 4"/><path d="M15 5l2 2-2 2"/>'),
};

let styled = false;
function injectStyles(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.dataset.screen = 'player';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;
const HANDS_LABEL = { both: 'Both hands', L: 'Left hand', R: 'Right hand' } as const;
const MIN_WHITE_PX = 26;

const countWhites = (from: number, to: number) => {
  let c = 0;
  for (let m = from; m <= to; m++) if (!isBlack(m)) c++;
  return c;
};

/** Keyboard range: the song's notes, padded to >= 2 octaves, never more than fits. */
function keyboardRange(notes: NoteEvent[], width: number): { from: number; to: number } {
  let lo = 60;
  let hi = 71;
  if (notes.length) {
    lo = Math.min(...notes.map((n) => n.midi));
    hi = Math.max(...notes.map((n) => n.midi));
  }
  const fit = Math.max(8, Math.floor(width / MIN_WHITE_PX));
  // Pad symmetrically (alternating) until two octaves, stopping if it no longer fits.
  let low = true;
  while (hi - lo < 24) {
    const nlo = low ? lo - 1 : lo;
    const nhi = low ? hi : hi + 1;
    if (countWhites(nlo, nhi) > fit && countWhites(lo, hi) >= 15) break;
    lo = Math.max(21, nlo);
    hi = Math.min(108, nhi);
    low = !low;
    if (lo === 21 && hi === 108) break;
  }
  // One spare white key each side when there is room, so edge notes aren't flush.
  if (countWhites(lo - 2, hi + 2) <= fit) {
    lo -= 1;
    hi += 1;
  }
  return { from: Math.max(21, lo), to: Math.min(108, hi) };
}

function micErrorText(err: unknown): string {
  let base = '';
  try {
    base = micErrorMessage(err);
  } catch {
    /* fall through */
  }
  return `${base || 'The microphone could not start.'} Using touch keys for now.`;
}

const screen: Screen = (root, params) => {
  injectStyles();
  const opts = parsePlayParams(params);
  const song = getSong(opts.songId);

  if (!song || !(song.levels[opts.level] ?? []).length) {
    root.innerHTML = `<section class="screen"><p class="eyebrow">Player</p><h1>Song not found</h1>
      <p class="muted">That song or level isn't in the library.</p>
      <a class="btn btn--primary" href="#/library">Browse songs</a></section>`;
    return;
  }

  let settings = getSettings();
  const levelNotes = song.levels[opts.level];

  root.innerHTML = `
  <section class="screen--full kp">
    <header class="kp-top">
      <button class="kp-ibtn" data-act="close" aria-label="Close">${ICON.close}</button>
      <div class="kp-title">
        <div class="kp-name"></div>
        <div class="kp-prog" role="progressbar" aria-label="Progress"><i></i></div>
      </div>
      <div class="kp-mic" hidden title="Microphone: level and last note heard"><div class="kp-mic-bar"><i></i></div><span>–</span></div>
      <div class="kp-tempo">
        <button class="kp-ibtn" data-act="slower" aria-label="Slower">${ICON.minus}</button>
        <span aria-live="polite"></span>
        <button class="kp-ibtn" data-act="faster" aria-label="Faster">${ICON.plus}</button>
      </div>
      <button class="kp-ibtn kp-wait" data-act="wait" aria-label="Wait mode">Wait</button>
      <button class="kp-ibtn" data-act="pause" aria-label="Pause">${ICON.pause}</button>
    </header>
    <div class="kp-lane">
      <div class="kp-toast" role="status"></div>
      <div class="kp-wait-tag">Waiting for you</div>
    </div>
    <div class="kp-kb"></div>
    <div class="kp-overlay"><div class="kp-card"></div></div>
  </section>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const nameEl = $('.kp-name');
  const progEl = $('.kp-prog i');
  const tempoEl = $('.kp-tempo span');
  const waitBtn = $<HTMLButtonElement>('[data-act="wait"]');
  const pauseBtn = $<HTMLButtonElement>('[data-act="pause"]');
  const laneEl = $('.kp-lane');
  const kbEl = $('.kp-kb');
  const overlay = $('.kp-overlay');
  const card = $('.kp-card');
  const toastEl = $('.kp-toast');
  const waitTag = $('.kp-wait-tag');

  const loopLabel = opts.loopFrom != null ? ` · Bars ${opts.loopFrom}–${opts.loopTo}` : '';
  nameEl.textContent = song.title;
  const sub = document.createElement('small');
  sub.textContent = `${LEVEL_LABEL[opts.level]} · ${HANDS_LABEL[opts.hands]}${loopLabel}`;
  nameEl.appendChild(sub);

  // ---- Keyboard ---------------------------------------------------------------
  const range = keyboardRange(levelNotes, window.innerWidth);
  const whites = countWhites(range.from, range.to);
  const keyboard = createKeyboard(kbEl, {
    from: range.from,
    to: range.to,
    showNames: settings.showNoteNames,
    namesOnlyC: whites > 21,
  });
  const cramped = () => window.innerWidth / whites < MIN_WHITE_PX;
  const portrait = () => window.innerHeight > window.innerWidth;

  // ---- Engine -----------------------------------------------------------------
  let playAlong = false;
  let finished = false;
  const engine = new Engine(
    song,
    opts,
    {
      onJudge(j, midi) {
        if (j.kind === 'wrong') {
          flashMark(midi, 'bad');
          lane.flashKey(midi, 'bad');
          return;
        }
        flashMark(midi, 'good');
        lane.flashKey(midi, 'good');
        if (j.kind === 'perfect') lane.float(midi, 'Perfect', 'good');
        else if (j.kind === 'hit') lane.float(midi, 'Good', 'good');
        else lane.float(midi, j.kind === 'early' ? 'Early' : 'Late', 'warn');
      },
      onFinish() {
        if (finished) return;
        finished = true;
        const r = engine.result();
        if (r.notesTotal > 0) {
          addResult(r);
          navigate('/results');
        } else {
          navigate(`/song/${encodeURIComponent(song.id)}`);
        }
      },
    },
    playAlong,
  );

  // ---- Key marks (hints + short flashes), diffed so the DOM is touched rarely ---
  const hintOf: (KeyMark | null)[] = new Array(128).fill(null);
  const flashOf: (KeyMark | null)[] = new Array(128).fill(null);
  const flashUntil = new Float64Array(128);
  const shown: (KeyMark | null)[] = new Array(128).fill(null);
  const group = { first: -1, end: -1 };
  let hintFirst = -2;
  let hintVisible = false;

  function flashMark(midi: number, m: KeyMark): void {
    if (midi < 0 || midi > 127) return;
    flashOf[midi] = m;
    flashUntil[midi] = performance.now() + 200;
  }

  function updateMarks(now: number): void {
    const has = engine.nextGroup(group);
    const s = engine.scorer;
    const visible =
      has && (engine.waiting || (s.notes[group.first].beat - engine.currentBeat) * engine.secPerBeat < 1.2);
    const first = has ? group.first : -1;
    if (first !== hintFirst || visible !== hintVisible) {
      hintFirst = first;
      hintVisible = visible;
      for (let m = keyboard.from; m <= keyboard.to; m++) hintOf[m] = null;
      if (visible) {
        for (let i = group.first; i < group.end; i++) {
          if (s.status[i] !== ST_PENDING) continue;
          const n = s.notes[i];
          hintOf[n.midi] = n.hand === 'L' ? 'hint-L' : 'hint-R';
        }
      }
    }
    for (let m = keyboard.from; m <= keyboard.to; m++) {
      const want = flashUntil[m] > now ? flashOf[m] : hintOf[m];
      if (want !== shown[m]) {
        keyboard.mark(m, want);
        shown[m] = want;
      }
    }
  }

  // Hints within a chord change as notes are played: refresh when the group shrinks.
  let lastPendingCount = -1;
  function pendingInGroup(): number {
    if (hintFirst < 0) return 0;
    let c = 0;
    const s = engine.scorer;
    for (let i = group.first; i < group.end; i++) if (s.status[i] === ST_PENDING) c++;
    return c;
  }

  // ---- Lane -------------------------------------------------------------------
  let lastProg = -1;
  let lastWaiting = false;
  const lane = createLane({
    container: laneEl,
    engine,
    keyboard,
    showNames: settings.showNoteNames,
    onFrame(now) {
      engine.tick(now);
      if (finished) return;
      const pc = pendingInGroup();
      if (pc !== lastPendingCount) {
        lastPendingCount = pc;
        hintFirst = -2; // force recompute
      }
      updateMarks(now);
      const p = Math.round(engine.progress() * 500) / 500;
      if (p !== lastProg) {
        lastProg = p;
        progEl.style.transform = `scaleX(${p})`;
      }
      if (engine.waiting !== lastWaiting) {
        lastWaiting = engine.waiting;
        waitTag.classList.toggle('is-on', lastWaiting);
      }
    },
  });
  laneEl.prepend(laneEl.querySelector('canvas')!);
  lane.start();

  // ---- Top bar ----------------------------------------------------------------
  const renderTop = () => {
    tempoEl.textContent = `${engine.tempo}%`;
    waitBtn.setAttribute('aria-pressed', String(engine.wait));
    pauseBtn.innerHTML = engine.state === 'running' ? ICON.pause : ICON.play;
    pauseBtn.setAttribute('aria-label', engine.state === 'running' ? 'Pause' : 'Resume');
  };
  renderTop();

  let toastTimer = 0;
  const toast = (text: string, ms = 2600) => {
    toastEl.textContent = text;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('is-on'), ms);
  };

  const exit = () => navigate(`/song/${encodeURIComponent(song.id)}`);

  root.querySelector('.kp-top')!.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') exit();
    else if (act === 'slower' || act === 'faster') {
      engine.setTempo(clampTempo(engine.tempo + (act === 'faster' ? 5 : -5)));
      renderTop();
    } else if (act === 'wait') {
      engine.setWait(!engine.wait);
      toast(engine.wait ? 'Wait Mode on: the music waits for you' : 'Wait Mode off: play in time');
      renderTop();
    } else if (act === 'pause') {
      if (engine.state === 'running') pause();
      else if (engine.state === 'paused') resume();
    }
  });

  // ---- Overlays ---------------------------------------------------------------
  const seg = (name: string, items: [string, string, boolean, boolean?][]) =>
    `<div class="kp-seg" role="group" aria-label="${name}">${items
      .map(([v, label, on, disabled]) => `<button data-v="${v}" aria-pressed="${on}" ${disabled ? 'disabled' : ''}>${label}</button>`)
      .join('')}</div>`;

  const rotateHint = () =>
    portrait() && cramped()
      ? `<p class="kp-rotate">${ICON.rotate}Rotate for a bigger keyboard</p>`
      : '';

  function showStart(message = ''): void {
    settings = getSettings();
    const micOk = micSupported();
    const useMic = settings.input === 'mic' && micOk;
    card.innerHTML = `
      <p class="eyebrow">${LEVEL_LABEL[opts.level]} · ${HANDS_LABEL[opts.hands]} · ${engine.tempo}%${loopLabel}</p>
      <h2></h2>
      <div><p class="kp-small" style="margin-bottom:0.375rem">Listen with</p>
      ${seg('Input', [
        ['touch', 'Touch keys', !useMic],
        ['mic', 'Microphone', useMic, !micOk],
      ])}
      <a class="kp-link" href="#/tools/mic">Test the microphone first</a></div>
      ${seg('Guide notes', [
        ['off', 'Just me', !playAlong],
        ['on', 'Play along', playAlong],
      ])}
      ${message ? `<p class="kp-msg"></p>` : ''}
      <button class="btn btn--primary kp-go" data-act="go">Tap to start</button>
      ${rotateHint()}
      <p class="kp-small">${
        opts.hands === 'both' ? 'Play both hands.' : `The ${opts.hands === 'L' ? 'right' : 'left'} hand plays along for you.`
      } ${engine.wait ? 'Wait Mode is on.' : ''}</p>`;
    card.querySelector('h2')!.textContent = song!.title;
    if (message) card.querySelector('.kp-msg')!.textContent = message;
    overlay.hidden = false;
  }

  function showPause(): void {
    card.innerHTML = `
      <p class="eyebrow">Paused</p>
      <h2></h2>
      ${seg('Guide notes', [
        ['off', 'Just me', !playAlong],
        ['on', 'Play along', playAlong],
      ])}
      <button class="btn btn--primary kp-go" data-act="resume">Resume</button>
      <div class="row" style="justify-content:center">
        <button class="btn" data-act="restart">Restart</button>
        <button class="btn" data-act="end">End and see results</button>
      </div>
      ${rotateHint()}`;
    card.querySelector('h2')!.textContent = song!.title;
    overlay.hidden = false;
  }

  let mic: Listener | null = null;
  let disposed = false;
  let starting = false;

  async function begin(): Promise<void> {
    if (starting) return;
    starting = true;
    await unlockAudio();
    let warn = '';
    if (getSettings().input === 'mic' && micSupported()) {
      try {
        const l = await startMic({
          a4: settings.a4,
          expected: micExpected,
          onFrame: (f) => {
            micLevel = f.rms;
            micGate = f.gate;
          },
        });
        if (disposed) {
          l.stop();
          return;
        }
        mic = l;
      } catch (err) {
        warn = micErrorText(err);
      }
    }
    if (disposed) return;
    if (mic) {
      micEl.hidden = false;
      drawMic();
    }
    overlay.hidden = true;
    engine.start(performance.now());
    renderTop();
    if (warn) toast(warn, 5000);
    else if (portrait() && cramped()) toast('Rotate for a bigger keyboard');
  }

  function pause(): void {
    engine.pause();
    renderTop();
    showPause();
  }

  function resume(): void {
    overlay.hidden = true;
    void unlockAudio();
    engine.resume();
    renderTop();
  }

  overlay.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const segBtn = t.closest<HTMLButtonElement>('.kp-seg button');
    if (segBtn) {
      const segName = segBtn.parentElement!.getAttribute('aria-label');
      const v = segBtn.dataset.v;
      if (segName === 'Input' && (v === 'mic' || v === 'touch')) {
        settings = updateSettings({ input: v });
      } else if (segName === 'Guide notes') {
        playAlong = v === 'on';
        engine.playAlong = playAlong;
      }
      segBtn.parentElement!.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === segBtn)));
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'go') void begin();
    else if (act === 'resume') resume();
    else if (act === 'restart')
      navigate(playPath({ ...opts, tempo: engine.tempo, wait: engine.wait }), true);
    else if (act === 'end') engine.finish();
  });

  // ---- Mic feedback -----------------------------------------------------------
  const micEl = $('.kp-mic');
  const micFill = $('.kp-mic-bar i');
  const micNote = $('.kp-mic span');
  let micLevel = 0;
  let micGate = 1;
  let micRaf = 0;
  const drawMic = () => {
    micRaf = requestAnimationFrame(drawMic);
    const db = 20 * Math.log10(Math.max(micLevel, 1e-6));
    micFill.style.width = `${Math.max(0, Math.min(100, ((db + 80) / 70) * 100))}%`;
    micEl.classList.toggle('is-loud', micLevel >= micGate);
  };

  const expandedBuf: number[] = [];
  const micExpected = (): number[] =>
    settings.anyOctave ? expandOctaves(engine.expectedNow(), expandedBuf) : engine.expectedNow();

  // ---- Input ------------------------------------------------------------------
  // Mic notes arrive already latency-compensated by the listen module.
  const offNote = onNoteOn((n) => {
    let midi = n.midi;
    if (n.source !== 'touch' && settings.anyOctave) midi = octaveMatch(midi, engine.expectedNow());
    if (n.source === 'mic') {
      micNote.textContent = midiToName(n.midi);
      micNote.dataset.ok = engine.expectedNow().includes(midi) ? '1' : '0';
    }
    engine.input(midi, n.time);
  });

  // ---- Lifecycle --------------------------------------------------------------
  const onVisibility = () => {
    if (document.hidden && engine.state === 'running') pause();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onPageHide = () => {
    if (engine.state === 'running') pause();
  };
  window.addEventListener('pagehide', onPageHide);

  // Block pinch-zoom / page scroll anywhere on the player (iOS ignores user-scalable).
  const sectionEl = root.querySelector<HTMLElement>('.kp')!;
  const noGesture = (e: Event) => e.preventDefault();
  sectionEl.addEventListener('gesturestart', noGesture);
  const noScroll = (e: TouchEvent) => {
    if (!(e.target as HTMLElement).closest('.kp-card')) e.preventDefault();
  };
  sectionEl.addEventListener('touchmove', noScroll, { passive: false });

  showStart();

  return () => {
    disposed = true;
    clearTimeout(toastTimer);
    offNote();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    sectionEl.removeEventListener('gesturestart', noGesture);
    sectionEl.removeEventListener('touchmove', noScroll);
    cancelAnimationFrame(micRaf);
    mic?.stop();
    mic = null;
    lane.destroy();
    engine.destroy();
    keyboard.destroy();
  };
};

export default screen;
