import { describe, expect, it, vi } from 'vitest';

// ui.ts injects its shared CSS at import time; give it a do-nothing document (tests run in node).
vi.hoisted(() => {
  const g = globalThis as { document?: unknown };
  g.document ??= { getElementById: () => ({}), createElement: () => ({}), head: { appendChild: () => {} } };
});

import type { NoteEvent } from '../src/core/types';
import type { MySong } from '../src/songs/mine';
import { difficultyOf, groupByArtist, myGroupsHtml, mySongCardHtml } from '../src/songs/mycards';

const notes = (count: number, every: number, opts: { chord?: number; hand?: 'L' | 'R'; base?: number } = {}): NoteEvent[] =>
  Array.from({ length: count }, (_, i) =>
    Array.from({ length: opts.chord ?? 1 }, (_, c) => ({ midi: (opts.base ?? 60) + c * 4 + (i % 5), start: i * every, dur: every, hand: opts.hand ?? 'R' })),
  ).flat();

function song(over: Partial<MySong> = {}): MySong {
  const hard = over.levels?.hard ?? notes(16, 1);
  return {
    id: 'my-1',
    title: 'Song',
    composer: 'Unknown artist',
    blurb: '',
    bpm: 60,
    beatsPerBar: 4,
    key: 'C major',
    tags: [],
    artist: '',
    source: 'midi',
    durationSec: 192,
    hash: '',
    fileName: 'x.mid',
    addedAt: 0,
    multiTrack: false,
    ...over,
    levels: { easy: hard, medium: hard, hard },
  };
}

describe('groupByArtist', () => {
  it('sorts artists case-insensitively ignoring "The", unknown last, titles inside', () => {
    const list = [
      song({ id: 'a', artist: '', title: 'Zed' }),
      song({ id: 'b', artist: 'The Weeknd', title: 'Starboy' }),
      song({ id: 'c', artist: 'adele', title: 'Skyfall' }),
      song({ id: 'd', artist: 'Adele', title: 'Hello' }),
      song({ id: 'e', artist: 'The Beatles', title: 'Yesterday' }),
      song({ id: 'f', artist: 'Coldplay', title: 'clocks' }),
      song({ id: 'g', artist: '', title: 'Alpha' }),
      song({ id: 'h', artist: 'Coldplay', title: 'Adventure of a Lifetime' }),
    ];
    const groups = groupByArtist(list);
    expect(groups.map((g) => g.artist)).toEqual(['adele', 'The Beatles', 'Coldplay', 'The Weeknd', '']);
    expect(groups.map((g) => g.songs.map((s) => s.id))).toEqual([['d', 'c'], ['e'], ['h', 'f'], ['b'], ['g', 'a']]);
  });
  it('is empty for no songs', () => {
    expect(groupByArtist([])).toEqual([]);
  });
});

describe('difficultyOf', () => {
  it('rates a slow single-note melody Beginner', () => {
    expect(difficultyOf(song({ bpm: 60, levels: { hard: notes(30, 1) } as MySong['levels'] }))).toBe('Beginner');
  });
  it('rates a melody with a simple bass Intermediate', () => {
    const hard = [...notes(40, 0.5), ...notes(10, 2, { hand: 'L', base: 40 })];
    expect(difficultyOf(song({ bpm: 90, levels: { hard } as MySong['levels'] }))).toBe('Intermediate');
  });
  it('rates fast chord-heavy music Advanced', () => {
    const hard = [...notes(64, 0.25, { chord: 3 }), ...notes(32, 0.5, { hand: 'L', chord: 2, base: 30 })];
    expect(difficultyOf(song({ bpm: 120, levels: { hard } as MySong['levels'] }))).toBe('Advanced');
  });
  it('rates an empty song Beginner', () => {
    expect(difficultyOf(song({ levels: { hard: [] } as unknown as MySong['levels'] }))).toBe('Beginner');
  });
});

describe('mySongCardHtml', () => {
  const tricky = song({ id: 'my-x"1', title: 'Rock & <Roll> "Live"', artist: 'AC/DC <script>' });

  it('renders the library card shell with source, length, hands and difficulty', () => {
    const html = mySongCardHtml(song({ artist: 'Adele', title: 'Hello', durationSec: 192, levels: { hard: [...notes(8, 1), ...notes(2, 4, { hand: 'L' })] } as MySong['levels'] }));
    expect(html).toContain('class="card k-card my-card" href="#/song/my-1"');
    expect(html).toContain('<span class="eyebrow">MIDI</span>');
    expect(html).toContain('<h3>Hello</h3>');
    expect(html).toContain('<span class="k-card-composer">Adele</span>');
    expect(html).toContain('3:12 · Both hands · Beginner');
    expect(html).toContain('k-card-levels');
    expect(mySongCardHtml(song({ source: 'audio' }))).toContain('From audio');
    expect(mySongCardHtml(song())).toContain('Right hand');
    expect(mySongCardHtml(song())).toContain('Unknown artist');
  });

  it('escapes titles, artists and ids', () => {
    for (const mode of ['view', 'edit', 'confirm'] as const) {
      const html = mySongCardHtml(tricky, mode);
      expect(html).not.toContain('<Roll>');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('"Live"');
      expect(html).toContain('Rock &#38; &#60;Roll&#62; &#34;Live&#34;');
    }
    expect(mySongCardHtml(tricky)).toContain('href="#/song/my-x%221"');
  });

  it('view mode has rename and delete hooks, and Tracks only for multi-track MIDI', () => {
    const html = mySongCardHtml(song());
    expect(html).toContain('data-edit="my-1"');
    expect(html).toContain('data-delete="my-1"');
    expect(html).not.toContain('#/tracks/');
    expect(mySongCardHtml(song({ multiTrack: true }))).toContain('<a class="btn btn--ghost" href="#/tracks/my-1"');
    expect(mySongCardHtml(song({ multiTrack: true, source: 'audio' }))).not.toContain('#/tracks/');
  });

  it('edit mode has a rename form with artist and title inputs', () => {
    const html = mySongCardHtml(song({ artist: 'Adele', title: 'Hello' }), 'edit');
    expect(html).toContain('data-rename="my-1"');
    expect(html).toMatch(/<input name="artist" value="Adele" placeholder="Artist"/);
    expect(html).toMatch(/<input name="title" value="Hello"/);
    expect(html).toContain('type="submit"');
    expect(html).toContain('data-cancel');
    expect(html).not.toContain('data-edit=');
  });

  it('confirm mode asks before deleting', () => {
    const html = mySongCardHtml(song({ title: 'Hello' }), 'confirm');
    expect(html).toContain('Delete “Hello”?');
    expect(html).toContain('data-delete-yes="my-1"');
    expect(html).toContain('data-cancel');
  });

  it('keeps actions outside the card link', () => {
    const html = mySongCardHtml(song({ multiTrack: true }));
    const link = html.slice(html.indexOf('<a class="card'), html.indexOf('</a>'));
    expect(link).not.toContain('<button');
  });
});

describe('myGroupsHtml', () => {
  it('renders a section per artist with a heading and a grid, using modeFor', () => {
    const html = myGroupsHtml(
      [song({ id: 'my-a', artist: 'Adele', title: 'Hello' }), song({ id: 'my-b', artist: '', title: 'Mystery' }), song({ id: 'my-c', artist: 'Adele', title: 'Skyfall' })],
      (id) => (id === 'my-c' ? 'edit' : 'view'),
    );
    expect(html.match(/<section class="my-group"/g)).toHaveLength(2);
    expect(html.indexOf('Adele')).toBeLessThan(html.indexOf('Unknown artist'));
    expect(html).toContain('2 songs');
    expect(html).toContain('class="grid"');
    expect(html).toContain('data-rename="my-c"');
    expect(html).toContain('data-edit="my-a"');
  });
  it('is empty for no songs', () => {
    expect(myGroupsHtml([], () => 'view')).toBe('');
  });
});
