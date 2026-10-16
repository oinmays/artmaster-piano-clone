import type { Screen } from '../core/types';
import { getAudioContext, playNote, unlockAudio, type Voice } from '../core/audio';
import { createKeyboard } from '../core/keyboard';
import { CHORD_QUALITIES } from '../core/music';
import { load, save } from '../core/store';
import {
  ROOT_LABELS,
  QUALITY_SUFFIX,
  ROOT_NAMES,
  chordFormula,
  chordName,
  identifyChord,
  spellInterval,
} from '../tools/chordid';

/** Two octaves: C3..B4. */
const KB_FROM = 48;
const KB_TO = 71;
const STORE_KEY = 'chords';
const INVERSION_LABELS = ['Root', '1st', '2nd', '3rd'];

interface ChordState {
  mode: 'find' | 'name';
  root: number;
  quality: string;
  inversion: number;
}

const CSS = `
.cf { display: flex; flex-direction: column; gap: 1rem; }
.cf-back { display: inline-flex; align-items: center; gap: 0.25rem; min-height: 44px; color: var(--text-muted);
  text-decoration: none; font-size: 0.9375rem; }
.cf-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; max-width: 480px; }
.cf-result { display: flex; flex-direction: column; gap: 0.75rem; }
.cf-name { font-family: var(--font-serif); font-size: clamp(2.5rem, 12vw, 3.5rem); line-height: 1.05; margin: 0;
  overflow-wrap: anywhere; }
.cf-sub { color: var(--text-muted); margin: 0; }
.cf-facts { display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; }
.cf-fact h3 { font-family: var(--font-sans); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-muted); margin: 0 0 0.375rem; }
.cf-fact .row { gap: 0.375rem; }
.cf-fact .chip { font-size: 0.9375rem; min-height: 32px; }
.cf-formula { font-size: 1.125rem; font-weight: 600; letter-spacing: 0.04em; color: var(--beige); }
.cf-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.cf-actions .btn { flex: 1 1 120px; }
.cf-kb { height: clamp(150px, 26vw, 220px); border-radius: var(--radius); overflow: hidden; border: 1px solid var(--surface-3); }
.cf-opts { display: grid; gap: 1rem; }
.cf-opt h3 { font-family: var(--font-sans); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-muted); margin: 0 0 0.5rem; }
.cf-roots { display: grid; gap: 0.375rem; grid-template-columns: repeat(6, 1fr); }
.cf-roots .btn { padding: 0 0.25rem; font-size: 0.875rem; }
.cf-quals { display: grid; gap: 0.375rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 132px), 1fr)); }
.cf-quals .btn { padding: 0 0.5rem; justify-content: space-between; font-size: 0.875rem; }
.cf-quals .btn small { opacity: 0.7; font-weight: 600; }
.cf-invs { display: grid; gap: 0.375rem; grid-template-columns: repeat(4, 1fr); max-width: 480px; }
.cf-matches { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.cf-matches .chip { font-size: 1rem; min-height: 36px; padding: 0 0.875rem; }
.cf[data-mode='find'] [data-only='name'], .cf[data-mode='name'] [data-only='find'] { display: none; }
@media (min-width: 900px) {
  .cf-roots { grid-template-columns: repeat(12, 1fr); }
}
`;

const screen: Screen = (root) => {
  const saved = load<Partial<ChordState>>(STORE_KEY, {});
  const st: ChordState = {
    mode: saved.mode === 'name' ? 'name' : 'find',
    root: Number.isInteger(saved.root) && saved.root! >= 0 && saved.root! < 12 ? saved.root! : 0,
    quality: saved.quality && CHORD_QUALITIES[saved.quality] ? saved.quality : 'maj',
    inversion: Number(saved.inversion) || 0,
  };
  const selected = new Set<number>();

  const style = document.createElement('style');
  style.textContent = CSS;
  const section = document.createElement('section');
  section.className = 'screen cf';
  section.innerHTML = `
    <div>
      <a class="cf-back" href="#/tools">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Tools
      </a>
      <h1>Chord Finder</h1>
    </div>
    <div class="cf-mode" role="group" aria-label="Mode">
      <button class="btn" data-mode="find">Find a chord</button>
      <button class="btn" data-mode="name">What chord is this?</button>
    </div>
    <div class="card cf-result" aria-live="polite">
      <p class="cf-name" data-ref="name"></p>
      <p class="cf-sub" data-ref="sub"></p>
      <div class="cf-facts" data-only="find">
        <div class="cf-fact"><h3>Notes</h3><div class="row" data-ref="notes"></div></div>
        <div class="cf-fact"><h3>Formula</h3><span class="cf-formula" data-ref="formula"></span></div>
      </div>
      <div class="cf-fact" data-only="name"><h3>Possible names</h3><div class="cf-matches" data-ref="matches"></div></div>
      <div class="cf-actions">
        <button class="btn btn--primary" data-ref="play">Play</button>
        <button class="btn" data-ref="arp">Arpeggio</button>
        <button class="btn btn--ghost" data-ref="clear" data-only="name">Clear</button>
      </div>
    </div>
    <div class="cf-kb" data-ref="kb"></div>
    <div class="card cf-opts" data-only="find">
      <div class="cf-opt">
        <h3>Root</h3>
        <div class="cf-roots" data-ref="roots">
          ${ROOT_LABELS.map((l, i) => `<button class="btn" data-root="${i}" aria-label="Root ${l.replace('/', ' or ')}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="cf-opt">
        <h3>Quality</h3>
        <div class="cf-quals" data-ref="quals">
          ${Object.entries(CHORD_QUALITIES)
            .map(([k, q]) => `<button class="btn" data-quality="${k}"><span>${q.label}</span><small>${QUALITY_SUFFIX[k] || 'maj'}</small></button>`)
            .join('')}
        </div>
      </div>
      <div class="cf-opt">
        <h3>Inversion</h3>
        <div class="cf-invs" data-ref="invs">
          ${INVERSION_LABELS.map((l, i) => `<button class="btn" data-inv="${i}">${l}</button>`).join('')}
        </div>
      </div>
    </div>`;
  root.append(style, section);

  const $ = <T extends HTMLElement>(ref: string) => section.querySelector<T>(`[data-ref="${ref}"]`)!;
  const nameEl = $('name');
  const subEl = $('sub');
  const notesEl = $('notes');
  const formulaEl = $('formula');
  const matchesEl = $('matches');
  const playBtn = $<HTMLButtonElement>('play');
  const arpBtn = $<HTMLButtonElement>('arp');

  const kb = createKeyboard($('kb'), {
    from: KB_FROM,
    to: KB_TO,
    sound: true,
    emit: false,
    showNames: true,
    onPress: (midi) => {
      if (st.mode !== 'name') return;
      if (selected.has(midi)) {
        selected.delete(midi);
        kb.mark(midi, null);
      } else {
        selected.add(midi);
        kb.mark(midi, 'chord');
      }
      render();
    },
  });

  // ---- Chord building -------------------------------------------------------
  /** The current chord's notes, ascending, with the interval each one plays. */
  const voicing = (): Array<{ midi: number; interval: number }> => {
    const ivs = CHORD_QUALITIES[st.quality].intervals;
    const inv = Math.min(st.inversion, ivs.length - 1);
    const base = KB_FROM + st.root;
    let notes: Array<{ midi: number; interval: number }>;
    if (inv === 0) {
      notes = ivs.map((iv) => ({ midi: base + iv, interval: iv }));
    } else {
      // The chosen chord tone goes in the bass; every other tone stacks above it.
      const bass = base + (ivs[inv] % 12);
      notes = ivs.map((iv, i) => {
        let midi = base + (iv % 12);
        while (i !== inv && midi <= bass) midi += 12;
        return { midi, interval: iv };
      });
    }
    notes.sort((a, b) => a.midi - b.midi);
    while (notes[notes.length - 1].midi > KB_TO && notes[0].midi - 12 >= KB_FROM) {
      notes = notes.map((n) => ({ ...n, midi: n.midi - 12 }));
    }
    return notes;
  };

  const playMidis = (): number[] =>
    st.mode === 'find' ? voicing().map((n) => n.midi) : [...selected].sort((a, b) => a - b);

  // ---- Rendering --------------------------------------------------------------
  const pressed = (sel: string, pred: (b: HTMLElement) => boolean) =>
    section.querySelectorAll<HTMLElement>(sel).forEach((b) => b.setAttribute('aria-pressed', String(pred(b))));

  function render(): void {
    section.dataset.mode = st.mode;
    pressed('[data-mode]', (b) => b.dataset.mode === st.mode);

    if (st.mode === 'find') {
      const q = CHORD_QUALITIES[st.quality];
      if (st.inversion >= q.intervals.length) st.inversion = 0;
      pressed('[data-root]', (b) => Number(b.dataset.root) === st.root);
      pressed('[data-quality]', (b) => b.dataset.quality === st.quality);
      section.querySelectorAll<HTMLButtonElement>('[data-inv]').forEach((b) => {
        const i = Number(b.dataset.inv);
        b.disabled = i >= q.intervals.length;
        b.setAttribute('aria-pressed', String(i === st.inversion));
      });

      const notes = voicing();
      const rootName = ROOT_NAMES[st.root];
      const symbol = chordName(st.root, st.quality);
      const bass = notes[0];
      nameEl.textContent = st.inversion > 0 ? `${symbol}/${spellInterval(rootName, bass.interval)}` : symbol;
      const invText = st.inversion === 0 ? 'root position' : `${INVERSION_LABELS[st.inversion]} inversion`;
      subEl.textContent = `${rootName} ${q.label.toLowerCase()}, ${invText}`;
      notesEl.innerHTML = notes.map((n) => `<span class="chip">${spellInterval(rootName, n.interval)}</span>`).join('');
      formulaEl.textContent = chordFormula(st.quality);

      kb.clearMarks();
      notes.forEach((n) => kb.mark(n.midi, 'chord'));
      playBtn.disabled = arpBtn.disabled = false;
      save(STORE_KEY, st);
      return;
    }

    // "What chord is this?"
    const midis = [...selected];
    const matches = identifyChord(midis);
    if (midis.length === 0) {
      nameEl.textContent = 'Tap some keys';
      subEl.textContent = 'Select three or more notes on the keyboard and the chord is named here.';
    } else if (matches.length === 0) {
      nameEl.textContent = 'No match';
      subEl.textContent =
        new Set(midis.map((m) => m % 12)).size < 3
          ? 'A chord needs at least three different notes.'
          : 'These notes do not form a chord this tool knows.';
    } else {
      nameEl.textContent = matches[0].name;
      const q = CHORD_QUALITIES[matches[0].quality];
      const inv = matches[0].inversion;
      subEl.textContent = `${ROOT_NAMES[matches[0].rootPc]} ${q.label.toLowerCase()}, ${
        inv === 0 ? 'root position' : `${INVERSION_LABELS[inv]} inversion`
      }`;
    }
    matchesEl.innerHTML = matches.length
      ? matches.map((m) => `<span class="chip">${m.name}</span>`).join('')
      : '<span class="muted">None yet</span>';
    playBtn.disabled = arpBtn.disabled = midis.length === 0;
    save(STORE_KEY, st);
  }

  // ---- Sound ------------------------------------------------------------------
  let voices: Voice[] = [];
  const stopAll = () => {
    voices.forEach((v) => v.stop());
    voices = [];
  };
  const play = async (arpeggio: boolean) => {
    await unlockAudio();
    stopAll();
    const t0 = getAudioContext().currentTime + 0.03;
    const midis = playMidis();
    voices = midis.map((m, i) =>
      playNote(m, { when: arpeggio ? t0 + i * 0.22 : t0, duration: arpeggio ? 1.6 : 2, velocity: 0.7 }),
    );
  };
  playBtn.addEventListener('click', () => void play(false));
  arpBtn.addEventListener('click', () => void play(true));

  // ---- Controls ---------------------------------------------------------------
  section.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.mode) {
      const mode = t.dataset.mode as ChordState['mode'];
      if (mode === st.mode) return;
      st.mode = mode;
      stopAll();
      kb.clearMarks();
      if (mode === 'name') selected.forEach((m) => kb.mark(m, 'chord'));
    } else if (t.dataset.root) {
      st.root = Number(t.dataset.root);
    } else if (t.dataset.quality) {
      st.quality = t.dataset.quality;
    } else if (t.dataset.inv) {
      st.inversion = Number(t.dataset.inv);
    } else if (t.dataset.ref === 'clear') {
      selected.clear();
      kb.clearMarks();
    } else {
      return;
    }
    render();
  });

  render();

  return () => {
    stopAll();
    kb.destroy();
    style.remove();
  };
};

export default screen;
