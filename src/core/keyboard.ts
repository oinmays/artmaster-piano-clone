/**
 * Shared on-screen piano keyboard. Multi-touch, glissando, highlight API.
 * Used by the player (bottom of the falling-notes lane) and the chord finder.
 */
import { isBlack, midiToName } from './music';
import { playNote, unlockAudio, type Voice } from './audio';
import { emitNoteOff, emitNoteOn } from './input';

export type KeyMark = 'hint-L' | 'hint-R' | 'good' | 'bad' | 'chord';

export interface KeyboardOptions {
  /** Lowest and highest midi notes (inclusive). Snapped outward to white keys. */
  from: number;
  to: number;
  /** Play a sound when touched. Default true. */
  sound?: boolean;
  /** Publish touches to the input bus. Default true. */
  emit?: boolean;
  showNames?: boolean;
  /** Label only C keys (C3, C4…) instead of every white key. */
  namesOnlyC?: boolean;
  onPress?: (midi: number) => void;
}

export interface KeyboardHandle {
  el: HTMLElement;
  from: number;
  to: number;
  /** Set (or clear with null) a visual mark on a key. */
  mark(midi: number, mark: KeyMark | null): void;
  clearMarks(kind?: KeyMark): void;
  /** Show (or clear with null) a finger-number badge just above a key, coloured by hand. */
  finger(midi: number, finger: number | null, hand?: 'L' | 'R'): void;
  /** Horizontal centre and width of a key in px, relative to the keyboard element. */
  keyRect(midi: number): { x: number; w: number } | null;
  setShowNames(show: boolean): void;
  destroy(): void;
}

const css = `
.kb { position: relative; display: flex; height: 100%; width: 100%; touch-action: none;
  background: #0b0b0a; padding-top: 3px; user-select: none; -webkit-user-select: none; }
.kb-key { position: relative; flex: 1 1 0; border-radius: 0 0 6px 6px; display: flex;
  align-items: flex-end; justify-content: center; padding-bottom: 6px; font-size: 10px;
  font-weight: 600; color: #8a8178; transition: background-color 60ms; }
.kb-white { background: linear-gradient(#f3eee8, #fffdf9); margin: 0 1px; box-shadow: inset 0 -4px 0 #d9d1c7; }
.kb-black { position: absolute; top: 3px; height: 62%; z-index: 2; background: linear-gradient(#2b2b29, #10100f);
  border-radius: 0 0 4px 4px; color: #bbb; box-shadow: inset 0 -3px 0 #000; }
.kb-key.is-down { filter: brightness(0.86); }
.kb-key[data-mark='hint-R'] { background: var(--hand-right); color: #fff; }
.kb-key[data-mark='hint-L'] { background: var(--hand-left); color: #0b0b0a; }
.kb-key[data-mark='good'] { background: var(--good); color: #0b0b0a; }
.kb-key[data-mark='bad'] { background: var(--bad); color: #fff; }
.kb-key[data-mark='chord'] { background: var(--beige); color: #151514; }
.kb-black[data-mark='chord'] { background: var(--text-muted); color: #151514; }
.kb.no-names .kb-key span { display: none; }
.kb-key[data-finger]::before { content: attr(data-finger); position: absolute; left: 50%; bottom: calc(100% + 6px);
  transform: translateX(-50%); width: 20px; height: 20px; border-radius: 50%; z-index: 4; pointer-events: none;
  font: 700 12px/20px Inter, system-ui, sans-serif; text-align: center; color: var(--hand-right);
  background: #151514; box-shadow: 0 0 0 2px var(--hand-right); }
.kb-key[data-fhand='L']::before { color: var(--hand-left); box-shadow: 0 0 0 2px var(--hand-left); }
.kb-black[data-finger]::before { bottom: calc(100% + 30px); }
`;

let styled = false;
function injectStyles(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

export function createKeyboard(container: HTMLElement, opts: KeyboardOptions): KeyboardHandle {
  injectStyles();
  let from = opts.from;
  let to = opts.to;
  while (isBlack(from)) from--;
  while (isBlack(to)) to++;

  const el = document.createElement('div');
  el.className = 'kb';
  if (!opts.showNames) el.classList.add('no-names');
  container.appendChild(el);

  const keys = new Map<number, HTMLElement>();
  const whites: number[] = [];
  for (let m = from; m <= to; m++) if (!isBlack(m)) whites.push(m);
  const whiteW = 100 / whites.length;

  for (let m = from; m <= to; m++) {
    const k = document.createElement('div');
    k.dataset.midi = String(m);
    const name = midiToName(m);
    const label = document.createElement('span');
    label.textContent = opts.namesOnlyC ? (m % 12 === 0 ? name : '') : name.replace(/-?\d+$/, '');
    k.appendChild(label);
    if (isBlack(m)) {
      k.className = 'kb-key kb-black';
      const leftWhiteIdx = whites.indexOf(m - 1);
      k.style.width = `${whiteW * 0.62}%`;
      k.style.left = `${whiteW * (leftWhiteIdx + 1) - whiteW * 0.31}%`;
    } else {
      k.className = 'kb-key kb-white';
    }
    keys.set(m, k);
    el.appendChild(k);
  }

  // ---- Pointer handling (multi-touch + glissando) --------------------------
  const active = new Map<number, { midi: number; voice: Voice | null }>();

  const keyAt = (x: number, y: number): number | null => {
    const t = document.elementFromPoint(x, y) as HTMLElement | null;
    const k = t?.closest<HTMLElement>('.kb-key');
    return k && el.contains(k) ? Number(k.dataset.midi) : null;
  };

  const press = (pointerId: number, midi: number) => {
    const voice = opts.sound === false ? null : playNote(midi, { velocity: 0.8 });
    active.set(pointerId, { midi, voice });
    keys.get(midi)?.classList.add('is-down');
    if (opts.emit !== false) emitNoteOn({ midi, time: performance.now(), source: 'touch' });
    opts.onPress?.(midi);
  };

  const release = (pointerId: number) => {
    const a = active.get(pointerId);
    if (!a) return;
    active.delete(pointerId);
    a.voice?.stop();
    if (![...active.values()].some((v) => v.midi === a.midi)) keys.get(a.midi)?.classList.remove('is-down');
    if (opts.emit !== false) emitNoteOff({ midi: a.midi, time: performance.now(), source: 'touch' });
  };

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    void unlockAudio();
    const midi = keyAt(e.clientX, e.clientY);
    if (midi == null) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    press(e.pointerId, midi);
  };
  const onMove = (e: PointerEvent) => {
    const a = active.get(e.pointerId);
    if (!a) return;
    const midi = keyAt(e.clientX, e.clientY);
    if (midi != null && midi !== a.midi) {
      release(e.pointerId);
      press(e.pointerId, midi);
    }
  };
  const onUp = (e: PointerEvent) => release(e.pointerId);

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    el,
    from,
    to,
    mark(midi, mark) {
      const k = keys.get(midi);
      if (!k) return;
      if (mark) k.dataset.mark = mark;
      else delete k.dataset.mark;
    },
    finger(midi, finger, hand) {
      const k = keys.get(midi);
      if (!k) return;
      if (finger) {
        k.dataset.finger = String(finger);
        k.dataset.fhand = hand ?? 'R';
      } else {
        delete k.dataset.finger;
        delete k.dataset.fhand;
      }
    },
    clearMarks(kind) {
      keys.forEach((k) => {
        if (!kind || k.dataset.mark === kind) delete k.dataset.mark;
      });
    },
    keyRect(midi) {
      const k = keys.get(midi);
      if (!k) return null;
      const r = k.getBoundingClientRect();
      const base = el.getBoundingClientRect();
      return { x: r.left - base.left + r.width / 2, w: r.width };
    },
    setShowNames(show) {
      el.classList.toggle('no-names', !show);
    },
    destroy() {
      active.forEach((_, id) => release(id));
      el.remove();
    },
  };
}
