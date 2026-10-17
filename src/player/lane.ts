/**
 * Falling-notes canvas. Notes fall from the top to a hit line right above the keyboard.
 * Bars line up with keys via keyboard.keyRect(), cached on resize.
 *
 * Performance: one rAF loop, no per-frame allocation (typed arrays for key geometry,
 * a fixed ring of "float" labels, precomputed note names and colours).
 */
import type { KeyboardHandle } from '../core/keyboard';
import { isBlack, midiToName } from '../core/music';
import type { Engine, RenderNote } from './engine';
import { ST_MISSED, ST_PENDING, isHitStatus, type ExpectedNote } from './scoring';

export interface LaneOptions {
  container: HTMLElement;
  engine: Engine;
  keyboard: KeyboardHandle;
  showNames: boolean;
  /** Suggested finger (1–5) in each scored note. */
  showFingers: boolean;
  /** Called at the start of every frame (advance the engine, update UI). */
  onFrame?: (now: number) => void;
}

export interface LaneHandle {
  start(): void;
  stop(): void;
  /** Floating judgement label above a key. */
  float(midi: number, text: string, kind: 'good' | 'warn' | 'bad'): void;
  /** Brief coloured glow above a key at the hit line. */
  flashKey(midi: number, kind: 'good' | 'bad'): void;
  setShowNames(show: boolean): void;
  setShowFingers(show: boolean): void;
  /** Re-measure key positions (call after the keyboard is rebuilt or resized). */
  relayout(): void;
  destroy(): void;
}

const NAMES: string[] = Array.from({ length: 128 }, (_, m) => midiToName(m).replace(/-?\d+$/, ''));
const DIGITS = ['', '1', '2', '3', '4', '5'];
const HIT_FLASH_MS = 260;
const KEY_FLASH_MS = 220;
const FLOAT_MS = 650;
const FLOATS = 12;

interface Float {
  text: string;
  midi: number;
  born: number;
  color: string;
}

export function createLane(opts: LaneOptions): LaneHandle {
  const { container, engine, keyboard } = opts;
  let showNames = opts.showNames;
  let showFingers = opts.showFingers;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // ---- Colours --------------------------------------------------------------
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const C = {
    bg: v('--bg', '#151514'),
    right: v('--hand-right', '#fe5826'),
    left: v('--hand-left', '#23e7b9'),
    good: v('--good', '#23e7b9'),
    warn: v('--warn', '#f6c810'),
    bad: v('--bad', '#ee374d'),
    line: 'rgba(229,215,201,0.08)',
    barLine: 'rgba(229,215,201,0.16)',
    hit: v('--beige', '#e5d7c9'),
    missed: '#4a4a46',
    text: '#151514',
  };
  const rightDark = shade(C.right, 0.68);
  const leftDark = shade(C.left, 0.62);
  // Hits flash with --good; for the left hand (already mint) use a lighter flash so it reads.
  const hitFlashL = '#eafff8';

  // ---- Geometry -------------------------------------------------------------
  let W = 0;
  let H = 0;
  let dpr = 1;
  const keyX = new Float32Array(128);
  const keyW = new Float32Array(128);
  const black = new Uint8Array(128);
  for (let m = 0; m < 128; m++) black[m] = isBlack(m) ? 1 : 0;

  const relayout = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    const kbRect = keyboard.el.getBoundingClientRect();
    const dx = kbRect.left - rect.left;
    keyX.fill(0);
    keyW.fill(0);
    for (let m = keyboard.from; m <= keyboard.to; m++) {
      const r = keyboard.keyRect(m);
      if (!r) continue;
      keyX[m] = r.x + dx;
      keyW[m] = r.w;
    }
  };

  const ro = new ResizeObserver(() => relayout());
  ro.observe(container);
  ro.observe(keyboard.el);

  // ---- Effects --------------------------------------------------------------
  const keyFlashUntil = new Float64Array(128);
  const keyFlashBad = new Uint8Array(128);
  const floats: Float[] = Array.from({ length: FLOATS }, () => ({ text: '', midi: 0, born: -1e9, color: '' }));
  let floatIdx = 0;

  // ---- Drawing --------------------------------------------------------------
  const lookaheadBeats = () => (3 * Math.sqrt(100 / engine.tempo)) / engine.secPerBeat;

  function drawNote(n: RenderNote | ExpectedNote, B: number, ppb: number, hitY: number, status: number, judgedAt: number, now: number, accomp: boolean): void {
    const m = n.midi;
    const kw = keyW[m];
    if (kw === 0) return;
    const top = hitY - (n.beat + n.dur - B) * ppb;
    if (top >= hitY) return;
    let bottom = hitY - (n.beat - B) * ppb;
    if (bottom > hitY) bottom = hitY;
    const isB = black[m] === 1;
    const w = kw * (isB ? 0.92 : 0.8);
    const x = keyX[m] - w / 2;
    const h = Math.max(4, bottom - top - 1);
    const y = bottom - h;
    const right = n.hand === 'R';

    let fill: string;
    let alpha = 1;
    if (accomp) {
      fill = right ? (isB ? rightDark : C.right) : isB ? leftDark : C.left;
      alpha = 0.32;
    } else if (status === ST_PENDING) {
      fill = right ? (isB ? rightDark : C.right) : isB ? leftDark : C.left;
    } else if (status === ST_MISSED) {
      fill = C.missed;
    } else if (isHitStatus(status)) {
      if (now - judgedAt < HIT_FLASH_MS) fill = right ? C.good : hitFlashL;
      else {
        fill = right ? (isB ? rightDark : C.right) : isB ? leftDark : C.left;
        alpha = 0.4;
      }
    } else {
      // skipped
      fill = C.missed;
      alpha = 0.4;
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(6, w / 3, h / 2));
    else ctx.rect(x, y, w, h);
    ctx.fill();
    if (isB && !accomp && status === ST_PENDING) {
      // Dark key notes get a thin inner outline so they stay distinguishable.
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Finger number in a dark disc at the note's leading (bottom) edge; the name sits above it.
    let nameY = bottom - 5;
    const f = n.finger;
    if (showFingers && !accomp && f && h >= 14 && w >= 12) {
      const r = Math.min(8, w / 2 - 1, h / 2 - 1);
      const cy = bottom - r - 2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(21,21,20,0.82)';
      ctx.beginPath();
      ctx.arc(x + w / 2, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = status === ST_MISSED ? '#9a948c' : right ? C.right : C.left;
      ctx.fillText(DIGITS[f], x + w / 2, cy + 4);
      nameY = cy - r - 4;
    }
    if (showNames && !accomp && w > 11 && nameY - top > 11) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = status === ST_MISSED ? '#9a948c' : C.text;
      ctx.fillText(NAMES[m], x + w / 2, nameY);
    }
    ctx.globalAlpha = 1;
  }

  function draw(now: number): void {
    if (W === 0 || H === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    const B = engine.currentBeat;
    const look = lookaheadBeats();
    const hitY = H - 3;
    const ppb = (hitY - 8) / look;
    const bpb = engine.bpb;

    // Faint column guides on every C.
    ctx.fillStyle = C.line;
    for (let m = keyboard.from; m <= keyboard.to; m++) {
      if (m % 12 === 0 && keyW[m] > 0) ctx.fillRect(keyX[m] - keyW[m] / 2, 0, 1, hitY);
    }

    // Bar lines.
    ctx.fillStyle = C.barLine;
    for (let k = Math.ceil(B / bpb); k * bpb <= B + look; k++) {
      const y = hitY - (k * bpb - B) * ppb;
      ctx.fillRect(0, Math.round(y), W, 1);
    }

    ctx.font = '700 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Accompaniment (behind), then scored notes.
    const acc = engine.accomp;
    for (let i = lowerBound(acc, B - 16); i < acc.length && acc[i].beat <= B + look; i++) {
      drawNote(acc[i], B, ppb, hitY, 0, 0, now, true);
    }
    const s = engine.scorer;
    const notes = s.notes;
    for (let i = lowerBound(notes, B - 16); i < notes.length && notes[i].beat <= B + look; i++) {
      drawNote(notes[i], B, ppb, hitY, s.status[i], s.judgedAt[i], now, false);
    }

    // Hit line (pulses while waiting for the learner).
    ctx.globalAlpha = engine.waiting ? 0.55 + 0.45 * Math.sin(now / 160) : 0.7;
    ctx.fillStyle = engine.waiting ? C.warn : C.hit;
    ctx.fillRect(0, hitY - 1, W, 3);
    ctx.globalAlpha = 1;

    // Key glows.
    for (let m = keyboard.from; m <= keyboard.to; m++) {
      const until = keyFlashUntil[m];
      if (until <= now) continue;
      const a = (until - now) / KEY_FLASH_MS;
      ctx.globalAlpha = 0.6 * a;
      ctx.fillStyle = keyFlashBad[m] ? C.bad : C.good;
      ctx.fillRect(keyX[m] - keyW[m] / 2, hitY - 36, keyW[m], 36);
    }
    ctx.globalAlpha = 1;

    // Floating labels.
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    for (let i = 0; i < FLOATS; i++) {
      const f = floats[i];
      const age = (now - f.born) / FLOAT_MS;
      if (age < 0 || age >= 1) continue;
      ctx.globalAlpha = 1 - age * age;
      ctx.fillStyle = f.color;
      const x = Math.max(28, Math.min(W - 28, keyX[f.midi]));
      ctx.fillText(f.text, x, hitY - 44 - age * 36);
    }
    ctx.globalAlpha = 1;
  }

  // ---- Loop -----------------------------------------------------------------
  let raf = 0;
  const frame = () => {
    const now = performance.now();
    opts.onFrame?.(now);
    draw(now);
    raf = requestAnimationFrame(frame);
  };

  // Block iOS scroll / pinch-zoom / double-tap gestures on the lane.
  const prevent = (e: Event) => e.preventDefault();
  canvas.addEventListener('touchstart', prevent, { passive: false });
  canvas.addEventListener('touchmove', prevent, { passive: false });
  canvas.addEventListener('gesturestart', prevent as EventListener);
  canvas.addEventListener('dblclick', prevent);

  relayout();

  return {
    start() {
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    float(midi, text, kind) {
      const f = floats[floatIdx];
      floatIdx = (floatIdx + 1) % FLOATS;
      f.text = text;
      f.midi = midi;
      f.born = performance.now();
      f.color = kind === 'good' ? C.good : kind === 'warn' ? C.warn : C.bad;
    },
    flashKey(midi, kind) {
      if (midi < 0 || midi > 127) return;
      keyFlashUntil[midi] = performance.now() + KEY_FLASH_MS;
      keyFlashBad[midi] = kind === 'bad' ? 1 : 0;
    },
    setShowNames(show) {
      showNames = show;
    },
    setShowFingers(show) {
      showFingers = show;
    },
    relayout,
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      canvas.removeEventListener('touchstart', prevent);
      canvas.removeEventListener('touchmove', prevent);
      canvas.removeEventListener('gesturestart', prevent as EventListener);
      canvas.removeEventListener('dblclick', prevent);
      canvas.remove();
    },
  };
}

function lowerBound(arr: { beat: number }[], beat: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].beat < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Darken a #rrggbb colour by factor k (0–1). */
function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}
