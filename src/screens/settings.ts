/** Settings: #/settings — input, display, sound, tuning and microphone calibration. */
import type { Screen } from '../core/types';
import { getAudioContext, playClick, setVolume, unlockAudio } from '../core/audio';
import { midiToName } from '../core/music';
import { DEFAULT_MIC_SENSITIVITY, getSettings, updateSettings, type Settings } from '../core/store';
import {
  listMidiInputs,
  micErrorMessage,
  micSupported,
  midiHelp,
  midiPossible,
  startPitchStream,
  type Listener,
  type PitchFrame,
} from '../listen';
import { freqToNote } from '../listen/pitch';
import { SENSITIVITY_MAX, SENSITIVITY_MIN } from '../listen/sensitivity';
import { versionFooter } from './changelog';

const css = `
.stg { display: flex; flex-direction: column; gap: 1rem; max-width: 720px; }
.stg-back { align-self: flex-start; min-height: 44px; display: inline-flex; align-items: center;
  color: var(--text-muted); text-decoration: none; font-size: 0.9375rem; }
.stg-head h1 { margin: 0; }
.stg-card { display: flex; flex-direction: column; gap: 0.875rem; }
.stg-card h2 { margin: 0; font-size: 1.125rem; }
.stg-row { display: flex; align-items: center; gap: 0.75rem; min-height: 44px; flex-wrap: wrap; }
.stg-row > label, .stg-label { flex: 1; min-width: 9rem; }
.stg-sub { display: block; font-size: 0.8125rem; color: var(--text-muted); margin-top: 2px; }
.stg-seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.stg-seg { max-width: 100%; }
.stg-seg .btn { border: 0; border-radius: 0; min-width: 0; flex: 1 1 auto; padding-left: 0.75rem; padding-right: 0.75rem; }
.stg-seg .btn + .btn { border-left: 1px solid var(--border); }
.stg-switch { position: relative; width: 52px; height: 32px; border-radius: var(--radius-pill); border: 0;
  background: var(--surface-3); cursor: pointer; flex: none; padding: 0; margin: 6px 0; }
.stg-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px;
  border-radius: 50%; background: var(--text); transition: transform 160ms; }
.stg-switch[aria-checked='true'] { background: var(--good); }
.stg-switch[aria-checked='true']::after { transform: translateX(20px); }
.stg-range { flex: 1 1 12rem; min-height: 44px; accent-color: var(--accent); }
.stg-sens-reset { min-height: 44px; }
.stg-val { min-width: 4.5rem; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.stg-step { width: 44px; height: 44px; padding: 0; font-size: 1.25rem; }
.stg-meter { height: 12px; border-radius: var(--radius-pill); background: var(--surface-3); overflow: hidden; }
.stg-meter-fill { height: 100%; width: 0; background: var(--good); transition: width 60ms linear; }
.stg-meter-fill.is-low { background: var(--text-muted); }
.stg-live { display: flex; align-items: baseline; gap: 0.75rem; min-height: 3rem; }
.stg-live-note { font-family: var(--font-serif); font-size: 2.25rem; line-height: 1; min-width: 4.5rem; }
.stg-msg { margin: 0; font-size: 0.9375rem; }
.stg-msg.is-error { color: var(--bad); }
.stg-msg.is-ok { color: var(--good); }
.stg-dots { display: flex; gap: 6px; }
.stg-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--surface-3); transition: background 120ms; }
.stg-dot.is-click { background: var(--text-muted); }
.stg-dot.is-hit { background: var(--good); }
.stg-dot.is-miss { background: var(--bad); }
.stg-tips { margin: 0; padding-left: 1.125rem; color: var(--text-muted); line-height: 1.5; font-size: 0.9375rem; }
`;

let styled = false;
function injectStyles(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

const CLICKS = 8;
const CLICK_GAP = 0.6; // seconds

const screen: Screen = (root) => {
  injectStyles();
  let s: Settings = getSettings();
  const set = (patch: Partial<Settings>) => (s = updateSettings(patch));

  root.innerHTML = `
  <section class="screen stg">
    <a class="stg-back" href="#/progress">‹ Progress</a>
    <div class="stg-head"><p class="eyebrow">Keys</p><h1>Settings</h1></div>

    <div class="card stg-card">
      <h2>How you play</h2>
      <div class="stg-row">
        <span class="stg-label">Input<span class="stg-sub">Microphone listens to your real piano. A USB keyboard sends exact notes.</span></span>
        <div class="stg-seg" role="group" aria-label="Input mode">
          <button class="btn" data-input="mic">Microphone</button>
          <button class="btn" data-input="touch">Touch only</button>
          <button class="btn" data-input="midi">USB keyboard (MIDI)</button>
        </div>
      </div>
      <p class="stg-msg stg-input-msg muted"></p>
      ${
        midiPossible()
          ? `<div class="stg-row">
        <span class="stg-label">MIDI keyboard<span class="stg-sub stg-midi-status">Used automatically when connected.</span></span>
        <button class="btn btn--sm" data-act="midi">Check</button>
      </div>`
          : `<div class="stg-row">
        <span class="stg-label">${midiHelp().title}<span class="stg-sub">${midiHelp().body}</span></span>
      </div>`
      }
      <div class="stg-row">
        <span class="stg-label">Which cable?<span class="stg-sub">What to plug into what, for iPad, iPhone, Mac, PC and Android.</span></span>
        <a class="btn btn--sm" href="#/tools/keyboard">Connect a keyboard</a>
      </div>
    </div>

    <div class="card stg-card">
      <h2>Listening</h2>
      <div class="stg-row">
        <span class="stg-label" id="stg-oct-l">Accept any octave<span class="stg-sub">Microphone: count the right note even if it's played higher or lower than shown. A MIDI keyboard always needs the exact key.</span></span>
        <button class="stg-switch" role="switch" aria-labelledby="stg-oct-l" data-act="octave"></button>
      </div>
      <div class="stg-row">
        <label for="stg-sens">Mic sensitivity<span class="stg-sub" id="stg-sens-sub">Higher counts quieter notes. Lower ignores more background noise.</span></label>
        <input id="stg-sens" class="stg-range" type="range" min="${SENSITIVITY_MIN}" max="${SENSITIVITY_MAX}" step="1" aria-describedby="stg-sens-sub">
        <span class="stg-val stg-sens-val"></span>
      </div>
      <div class="stg-row">
        <span class="stg-label"><span class="stg-sub">Play your softest normal note in Mic check: it should cross the yellow line, silence shouldn't.</span></span>
        <button class="btn btn--sm stg-sens-reset" data-act="sens-reset">Reset to default</button>
      </div>
      <div class="stg-row">
        <span class="stg-label">Mic check<span class="stg-sub">See the level and the note the microphone hears.</span></span>
        <a class="btn btn--sm" href="#/tools/mic">Open</a>
      </div>
    </div>

    <div class="card stg-card">
      <h2>Display and sound</h2>
      <div class="stg-row">
        <span class="stg-label" id="stg-names-l">Show note names</span>
        <button class="stg-switch" role="switch" aria-labelledby="stg-names-l" data-act="names"></button>
      </div>
      <div class="stg-row">
        <span class="stg-label" id="stg-fingers-l">Show finger numbers<span class="stg-sub">1 thumb, 2 index, 3 middle, 4 ring, 5 little. Suggested automatically.</span></span>
        <button class="stg-switch" role="switch" aria-labelledby="stg-fingers-l" data-act="fingers"></button>
      </div>
      <div class="stg-row">
        <label for="stg-vol">Volume</label>
        <input id="stg-vol" class="stg-range" type="range" min="0" max="100" step="1">
        <span class="stg-val stg-vol-val"></span>
      </div>
      <div class="stg-row">
        <span class="stg-label">Tuning (A4)<span class="stg-sub">Match an acoustic piano that isn't at 440 Hz.</span></span>
        <button class="btn stg-step" data-act="a4-down" aria-label="Lower A4 by 1 Hz">−</button>
        <span class="stg-val stg-a4-val" style="text-align:center"></span>
        <button class="btn stg-step" data-act="a4-up" aria-label="Raise A4 by 1 Hz">+</button>
      </div>
    </div>

    <div class="card stg-card">
      <h2>Microphone</h2>
      <div class="stg-row">
        <span class="stg-label">Test microphone<span class="stg-sub">Play a key: the level should jump and the note appear.</span></span>
        <button class="btn btn--sm" data-act="test">Start test</button>
      </div>
      <div class="stg-meter" aria-hidden="true"><div class="stg-meter-fill is-low"></div></div>
      <div class="stg-live" aria-live="polite"><span class="stg-live-note">–</span><span class="muted stg-live-info"></span></div>

      <div class="stg-row">
        <span class="stg-label">Latency<span class="stg-sub">Delay between playing a key and the app hearing it.</span></span>
        <button class="btn btn--sm" data-act="calibrate">Calibrate</button>
      </div>
      <div class="stg-dots" aria-hidden="true">${'<span class="stg-dot"></span>'.repeat(CLICKS)}</div>
      <p class="stg-msg stg-cal-msg muted">Calibrate plays ${CLICKS} clicks through the speaker and times how long the microphone takes to hear them.</p>
      <div class="stg-row">
        <label for="stg-lat">Adjust by hand</label>
        <input id="stg-lat" class="stg-range" type="range" min="0" max="300" step="5">
        <span class="stg-val stg-lat-val"></span>
      </div>
      <p class="stg-msg stg-mic-msg" role="status"></p>
    </div>

    <div class="card stg-card">
      <h2>Tips for listening</h2>
      <ul class="stg-tips">
        <li>Practise in a quiet room. Fans, TV and talking confuse the microphone.</li>
        <li>Stand the iPhone or iPad on the music stand, facing the strings or speaker.</li>
        <li>Turn off silent mode (or use the speaker, not headphones) so you hear the app and the clicks.</li>
        <li>A digital piano with a MIDI or USB cable is the most accurate, where your browser supports MIDI.</li>
      </ul>
    </div>

    ${versionFooter()}
  </section>`;

  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T & Element>(sel)! as T;

  // ---- Input mode -------------------------------------------------------------
  const inputBtns = root.querySelectorAll<HTMLButtonElement>('[data-input]');
  const inputMsg = $('.stg-input-msg');
  const renderInput = () => {
    inputBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.input === s.input)));
    inputMsg.textContent =
      s.input === 'mic'
        ? micSupported()
          ? 'Songs listen through the microphone. Tap keys on screen too, if you like.'
          : "This browser can't use the microphone, so songs will use touch."
        : s.input === 'midi'
          ? midiPossible()
            ? 'Notes come straight from the keyboard over the cable: no microphone, and the exact octave counts. Until one is plugged in, use the on-screen keys.'
            : "Notes would come straight from the keyboard, but this device can't read MIDI (see below), so songs will use touch."
          : 'Songs are played on the on-screen keyboard.';
  };
  inputBtns.forEach((b) =>
    b.addEventListener('click', () => {
      set({ input: b.dataset.input as Settings['input'] });
      renderInput();
    }),
  );
  renderInput();

  const midiBtn = root.querySelector<HTMLButtonElement>('[data-act=midi]');
  midiBtn?.addEventListener('click', async () => {
    const status = $('.stg-midi-status');
    status.textContent = 'Checking…';
    const names = await listMidiInputs();
    status.textContent =
      names == null
        ? 'MIDI access was blocked. Allow MIDI devices for this site in the browser, then check again.'
        : names.length
          ? `Connected: ${names.join(', ')}`
          : 'No MIDI keyboard found. Plug one in and check again.';
  });

  // ---- Display & sound ------------------------------------------------------------
  const namesBtn = $<HTMLButtonElement>('[data-act=names]');
  const renderNames = () => namesBtn.setAttribute('aria-checked', String(s.showNoteNames));
  namesBtn.addEventListener('click', () => {
    set({ showNoteNames: !s.showNoteNames });
    renderNames();
  });
  renderNames();

  const fingersBtn = $<HTMLButtonElement>('[data-act=fingers]');
  const renderFingers = () => fingersBtn.setAttribute('aria-checked', String(s.showFingers));
  fingersBtn.addEventListener('click', () => {
    set({ showFingers: !s.showFingers });
    renderFingers();
  });
  renderFingers();

  const octBtn = $<HTMLButtonElement>('[data-act=octave]');
  const renderOct = () => octBtn.setAttribute('aria-checked', String(s.anyOctave));
  octBtn.addEventListener('click', () => {
    set({ anyOctave: !s.anyOctave });
    renderOct();
  });
  renderOct();

  const vol = $<HTMLInputElement>('#stg-vol');
  const volVal = $('.stg-vol-val');
  vol.value = String(Math.round(s.volume * 100));
  volVal.textContent = `${vol.value}%`;
  vol.addEventListener('input', () => {
    const v = Number(vol.value) / 100;
    setVolume(v);
    volVal.textContent = `${vol.value}%`;
  });
  vol.addEventListener('change', () => {
    set({ volume: Number(vol.value) / 100 });
    void unlockAudio().then(() => playClick(true));
  });

  const a4Val = $('.stg-a4-val');
  const renderA4 = () => (a4Val.textContent = `${s.a4} Hz`);
  const stepA4 = (d: number) => {
    set({ a4: Math.max(430, Math.min(450, s.a4 + d)) });
    renderA4();
  };
  $('[data-act=a4-down]').addEventListener('click', () => stepA4(-1));
  $('[data-act=a4-up]').addEventListener('click', () => stepA4(1));
  renderA4();

  // ---- Mic sensitivity slider (a running mic picks the change up live) -----------
  const sens = $<HTMLInputElement>('#stg-sens');
  const sensVal = $('.stg-sens-val');
  const sensReset = $<HTMLButtonElement>('[data-act=sens-reset]');
  const renderSens = () => {
    const v = s.micSensitivity;
    const isDefault = v === DEFAULT_MIC_SENSITIVITY;
    sens.value = String(v);
    sensVal.textContent = isDefault ? `${v} (default)` : String(v);
    sens.setAttribute('aria-valuetext', `${v}${isDefault ? ', default' : ''}`);
    sensReset.disabled = isDefault;
  };
  sens.addEventListener('input', () => {
    set({ micSensitivity: Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, Math.round(Number(sens.value)))) });
    renderSens();
  });
  sensReset.addEventListener('click', () => {
    set({ micSensitivity: DEFAULT_MIC_SENSITIVITY });
    renderSens();
  });
  renderSens();

  // ---- Latency slider ------------------------------------------------------------
  const lat = $<HTMLInputElement>('#stg-lat');
  const latVal = $('.stg-lat-val');
  const renderLat = () => {
    lat.value = String(s.micLatencyMs);
    latVal.textContent = `${s.micLatencyMs} ms`;
  };
  lat.addEventListener('input', () => {
    set({ micLatencyMs: Math.max(0, Math.min(300, Math.round(Number(lat.value)))) });
    latVal.textContent = `${s.micLatencyMs} ms`;
  });
  renderLat();

  // ---- Microphone test meter + calibration ---------------------------------------
  const micMsg = $('.stg-mic-msg');
  const showMicMsg = (text: string, kind: '' | 'error' | 'ok' = '') => {
    micMsg.textContent = text;
    micMsg.classList.toggle('is-error', kind === 'error');
    micMsg.classList.toggle('is-ok', kind === 'ok');
  };
  if (!window.isSecureContext) {
    showMicMsg('The microphone only works over a secure (https://) connection.', 'error');
  }

  const testBtn = $<HTMLButtonElement>('[data-act=test]');
  const calBtn = $<HTMLButtonElement>('[data-act=calibrate]');
  const fill = $('.stg-meter-fill');
  const liveNote = $('.stg-live-note');
  const liveInfo = $('.stg-live-info');
  const calMsg = $('.stg-cal-msg');
  const dots = [...root.querySelectorAll<HTMLElement>('.stg-dot')];

  let test: Listener | null = null;
  let cal: Listener | null = null;
  let calTimer = 0;
  let busy = false;
  let lastNoteAt = 0;

  const meter = (p: PitchFrame) => {
    const db = 20 * Math.log10(Math.max(p.rms, 1e-6));
    const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    fill.style.width = `${pct}%`;
    fill.classList.toggle('is-low', p.rms < p.gate);
  };

  const stopTest = () => {
    test?.stop();
    test = null;
    testBtn.textContent = 'Start test';
    fill.style.width = '0';
    liveNote.textContent = '–';
    liveInfo.textContent = '';
  };

  testBtn.addEventListener('click', async () => {
    if (test) return stopTest();
    if (busy) return;
    busy = true;
    showMicMsg('');
    try {
      await unlockAudio();
      const l = await startPitchStream((p) => {
        meter(p);
        if (p.freq > 0 && p.clarity >= 0.85) {
          const { midi, cents } = freqToNote(p.freq, s.a4);
          liveNote.textContent = midiToName(midi);
          const c = Math.round(cents);
          liveInfo.textContent = `${p.freq.toFixed(1)} Hz · ${c > 0 ? '+' : ''}${c}¢`;
          lastNoteAt = p.time;
        } else if (p.time - lastNoteAt > 1000) {
          liveNote.textContent = '–';
          liveInfo.textContent = p.rms < p.gate ? 'Listening…' : 'Hearing sound, no clear note';
        }
      });
      if (!root.isConnected) return l.stop();
      test = l;
      testBtn.textContent = 'Stop test';
    } catch (e) {
      showMicMsg(micErrorMessage(e), 'error');
    } finally {
      busy = false;
    }
  });

  const finishCal = (msg: string, kind: '' | 'error' | 'ok') => {
    cal?.stop();
    cal = null;
    clearTimeout(calTimer);
    calBtn.disabled = false;
    testBtn.disabled = false;
    calBtn.textContent = 'Calibrate';
    calMsg.textContent = msg;
    calMsg.classList.toggle('is-error', kind === 'error');
    calMsg.classList.toggle('is-ok', kind === 'ok');
    fill.style.width = '0';
  };

  calBtn.addEventListener('click', async () => {
    if (cal || busy) return;
    stopTest();
    busy = true;
    calBtn.disabled = true;
    testBtn.disabled = true;
    calBtn.textContent = 'Listening…';
    calMsg.classList.remove('is-error', 'is-ok');
    calMsg.textContent = 'Keep the room quiet…';
    dots.forEach((d) => (d.className = 'stg-dot'));
    const onsets: number[] = [];
    try {
      await unlockAudio();
      cal = await startPitchStream((p) => {
        meter(p);
        if (p.onset) onsets.push(p.time);
      });
    } catch (e) {
      busy = false;
      finishCal(micErrorMessage(e), 'error');
      return;
    }
    busy = false;
    if (!root.isConnected) return finishCal('', '');

    // Let the noise floor settle, then schedule the clicks on the audio clock.
    calTimer = window.setTimeout(() => {
      const ctx = getAudioContext();
      const base = ctx.currentTime + 0.3;
      const nowPerf = performance.now();
      const nowCtx = ctx.currentTime;
      const clickTimes: number[] = [];
      for (let i = 0; i < CLICKS; i++) {
        const t = base + i * CLICK_GAP;
        playClick(true, t);
        clickTimes.push(nowPerf + (t - nowCtx) * 1000);
        window.setTimeout(() => dots[i] && dots[i].classList.add('is-click'), (t - nowCtx) * 1000);
      }
      calMsg.textContent = 'Listening for the clicks…';
      const total = (base - nowCtx + CLICKS * CLICK_GAP + 0.5) * 1000;
      calTimer = window.setTimeout(() => {
        const delays: number[] = [];
        clickTimes.forEach((ct, i) => {
          const hit = onsets.find((o) => o >= ct - 20 && o <= ct + 450);
          dots[i].classList.add(hit != null ? 'is-hit' : 'is-miss');
          if (hit != null) delays.push(Math.max(0, hit - ct));
        });
        if (delays.length < Math.ceil(CLICKS / 2)) {
          finishCal(
            `Only heard ${delays.length} of ${CLICKS} clicks. Turn the volume up, switch off silent mode, and try again in a quieter room.`,
            'error',
          );
          return;
        }
        delays.sort((a, b) => a - b);
        const mid = delays.length >> 1;
        const med = delays.length % 2 ? delays[mid] : (delays[mid - 1] + delays[mid]) / 2;
        const ms = Math.max(0, Math.min(300, Math.round(med)));
        set({ micLatencyMs: ms });
        renderLat();
        finishCal(`Heard ${delays.length} of ${CLICKS} clicks. Latency set to ${ms} ms.`, 'ok');
      }, total);
    }, 800);
  });

  return () => {
    clearTimeout(calTimer);
    stopTest();
    cal?.stop();
    cal = null;
  };
};

export default screen;
