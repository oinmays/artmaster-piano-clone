import type { Screen } from '../core/types';

const CSS = `
.tl-hub .tl-grid { display: grid; gap: 0.875rem; grid-template-columns: 1fr; margin-top: 1rem; }
@media (min-width: 720px) { .tl-hub .tl-grid { grid-template-columns: repeat(3, 1fr); } }
.tl-card { display: flex; align-items: center; gap: 1rem; min-height: 112px; text-decoration: none;
  color: var(--text); transition: border-color 120ms, background-color 120ms; }
.tl-card:hover, .tl-card:focus-visible { border-color: var(--accent); outline: none; }
.tl-card:active { background: var(--surface-2); }
@media (min-width: 720px) { .tl-card { flex-direction: column; align-items: flex-start; min-height: 220px; padding: 1.25rem; } }
.tl-icon { flex: none; width: 64px; height: 64px; border-radius: var(--radius); background: var(--surface-3);
  display: grid; place-items: center; color: var(--accent); }
.tl-icon svg { width: 36px; height: 36px; }
.tl-card h2 { margin: 0 0 0.25rem; }
.tl-card p { margin: 0; color: var(--text-muted); font-size: 0.9375rem; }
.tl-go { margin-left: auto; color: var(--text-muted); flex: none; }
@media (min-width: 720px) { .tl-go { display: none; } }
`;

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const TOOLS = [
  {
    href: '#/tools/tuner',
    title: 'Tuner',
    desc: 'Check your piano or voice against A440 using the microphone.',
    icon: svg('<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4-6"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/><path d="M4 20h16"/>'),
  },
  {
    href: '#/tools/metronome',
    title: 'Metronome',
    desc: 'A steady click from 30 to 260 bpm, with tap tempo and subdivisions.',
    icon: svg('<path d="M9 3h6l4 18H5L9 3z"/><path d="M12 15l5-8"/><path d="M7 16h10"/>'),
  },
  {
    href: '#/tools/chords',
    title: 'Chord Finder',
    desc: 'See any chord on the keyboard, or tap keys to name what you play.',
    icon: svg('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M8 5v14M13 5v14M18 5v14"/><path d="M6.5 5v8M11.5 5v8M16.5 5v8" stroke-width="2.6"/>'),
  },
];

const screen: Screen = (root) => {
  const style = document.createElement('style');
  style.textContent = CSS;
  const section = document.createElement('section');
  section.className = 'screen tl-hub';
  section.innerHTML = `
    <p class="eyebrow">Practice tools</p>
    <h1>Tools</h1>
    <p class="muted">Free helpers for every practice session.</p>
    <div class="tl-grid">
      ${TOOLS.map(
        (t) => `
        <a class="card tl-card" href="${t.href}">
          <span class="tl-icon">${t.icon}</span>
          <div>
            <h2>${t.title}</h2>
            <p>${t.desc}</p>
          </div>
          <svg class="tl-go" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
        </a>`,
      ).join('')}
    </div>`;
  root.append(style, section);
  return () => style.remove();
};

export default screen;
