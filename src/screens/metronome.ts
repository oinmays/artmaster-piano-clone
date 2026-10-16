import type { Screen } from '../core/types';
import { getAudioContext, getMaster, playClick, unlockAudio } from '../core/audio';
import { load, save } from '../core/store';
import { MAX_BPM, METERS, MIN_BPM, SUBDIVISIONS, TapTempo, clampBpm, meterById, tempoMarking } from '../tools/tempo';

interface MetronomeSettings {
  bpm: number;
  meter: string;
  accent: boolean;
  sub: number;
}

const DEFAULTS: MetronomeSettings = { bpm: 100, meter: '4/4', accent: true, sub: 1 };
const STORE_KEY = 'metronome';

/** How often the scheduler wakes up (ms) and how far ahead it schedules (s). */
const TICK_MS = 25;
const LOOKAHEAD_S = 0.1;

const CSS = `
.mt { display: flex; flex-direction: column; gap: 1rem; max-width: 640px; }
.mt-back { display: inline-flex; align-items: center; gap: 0.25rem; min-height: 44px; color: var(--text-muted);
  text-decoration: none; font-size: 0.9375rem; }
.mt-main { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 1.25rem 1rem; }
.mt-marking { font-family: var(--font-serif); font-size: 1.25rem; color: var(--beige); font-style: italic; margin: 0; }
.mt-bpm { display: flex; align-items: center; justify-content: center; gap: 1rem; width: 100%; }
.mt-num { text-align: center; min-width: 4ch; }
.mt-num strong { display: block; font-family: var(--font-serif); font-weight: 500; font-size: clamp(4rem, 20vw, 6rem);
  line-height: 1; font-variant-numeric: tabular-nums; }
.mt-num span { font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
.mt-step { width: 56px; height: 56px; border-radius: 50%; padding: 0; font-size: 1.75rem; line-height: 1; flex: none; }
.mt-slider { width: 100%; height: 44px; margin: 0; accent-color: var(--accent); background: transparent; }
.mt-dots { display: flex; justify-content: center; align-items: center; gap: 0.625rem; min-height: 36px; flex-wrap: wrap; }
.mt-dot { width: 18px; height: 18px; border-radius: 50%; background: var(--surface-3); transition: transform 60ms, background-color 60ms; }
.mt-dot.is-group { width: 26px; height: 26px; }
.mt-dot.is-on { background: var(--beige); transform: scale(1.15); }
.mt-dot.is-on.is-accent { background: var(--accent); }
.mt-actions { display: grid; grid-template-columns: 2fr 1fr; gap: 0.75rem; width: 100%; }
.mt-actions .btn { min-height: 56px; font-size: 1.0625rem; }
.mt-opts { display: grid; gap: 1rem; }
.mt-opt h3 { font-family: var(--font-sans); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-muted); margin: 0 0 0.5rem; }
.mt-seg { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); }
.mt-seg .btn { padding: 0 0.5rem; }
@media (min-width: 900px) {
  .mt { max-width: 1000px; display: grid; grid-template-columns: 1.1fr 1fr; align-items: start; }
  .mt > .mt-head { grid-column: 1 / -1; }
}
`;

const screen: Screen = (root) => {
  const saved = load<Partial<MetronomeSettings>>(STORE_KEY, {});
  const s: MetronomeSettings = { ...DEFAULTS, ...saved };
  s.bpm = clampBpm(Number(s.bpm) || DEFAULTS.bpm);
  s.meter = meterById(s.meter).id;
  s.sub = SUBDIVISIONS.some((x) => x.id === s.sub) ? s.sub : 1;

  const style = document.createElement('style');
  style.textContent = CSS;
  const section = document.createElement('section');
  section.className = 'screen mt';
  section.innerHTML = `
    <div class="mt-head">
      <a class="mt-back" href="#/tools">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Tools
      </a>
      <h1>Metronome</h1>
    </div>
    <div class="card mt-main">
      <p class="mt-marking" data-ref="marking"></p>
      <div class="mt-bpm">
        <button class="btn mt-step" data-step="-1" aria-label="Slower">−</button>
        <div class="mt-num" aria-live="polite"><strong data-ref="bpm"></strong><span>bpm</span></div>
        <button class="btn mt-step" data-step="1" aria-label="Faster">+</button>
      </div>
      <input class="mt-slider" type="range" min="${MIN_BPM}" max="${MAX_BPM}" step="1" aria-label="Tempo" data-ref="slider" />
      <div class="mt-dots" data-ref="dots" aria-hidden="true"></div>
      <div class="mt-actions">
        <button class="btn btn--primary" data-ref="toggle">Start</button>
        <button class="btn" data-ref="tap">Tap</button>
      </div>
    </div>
    <div class="card mt-opts">
      <div class="mt-opt">
        <h3>Time signature</h3>
        <div class="mt-seg" data-ref="meters">
          ${METERS.map((m) => `<button class="btn" data-meter="${m.id}">${m.id}</button>`).join('')}
        </div>
      </div>
      <div class="mt-opt">
        <h3>Subdivision</h3>
        <div class="mt-seg" data-ref="subs">
          ${SUBDIVISIONS.map((x) => `<button class="btn" data-sub="${x.id}">${x.label}</button>`).join('')}
        </div>
      </div>
      <div class="mt-opt">
        <h3>Accent</h3>
        <div class="mt-seg"><button class="btn" data-ref="accent">Accent first beat</button></div>
      </div>
    </div>`;
  root.append(style, section);

  const $ = <T extends HTMLElement>(ref: string) => section.querySelector<T>(`[data-ref="${ref}"]`)!;
  const bpmEl = $('bpm');
  const markingEl = $('marking');
  const slider = $<HTMLInputElement>('slider');
  const dotsEl = $('dots');
  const toggleBtn = $<HTMLButtonElement>('toggle');
  const tapBtn = $<HTMLButtonElement>('tap');
  const accentBtn = $<HTMLButtonElement>('accent');

  // ---- State rendering ------------------------------------------------------
  let dots: HTMLElement[] = [];
  const persist = () => save(STORE_KEY, s);

  const renderBpm = () => {
    bpmEl.textContent = String(s.bpm);
    markingEl.textContent = tempoMarking(s.bpm);
    slider.value = String(s.bpm);
  };
  const renderDots = () => {
    const meter = meterById(s.meter);
    dotsEl.replaceChildren();
    dots = Array.from({ length: meter.beats }, (_, i) => {
      const d = document.createElement('span');
      d.className = 'mt-dot';
      if (meter.groups.includes(i)) d.classList.add('is-group');
      dotsEl.appendChild(d);
      return d;
    });
  };
  const renderOptions = () => {
    section.querySelectorAll<HTMLButtonElement>('[data-meter]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.meter === s.meter)),
    );
    section.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach((b) =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.sub) === s.sub)),
    );
    accentBtn.setAttribute('aria-pressed', String(s.accent));
  };

  const setBpm = (v: number) => {
    const next = clampBpm(v);
    if (next === s.bpm) return;
    s.bpm = next;
    renderBpm();
    persist();
  };

  // ---- Scheduler (lookahead pattern) ----------------------------------------
  let timer: number | undefined;
  let raf = 0;
  let running = false;
  let nextTime = 0;
  /** Position within the bar, counted in subdivision ticks. */
  let tick = 0;
  const visualQueue: Array<{ time: number; beat: number }> = [];
  let lit = -1;

  const subClick = (when: number) => {
    const c = getAudioContext();
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.14, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    o.connect(g).connect(getMaster());
    o.start(when);
    o.stop(when + 0.04);
  };

  const schedule = () => {
    const c = getAudioContext();
    const meter = meterById(s.meter);
    const ticksPerBar = meter.beats * s.sub;
    if (tick >= ticksPerBar) tick = 0;
    while (nextTime < c.currentTime + LOOKAHEAD_S) {
      if (tick % s.sub === 0) {
        const beat = tick / s.sub;
        playClick(s.accent && beat === 0, nextTime);
        visualQueue.push({ time: nextTime, beat });
      } else {
        subClick(nextTime);
      }
      nextTime += 60 / s.bpm / s.sub;
      tick = (tick + 1) % ticksPerBar;
    }
  };

  const setLit = (beat: number) => {
    if (lit >= 0) dots[lit]?.classList.remove('is-on', 'is-accent');
    lit = beat;
    const d = dots[beat];
    if (d) {
      d.classList.add('is-on');
      if (beat === 0 && s.accent) d.classList.add('is-accent');
    }
  };

  const draw = () => {
    const now = getAudioContext().currentTime;
    let beat = -1;
    while (visualQueue.length && visualQueue[0].time <= now) beat = visualQueue.shift()!.beat;
    if (beat >= 0) setLit(beat);
    raf = requestAnimationFrame(draw);
  };

  const start = async () => {
    await unlockAudio();
    if (running) return;
    running = true;
    const c = getAudioContext();
    tick = 0;
    nextTime = c.currentTime + 0.06;
    visualQueue.length = 0;
    schedule();
    timer = window.setInterval(schedule, TICK_MS);
    raf = requestAnimationFrame(draw);
    toggleBtn.textContent = 'Stop';
    toggleBtn.setAttribute('aria-pressed', 'true');
  };

  const stop = () => {
    running = false;
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    cancelAnimationFrame(raf);
    visualQueue.length = 0;
    setLit(-1);
    toggleBtn.textContent = 'Start';
    toggleBtn.setAttribute('aria-pressed', 'false');
  };

  // ---- Controls -------------------------------------------------------------
  toggleBtn.addEventListener('click', () => {
    if (running) stop();
    else void start();
  });

  slider.addEventListener('input', () => setBpm(Number(slider.value)));

  // +/- with hold-to-repeat.
  let holdDelay: number | undefined;
  let holdRepeat: number | undefined;
  const endHold = () => {
    window.clearTimeout(holdDelay);
    window.clearInterval(holdRepeat);
    holdDelay = holdRepeat = undefined;
  };
  section.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
    const dir = Number(b.dataset.step);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      endHold();
      setBpm(s.bpm + dir);
      let n = 0;
      holdDelay = window.setTimeout(() => {
        holdRepeat = window.setInterval(() => {
          n++;
          setBpm(s.bpm + dir * (n > 20 ? 5 : 1));
        }, 70);
      }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, endHold));
    // Keyboard activation (click without a pointer).
    b.addEventListener('click', (e) => {
      if (e.detail === 0) setBpm(s.bpm + dir);
    });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  const tapper = new TapTempo(4, 2000);
  tapBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const bpm = tapper.tap(performance.now());
    if (bpm != null) setBpm(bpm);
    tapBtn.textContent = tapper.count < 2 ? 'Tap again' : 'Tap';
  });
  tapBtn.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const bpm = tapper.tap(performance.now());
    if (bpm != null) setBpm(bpm);
  });

  section.querySelector('[data-ref="meters"]')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-meter]');
    if (!b) return;
    s.meter = b.dataset.meter!;
    tick = 0;
    lit = -1;
    renderDots();
    renderOptions();
    persist();
  });
  section.querySelector('[data-ref="subs"]')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sub]');
    if (!b) return;
    // Mid-play: jump to the next beat boundary so the pulse stays on the grid.
    const into = tick % s.sub;
    if (into !== 0) {
      nextTime += ((s.sub - into) * 60) / s.bpm / s.sub;
      tick += s.sub - into;
    }
    const beat = (tick / s.sub) % meterById(s.meter).beats;
    s.sub = Number(b.dataset.sub);
    tick = beat * s.sub;
    renderOptions();
    persist();
  });
  accentBtn.addEventListener('click', () => {
    s.accent = !s.accent;
    renderOptions();
    persist();
  });

  const onVisibility = () => {
    if (document.hidden && running) stop();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', stop);

  renderBpm();
  renderDots();
  renderOptions();

  return () => {
    stop();
    endHold();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', stop);
    style.remove();
  };
};

export default screen;
