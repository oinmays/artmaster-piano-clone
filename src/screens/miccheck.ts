/**
 * Mic check (`#/tools/mic`): live proof that the microphone hears the piano.
 * Runs the same listening pipeline as the player and shows its level, the live pitch,
 * which key (and octave) that is, and every note it would score.
 * Also checks a USB/MIDI keyboard: whether this device can read one, which are connected,
 * and the notes arriving from it. MIDI listens from the moment the screen opens.
 */
import type { Screen } from '../core/types';
import { createKeyboard } from '../core/keyboard';
import { onNoteOff, onNoteOn } from '../core/input';
import { unlockAudio } from '../core/audio';
import { DEFAULT_MIC_SENSITIVITY, getSettings, updateSettings } from '../core/store';
import { midiToName } from '../core/music';
import {
  micErrorMessage,
  micSupported,
  midiHelp,
  midiPossible,
  startMic,
  startMidi,
  type Listener,
  type MicFrameInfo,
} from '../listen';
import { freqToNote } from '../listen/pitch';
import { SENSITIVITY_MAX, SENSITIVITY_MIN } from '../listen/sensitivity';

const CSS = `
.mc-meter { position: relative; height: 22px; border-radius: 11px; background: var(--surface-3); overflow: hidden; }
.mc-meter i { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--text-muted); transition: width 60ms linear; }
.mc-meter.is-loud i { background: var(--good); }
.mc-meter b { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--warn); }
.mc-legend { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-top: 0.375rem; }
.mc-sens { display: grid; grid-template-columns: 1fr auto auto; align-items: center; column-gap: 0.75rem; margin-top: 0.875rem; }
.mc-sens label { font-weight: 600; }
.mc-sens input { grid-column: 1 / -1; width: 100%; min-width: 0; min-height: 44px; margin: 0; accent-color: var(--accent); }
.mc-sens output { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.mc-sens .btn { min-height: 44px; }
.mc-sens-hint { font-size: 0.8125rem; color: var(--text-muted); margin: 0.25rem 0 0; }
.mc-status { font-weight: 600; margin: 0.75rem 0 0; }
.mc-status[data-s='ok'] { color: var(--good); }
.mc-status[data-s='quiet'] { color: var(--warn); }
.mc-status[data-s='err'] { color: var(--bad); }
.mc-note { display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; }
.mc-note strong { font-family: var(--font-serif); font-weight: 500; font-size: clamp(3.5rem, 14vw, 5.5rem); line-height: 1; }
.mc-note span { color: var(--text-muted); }
.mc-kb { height: 120px; margin-top: 1rem; border-radius: var(--radius-sm); overflow: hidden; }
.mc-heard { display: flex; gap: 0.375rem; flex-wrap: wrap; min-height: 28px; margin-top: 0.5rem; }
.mc-heard .chip.is-new { background: var(--good); color: #0b0b0a; }
.mc-midi-status { font-weight: 600; margin: 0.25rem 0 0; }
.mc-midi-status[data-s='ok'] { color: var(--good); }
.mc-midi-status[data-s='quiet'] { color: var(--warn); }
.mc-midi-status[data-s='err'] { color: var(--bad); }
.mc-midi p { margin: 0.375rem 0 0; }
.mc-cards { display: grid; gap: 0.875rem; margin-top: 1rem; }
.mc-tips { margin: 0; padding-left: 1.1rem; line-height: 1.55; }
.mc-tips li { margin-bottom: 0.375rem; }
@media (min-width: 900px) { .mc-cards { grid-template-columns: 1fr 1fr; } .mc-wide { grid-column: 1 / -1; } }
`;

// Meter scale: -80 dB (silence) .. -10 dB (very loud), in RMS.
const DB_MIN = -80;
const DB_MAX = -10;
const pct = (rmsValue: number) => {
  const db = 20 * Math.log10(Math.max(rmsValue, 1e-6));
  return Math.max(0, Math.min(100, ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100));
};

const screen: Screen = (root) => {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  root.innerHTML = `
  <section class="screen">
    <a class="btn btn--ghost btn--sm" href="#/tools" style="padding-left:0">‹ Tools</a>
    <p class="eyebrow" style="margin-top:0.5rem">Tools</p>
    <h1>Mic check</h1>
    <p class="muted">Play single notes slowly on your piano. The bar should jump, and the note you played should
      light up below. This uses exactly the same listening as the songs.</p>
    <div class="row"><button class="btn btn--primary" data-act="start">Start listening</button>
      <a class="btn" href="#/settings">Settings</a></div>
    <p class="mc-status" role="status" data-s="idle">Not listening yet.</p>

    <div class="mc-cards">
      <div class="card">
        <p class="eyebrow">Sound level</p>
        <div class="mc-meter" aria-hidden="true"><i></i><b style="left:0"></b></div>
        <div class="mc-legend"><span>Silence</span><span>Yellow line = loud enough to count</span><span>Loud</span></div>
        <div class="mc-sens">
          <label for="mc-sens">Sensitivity</label>
          <output class="mc-sens-val" for="mc-sens"></output>
          <button type="button" class="btn btn--ghost btn--sm" data-act="sens-reset">Reset</button>
          <input id="mc-sens" type="range" min="${SENSITIVITY_MIN}" max="${SENSITIVITY_MAX}" step="1"
            aria-describedby="mc-sens-hint">
        </div>
        <p class="mc-sens-hint" id="mc-sens-hint">Play your softest normal note. Slide until it crosses the yellow line, but silence doesn't.</p>
      </div>

      <div class="card">
        <p class="eyebrow">Hearing</p>
        <div class="mc-note"><strong>–</strong><span class="mc-detail">Play a note</span></div>
      </div>

      <div class="card mc-wide">
        <p class="eyebrow">Which key that is</p>
        <p class="muted" style="margin:0">Middle C is <b>C4</b>. Notes in songs are written for the octave shown in the song,
          but "Accept any octave" in Settings (on by default) counts the right note in any octave.</p>
        <div class="mc-kb"></div>
        <p class="eyebrow" style="margin-top:1rem">Notes a song would count <span class="mc-count"></span></p>
        <div class="mc-heard"></div>
      </div>

      <div class="card mc-wide mc-midi">
        <p class="eyebrow">USB keyboard (MIDI)</p>
        <p class="mc-midi-status" role="status" data-s="idle"></p>
        <p class="muted mc-midi-body"></p>
        <p class="eyebrow" style="margin-top:1rem">Notes from the keyboard</p>
        <div class="mc-heard mc-midi-heard"></div>
        <p><a href="#/tools/keyboard">Connect a keyboard: which cable?</a></p>
      </div>

      <div class="card mc-wide">
        <p class="eyebrow">Best keyboard settings</p>
        <ul class="mc-tips">
          <li><b>Tone: Piano.</b> It starts each note sharply, which is what the app listens for. Organ and strings
            fade in and hold, so notes run together.</li>
          <li><b>Use the keyboard's own speakers</b>, not headphones. With headphones plugged into the keyboard, the
            iPad hears nothing.</li>
          <li><b>Volume about halfway.</b> Each note should push the bar past the yellow line.</li>
          <li><b>Rhythm, accompaniment and demo songs off.</b> Background music sounds like extra notes.</li>
          <li>Put the iPad on the music stand, close to the speakers, in a quiet room.</li>
        </ul>
      </div>
    </div>
  </section>`;

  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const startBtn = $<HTMLButtonElement>('[data-act=start]');
  const status = $('.mc-status');
  const meter = $('.mc-meter');
  const fill = $('.mc-meter i');
  const gateMark = $('.mc-meter b');
  const noteEl = $('.mc-note strong');
  const detailEl = $('.mc-detail');
  const heardEl = $('.mc-heard');
  const countEl = $('.mc-count');

  // ---- Sensitivity slider: saves live; the running mic picks it up and `gate` moves next frame.
  const sens = $<HTMLInputElement>('#mc-sens');
  const sensVal = $('.mc-sens-val');
  const sensReset = $<HTMLButtonElement>('[data-act=sens-reset]');
  const renderSens = (v: number) => {
    const isDefault = v === DEFAULT_MIC_SENSITIVITY;
    sens.value = String(v);
    sensVal.textContent = isDefault ? `${v} (default)` : String(v);
    sens.setAttribute('aria-valuetext', `${v}${isDefault ? ', default' : ''}`);
    sensReset.style.display = isDefault ? 'none' : '';
  };
  const setSens = (v: number) => {
    const n = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, Math.round(v)));
    renderSens(updateSettings({ micSensitivity: n }).micSensitivity);
  };
  sens.addEventListener('input', () => setSens(Number(sens.value)));
  sensReset.addEventListener('click', () => setSens(DEFAULT_MIC_SENSITIVITY));
  renderSens(getSettings().micSensitivity);

  const keyboard = createKeyboard($('.mc-kb'), { from: 36, to: 96, sound: false, emit: false, showNames: true, namesOnlyC: true });

  const setStatus = (s: string, text: string) => {
    status.dataset.s = s;
    status.textContent = text;
  };

  let mic: Listener | null = null;
  let last: MicFrameInfo | null = null;
  let lastLoudAt = 0;
  let marked = -1;
  let markedAt = 0;
  let heard = 0;
  let raf = 0;
  const a4 = getSettings().a4;

  const draw = () => {
    raf = requestAnimationFrame(draw);
    const f = last;
    if (!f) return;
    const now = performance.now();
    fill.style.width = `${pct(f.rms)}%`;
    gateMark.style.left = `${pct(f.gate)}%`;
    const loud = f.rms >= f.gate;
    meter.classList.toggle('is-loud', loud);
    if (loud) lastLoudAt = now;

    if (f.freq > 0 && f.clarity >= 0.8) {
      const { midi, cents } = freqToNote(f.freq, a4);
      noteEl.textContent = midiToName(midi);
      detailEl.textContent = `${f.freq.toFixed(1)} Hz · ${cents > 0 ? '+' : ''}${cents} cents`;
      if (midi !== marked) {
        if (marked >= 0) keyboard.mark(marked, null);
        keyboard.mark(midi, 'good');
        marked = midi;
      }
      markedAt = now;
    } else if (marked >= 0 && now - markedAt > 600) {
      keyboard.mark(marked, null);
      marked = -1;
    }

    if (now - lastLoudAt < 400) setStatus('ok', 'Hearing you.');
    else if (heard === 0) setStatus('quiet', 'Listening… play a note. If the bar barely moves, turn the keyboard up.');
    else setStatus('ok', 'Listening.');
  };

  // ---- MIDI ---------------------------------------------------------------------
  const midiStatus = $('.mc-midi-status');
  const midiBody = $('.mc-midi-body');
  const midiHeard = $('.mc-midi-heard');
  const setMidi = (s: string, text: string, body = '') => {
    midiStatus.dataset.s = s;
    midiStatus.textContent = text;
    midiBody.textContent = body;
  };
  const help = midiHelp();
  let midi: Listener | null = null;
  let midiNotes = 0;
  let disposed = false;
  const onDevices = (names: string[]) => {
    if (names.length) setMidi('ok', `Connected: ${names.join(', ')}`, midiNotes ? '' : 'Play a key on it.');
    else setMidi('quiet', 'No keyboard connected.', help.body);
  };
  if (midiPossible()) {
    setMidi('idle', 'Looking for keyboards…', help.body);
    void startMidi({ onDevices }).then((l) => {
      if (disposed) return l?.stop();
      midi = l;
      if (!l) setMidi('err', 'MIDI access was blocked.', 'Allow MIDI devices for this site in the browser, then reopen Mic check.');
    });
  } else {
    setMidi('err', help.title, help.body);
  }

  const offMidiUp = onNoteOff((n) => {
    if (n.source === 'midi') keyboard.mark(n.midi, null);
  });

  const offNote = onNoteOn((n) => {
    if (n.source === 'midi') {
      if (!midiNotes++) midiBody.textContent = '';
      keyboard.mark(n.midi, 'good');
      midiHeard.querySelector('.is-new')?.classList.remove('is-new');
      const chip = document.createElement('span');
      chip.className = 'chip is-new';
      chip.textContent = midiToName(n.midi);
      midiHeard.prepend(chip);
      while (midiHeard.children.length > 8) midiHeard.lastElementChild!.remove();
      return;
    }
    if (n.source !== 'mic') return;
    heard++;
    countEl.textContent = `(${heard})`;
    heardEl.querySelector('.is-new')?.classList.remove('is-new');
    const chip = document.createElement('span');
    chip.className = 'chip is-new';
    chip.textContent = midiToName(n.midi);
    heardEl.prepend(chip);
    while (heardEl.children.length > 12) heardEl.lastElementChild!.remove();
  });

  startBtn.addEventListener('click', async () => {
    if (mic) {
      mic.stop();
      mic = null;
      cancelAnimationFrame(raf);
      startBtn.textContent = 'Start listening';
      setStatus('idle', 'Stopped.');
      return;
    }
    if (!micSupported()) {
      setStatus('err', 'This browser has no microphone access. Open the app in Safari.');
      return;
    }
    startBtn.disabled = true;
    setStatus('idle', 'Asking for the microphone…');
    try {
      await unlockAudio();
      mic = await startMic({ livePitch: true, onFrame: (f) => (last = f) });
      startBtn.textContent = 'Stop';
      draw();
    } catch (err) {
      setStatus('err', micErrorMessage(err) || 'The microphone could not start.');
    } finally {
      startBtn.disabled = false;
    }
  });

  return () => {
    cancelAnimationFrame(raf);
    disposed = true;
    mic?.stop();
    midi?.stop();
    offNote();
    offMidiUp();
    keyboard.destroy();
    style.remove();
  };
};

export default screen;
