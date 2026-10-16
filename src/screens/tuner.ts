/** Chromatic tuner: #/tools/tuner */
import type { Screen } from '../core/types';
import { unlockAudio } from '../core/audio';
import { NOTE_NAMES } from '../core/music';
import { getSettings, updateSettings } from '../core/store';
import { micErrorMessage, micSupported, startPitchStream, type Listener } from '../listen';
import { freqToNote } from '../listen/pitch';

const css = `
.tnr { display: flex; flex-direction: column; gap: 1rem; }
.tnr-back { align-self: flex-start; min-height: 44px; display: inline-flex; align-items: center;
  color: var(--text-muted); text-decoration: none; font-size: 0.9375rem; }
.tnr-head h1 { margin: 0; }
.tnr-dial { display: flex; flex-direction: column; align-items: center; padding: 1.25rem 1rem 1.5rem; }
.tnr-svg { width: min(100%, 420px); height: auto; overflow: visible; }
.tnr-arc { fill: none; stroke: var(--surface-3); stroke-width: 10; stroke-linecap: round; }
.tnr-zone { fill: none; stroke: var(--good); stroke-width: 10; opacity: 0.35; }
.tnr-tick { stroke: var(--border); stroke-width: 2; }
.tnr-tick--major { stroke: var(--text-muted); stroke-width: 2.5; }
.tnr-lbl { fill: var(--text-muted); font: 500 11px var(--font-sans); text-anchor: middle; }
.tnr-needle { stroke: var(--accent); stroke-width: 4; stroke-linecap: round; transition: stroke 150ms; }
.tnr-hub { fill: var(--accent); transition: fill 150ms; }
.tnr.is-in .tnr-needle { stroke: var(--good); }
.tnr.is-in .tnr-hub { fill: var(--good); }
.tnr-readout { margin-top: -2.75rem; text-align: center; min-height: 7.5rem; transition: opacity 300ms; }
.tnr.is-idle .tnr-readout { opacity: 0.35; }
.tnr-note { font-family: var(--font-serif); font-size: clamp(4rem, 18vw, 6rem); line-height: 1;
  color: var(--text); transition: color 150ms; }
.tnr.is-in .tnr-note { color: var(--good); }
.tnr-note sub { font-family: var(--font-sans); font-size: 0.32em; vertical-align: baseline;
  color: var(--text-muted); margin-left: 0.1em; }
.tnr-cents { font-variant-numeric: tabular-nums; font-weight: 600; margin-top: 0.25rem; }
.tnr-hz { font-variant-numeric: tabular-nums; color: var(--text-muted); font-size: 0.875rem; }
.tnr-flat, .tnr-sharp { fill: var(--text-muted); font: 600 14px var(--font-sans); }
.tnr-msg { min-height: 1.5rem; text-align: center; }
.tnr-msg.is-error { color: var(--bad); text-align: left; }
.tnr-actions { justify-content: center; }
.tnr-actions .btn { min-width: 10rem; }
.tnr-ref { display: flex; flex-direction: column; gap: 0.75rem; }
.tnr-ref-row { display: flex; align-items: center; gap: 0.75rem; }
.tnr-ref-val { flex: 1; text-align: center; font-variant-numeric: tabular-nums; font-size: 1.25rem; font-weight: 600; }
.tnr-step { width: 44px; height: 44px; padding: 0; font-size: 1.25rem; }
.tnr-range { width: 100%; accent-color: var(--accent); min-height: 44px; }
`;

let styled = false;
function injectStyles(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

const CX = 160;
const CY = 170;
const R = 140;
const SPAN = 75; // degrees each side for ±50 cents

const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
};
const centsToDeg = (c: number) => (Math.max(-50, Math.min(50, c)) / 50) * SPAN;

function arc(from: number, to: number, r: number): string {
  const a = pt(from, r);
  const b = pt(to, r);
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} A${r} ${r} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function gaugeSvg(): string {
  let ticks = '';
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0;
    const d = centsToDeg(c);
    const a = pt(d, R - 14);
    const b = pt(d, R - (major ? 30 : 22));
    ticks += `<line class="tnr-tick${major ? ' tnr-tick--major' : ''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    if (major) {
      const l = pt(d, R - 44);
      ticks += `<text class="tnr-lbl" x="${l.x}" y="${l.y + 4}">${c > 0 ? '+' : ''}${c}</text>`;
    }
  }
  const tip = pt(0, R - 6);
  return `
  <svg class="tnr-svg" viewBox="0 0 320 190" role="img" aria-label="Tuning gauge, minus 50 to plus 50 cents">
    <path class="tnr-arc" d="${arc(-SPAN, SPAN, R)}"/>
    <path class="tnr-zone" d="${arc(centsToDeg(-5), centsToDeg(5), R)}"/>
    ${ticks}
    <text class="tnr-flat" x="${pt(-SPAN, R).x - 4}" y="${pt(-SPAN, R).y + 26}" text-anchor="middle">♭</text>
    <text class="tnr-sharp" x="${pt(SPAN, R).x + 4}" y="${pt(SPAN, R).y + 26}" text-anchor="middle">♯</text>
    <g class="tnr-needle-g">
      <line class="tnr-needle" x1="${CX}" y1="${CY}" x2="${tip.x}" y2="${tip.y}"/>
    </g>
    <circle class="tnr-hub" cx="${CX}" cy="${CY}" r="7"/>
  </svg>`;
}

const screen: Screen = (root) => {
  injectStyles();
  let a4 = getSettings().a4;

  root.innerHTML = `
  <section class="screen tnr is-idle">
    <a class="tnr-back" href="#/tools">‹ Tools</a>
    <div class="tnr-head"><p class="eyebrow">Tools</p><h1>Tuner</h1></div>
    <div class="card tnr-dial">
      ${gaugeSvg()}
      <div class="tnr-readout" aria-live="polite">
        <div class="tnr-note">–</div>
        <div class="tnr-cents">&nbsp;</div>
        <div class="tnr-hz">Play a single note</div>
      </div>
    </div>
    <div class="row tnr-actions"><button class="btn btn--primary" data-act="toggle">Start listening</button></div>
    <p class="tnr-msg muted" role="status"></p>
    <div class="card tnr-ref">
      <div class="row"><strong>Reference pitch</strong><span class="spacer"></span><span class="muted">A4 =</span></div>
      <div class="tnr-ref-row">
        <button class="btn tnr-step" data-act="down" aria-label="Lower reference by 1 Hz">−</button>
        <span class="tnr-ref-val"></span>
        <button class="btn tnr-step" data-act="up" aria-label="Raise reference by 1 Hz">+</button>
      </div>
      <input class="tnr-range" type="range" min="430" max="450" step="1" aria-label="A4 reference frequency">
      <p class="muted" style="margin:0;font-size:0.875rem">Most pianos are tuned to A4 = 440 Hz. Play one key at a time and hold it.</p>
    </div>
  </section>`;

  const sec = root.querySelector<HTMLElement>('.tnr')!;
  const needle = root.querySelector<SVGGElement>('.tnr-needle-g')!;
  const noteEl = root.querySelector<HTMLElement>('.tnr-note')!;
  const centsEl = root.querySelector<HTMLElement>('.tnr-cents')!;
  const hzEl = root.querySelector<HTMLElement>('.tnr-hz')!;
  const msg = root.querySelector<HTMLElement>('.tnr-msg')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-act=toggle]')!;
  const refVal = root.querySelector<HTMLElement>('.tnr-ref-val')!;
  const range = root.querySelector<HTMLInputElement>('.tnr-range')!;

  const setA4 = (v: number) => {
    a4 = Math.max(430, Math.min(450, Math.round(v)));
    refVal.textContent = `${a4} Hz`;
    range.value = String(a4);
    updateSettings({ a4 });
  };
  refVal.textContent = `${a4} Hz`;
  range.value = String(a4);
  range.addEventListener('input', () => setA4(Number(range.value)));
  root.querySelector('[data-act=down]')!.addEventListener('click', () => setA4(a4 - 1));
  root.querySelector('[data-act=up]')!.addEventListener('click', () => setA4(a4 + 1));

  const showError = (text: string) => {
    msg.textContent = text;
    msg.classList.add('is-error');
  };
  if (!window.isSecureContext) {
    showError('The microphone only works over a secure (https://) connection. Open the app from its https address.');
  } else if (!micSupported()) {
    showError("This browser can't use the microphone. On iPhone or iPad, use Safari.");
  }

  // ---- Pitch state ---------------------------------------------------------
  let listener: Listener | null = null;
  let starting = false;
  const recent: number[] = [];
  let freq = 0; // median-filtered
  let lastHeard = 0;
  let shownCents = 0;
  let targetCents = 0;
  let raf = 0;

  const onPitch = (p: { freq: number; clarity: number; time: number }) => {
    if (p.freq <= 0 || p.clarity < 0.85 || p.freq < 25 || p.freq > 4500) return;
    // Snap the filter when the note changes by more than a semitone.
    if (freq && Math.abs(1200 * Math.log2(p.freq / freq)) > 70) recent.length = 0;
    recent.push(p.freq);
    if (recent.length > 5) recent.shift();
    const sorted = [...recent].sort((a, b) => a - b);
    freq = sorted[sorted.length >> 1];
    lastHeard = performance.now();
  };

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const live = freq > 0 && now - lastHeard < 1200;
    sec.classList.toggle('is-idle', !live);
    if (live) {
      const { midi, cents } = freqToNote(freq, a4);
      targetCents = cents;
      const name = NOTE_NAMES[((midi % 12) + 12) % 12];
      const octave = Math.floor(midi / 12) - 1;
      const html = `${name}<sub>${octave}</sub>`;
      if (noteEl.innerHTML !== html) noteEl.innerHTML = html;
      const c = Math.round(cents);
      centsEl.textContent = c === 0 ? 'In tune' : `${c > 0 ? '+' : ''}${c} cents ${c > 0 ? '(sharp)' : '(flat)'}`;
      hzEl.textContent = `${freq.toFixed(1)} Hz`;
      sec.classList.toggle('is-in', Math.abs(cents) <= 5);
    } else {
      targetCents = 0;
      sec.classList.remove('is-in');
      if (!listener) {
        noteEl.textContent = '–';
        centsEl.innerHTML = '&nbsp;';
        hzEl.textContent = 'Play a single note';
      }
    }
    shownCents += (targetCents - shownCents) * (live ? 0.22 : 0.08);
    needle.setAttribute('transform', `rotate(${centsToDeg(shownCents).toFixed(2)} ${CX} ${CY})`);
  };
  raf = requestAnimationFrame(frame);

  const stop = () => {
    listener?.stop();
    listener = null;
    toggle.textContent = 'Start listening';
    freq = 0;
    recent.length = 0;
  };

  toggle.addEventListener('click', async () => {
    if (listener) {
      stop();
      msg.textContent = '';
      return;
    }
    if (starting) return;
    starting = true;
    msg.classList.remove('is-error');
    msg.textContent = 'Starting the microphone…';
    try {
      await unlockAudio();
      const l = await startPitchStream(onPitch, { minFreq: 26, maxFreq: 4300 });
      if (!root.isConnected) {
        l.stop();
        return;
      }
      listener = l;
      toggle.textContent = 'Stop';
      msg.textContent = 'Listening. Play one note and let it ring.';
    } catch (e) {
      showError(micErrorMessage(e));
    } finally {
      starting = false;
    }
  });

  return () => {
    cancelAnimationFrame(raf);
    stop();
  };
};

export default screen;
