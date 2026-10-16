import { describe, expect, it } from 'vitest';
import type { NoteEvent, PlayOptions, Song } from '../src/core/types';
import { Engine } from '../src/player/engine';
import {
  Scorer,
  computeStars,
  findTrickyRange,
  scorePerformance,
  timingWindows,
  type PerformanceInput,
} from '../src/player/scoring';

// 120 bpm at 100% -> 500 ms per beat. 4/4.
const BPM = 120;
const MS = 500;

/** Eight right-hand quarter notes (C D E F G A B C) over two bars, plus a left-hand note. */
const melody: NoteEvent[] = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({ midi, start: i, dur: 1, hand: 'R' }));
const withLeft: NoteEvent[] = [...melody, { midi: 48, start: 0, dur: 4, hand: 'L' }];

const base = (over: Partial<PerformanceInput>): PerformanceInput => ({
  notes: melody,
  hands: 'R',
  bpm: BPM,
  beatsPerBar: 4,
  tempo: 100,
  wait: false,
  played: [],
  ...over,
});

const exact = (notes: NoteEvent[], offsetMs = 0, msPerBeat = MS) =>
  notes.map((n) => ({ midi: n.midi, time: n.start * msPerBeat + offsetMs }));

describe('scorePerformance', () => {
  it('perfect run is 100% and 3 stars', () => {
    const r = scorePerformance(base({ played: exact(melody) }));
    expect(r.notesTotal).toBe(8);
    expect(r.notesHit).toBe(8);
    expect(r.perfect).toBe(8);
    expect(r.accuracy).toBe(100);
    expect(r.timing).toBe(100);
    expect(r.stars).toBe(3);
    expect(r.missed).toBe(0);
    expect(r.wrong).toBe(0);
  });

  it('filters by hand: left-hand notes are not scored when practising the right hand', () => {
    const r = scorePerformance(base({ notes: withLeft, hands: 'R', played: exact(melody) }));
    expect(r.notesTotal).toBe(8);
    const both = scorePerformance(base({ notes: withLeft, hands: 'both', played: exact(melody) }));
    expect(both.notesTotal).toBe(9);
    expect(both.missed).toBe(1);
  });

  it('all notes 150 ms early are hits with low timing', () => {
    const r = scorePerformance(base({ played: exact(melody, -150) }));
    expect(r.notesHit).toBe(8);
    expect(r.accuracy).toBe(100);
    expect(r.early).toBe(8);
    expect(r.perfect).toBe(0);
    expect(r.timing).toBe(50);
    expect(r.stars).toBe(2);
  });

  it('late notes are counted as late', () => {
    const r = scorePerformance(base({ played: exact(melody, 120) }));
    expect(r.late).toBe(8);
    expect(r.timing).toBe(50);
  });

  it('a note far outside the window is wrong and its target is missed', () => {
    const played = exact(melody);
    played[3] = { midi: 65, time: 3 * MS + 400 }; // 400 ms late
    const r = scorePerformance(base({ played }));
    expect(r.notesHit).toBe(7);
    expect(r.missed).toBe(1);
    expect(r.wrong).toBe(1);
  });

  it('missing notes lower accuracy and stars', () => {
    const played = exact(melody).filter((_, i) => i % 2 === 0); // half the notes
    const r = scorePerformance(base({ played }));
    expect(r.notesHit).toBe(4);
    expect(r.missed).toBe(4);
    expect(r.accuracy).toBe(50);
    expect(r.stars).toBe(1);
  });

  it('wrong notes are counted separately and do not change notesTotal', () => {
    const played = [...exact(melody), { midi: 61, time: 0 }, { midi: 63, time: MS }];
    const r = scorePerformance(base({ played }));
    expect(r.notesTotal).toBe(8);
    expect(r.notesHit).toBe(8);
    expect(r.wrong).toBe(2);
    expect(r.accuracy).toBe(100);
  });

  it('mashing every key caps the stars', () => {
    const played = exact(melody);
    for (let t = 0; t < 8 * MS; t += 50) played.push({ midi: 40 + (t % 7), time: t });
    const r = scorePerformance(base({ played }));
    expect(r.accuracy).toBe(100);
    expect(r.wrong).toBeGreaterThan(8);
    expect(r.stars).toBe(1);
  });

  it('chords: each chord note is matched independently', () => {
    const chord: NoteEvent[] = [
      { midi: 60, start: 0, dur: 2, hand: 'R' },
      { midi: 64, start: 0, dur: 2, hand: 'R' },
      { midi: 67, start: 0, dur: 2, hand: 'R' },
      { midi: 62, start: 2, dur: 2, hand: 'R' },
      { midi: 65, start: 2, dur: 2, hand: 'R' },
    ];
    const played = [
      { midi: 64, time: 10 },
      { midi: 60, time: -30 },
      { midi: 67, time: 150 }, // late
      { midi: 62, time: 2 * MS },
      // 65 never played
    ];
    const r = scorePerformance(base({ notes: chord, played }));
    expect(r.notesTotal).toBe(5);
    expect(r.notesHit).toBe(4);
    expect(r.perfect).toBe(3);
    expect(r.late).toBe(1);
    expect(r.missed).toBe(1);
    expect(r.wrong).toBe(0);
  });

  it('a repeated pitch in a chord is not double counted', () => {
    const notes: NoteEvent[] = [
      { midi: 60, start: 0, dur: 1, hand: 'R' },
      { midi: 60, start: 1, dur: 1, hand: 'R' },
    ];
    const r = scorePerformance(base({ notes, played: [{ midi: 60, time: 0 }, { midi: 60, time: 5 }] }));
    expect(r.notesHit).toBe(1);
    expect(r.wrong).toBe(1);
    expect(r.missed).toBe(1);
  });

  it('notes not reached before endTime are excluded', () => {
    const r = scorePerformance(base({ played: exact(melody.slice(0, 4)), endTime: 3.5 * MS }));
    expect(r.notesTotal).toBe(4);
    expect(r.accuracy).toBe(100);
  });

  it('scales windows with tempo', () => {
    const slow = timingWindows(50);
    const normal = timingWindows(100);
    const fast = timingWindows(150);
    expect(normal).toEqual({ perfect: 80, ok: 200 });
    expect(slow.ok).toBeGreaterThan(normal.ok);
    expect(fast.ok).toBeLessThan(normal.ok);
    // 250 ms late is a miss at 100% but a hit at 50% tempo (1000 ms per beat).
    const at100 = scorePerformance(base({ played: exact(melody, 250) }));
    expect(at100.notesHit).toBe(0);
    const at50 = scorePerformance(base({ tempo: 50, played: exact(melody, 250, 1000) }));
    expect(at50.notesHit).toBe(8);
  });

  it('reports per-bar accuracy and the tricky range', () => {
    const played = exact(melody).filter((_, i) => i < 4 || i === 7); // bar 2 mostly missed
    const r = scorePerformance(base({ played }));
    expect(r.bars.map((b) => b.bar)).toEqual([1, 2]);
    expect(r.bars[0].accuracy).toBe(100);
    expect(r.bars[1].accuracy).toBe(25);
    expect(findTrickyRange(r.bars, 1)).toEqual({ from: 2, to: 2, accuracy: 25 });
  });
});

describe('wait mode', () => {
  it('ignores timing: very late notes are still hits and timing is 100', () => {
    // The clock freezes in wait mode, so a "late" note still arrives at the group's beat.
    // Here we play every note seconds late in real time.
    const played = melody.map((n, i) => ({ midi: n.midi, time: n.start * MS + 3000 + i * 10 }));
    const r = scorePerformance(base({ wait: true, played }));
    expect(r.notesHit).toBe(8);
    expect(r.accuracy).toBe(100);
    expect(r.timing).toBe(100);
    expect(r.wait).toBe(true);
    expect(r.stars).toBe(3);
  });

  it('still counts wrong notes and never marks misses while waiting', () => {
    const scorer = new Scorer({ tempo: 100, wait: true });
    scorer.add(melody.map((n) => ({ midi: n.midi, beat: n.start, dur: n.dur, hand: n.hand, bar: 1 })));
    const spb = 0.5;
    expect(scorer.advance(5, spb)).toBe(0); // waiting never misses
    expect(scorer.play(61, 0, spb).kind).toBe('wrong');
    expect(scorer.play(60, 0, spb).kind).toBe('hit');
    // Too far ahead of the playhead: not yet due -> wrong.
    expect(scorer.play(72, 0, spb).kind).toBe('wrong');
    const r = scorer.report(0);
    expect(r.notesTotal).toBe(1);
    expect(r.notesHit).toBe(1);
    expect(r.wrong).toBe(2);
    expect(r.timing).toBe(100);
  });

  it('chord group in wait mode needs every note', () => {
    const scorer = new Scorer({ tempo: 100, wait: true });
    scorer.add([
      { midi: 60, beat: 0, dur: 1, hand: 'R', bar: 1 },
      { midi: 64, beat: 0, dur: 1, hand: 'R', bar: 1 },
    ]);
    scorer.play(64, 0, 0.5);
    expect(scorer.firstPending()).toBe(0);
    scorer.play(60, 0, 0.5);
    expect(scorer.firstPending()).toBe(-1);
  });
});

describe('computeStars', () => {
  it('applies thresholds', () => {
    expect(computeStars(95, 80)).toBe(3);
    expect(computeStars(95, 60)).toBe(2);
    expect(computeStars(75, 100)).toBe(2);
    expect(computeStars(50, 0)).toBe(1);
    expect(computeStars(49, 100)).toBe(0);
  });
});

// ---- Engine (transport) — runs headless: audio scheduling is skipped without a window ----

const song: Song = {
  id: 'fixture',
  title: 'Fixture',
  composer: 'Test',
  blurb: '',
  bpm: 120,
  beatsPerBar: 4,
  key: 'C major',
  tags: [],
  levels: { easy: withLeft, medium: withLeft, hard: withLeft },
};
const opts = (o: Partial<PlayOptions> = {}): PlayOptions => ({
  songId: 'fixture',
  level: 'easy',
  hands: 'R',
  tempo: 100,
  wait: false,
  ...o,
});

describe('Engine', () => {
  it('scores only the practised hand and auto-plays the other', () => {
    const e = new Engine(song, opts());
    expect(e.scorer.notes.length).toBe(8);
    expect(e.accomp.map((n) => n.midi)).toEqual([48]);
    const both = new Engine(song, opts({ hands: 'both' }));
    expect(both.scorer.notes.length).toBe(9);
    expect(both.accomp.length).toBe(0);
  });

  it('runs a lead-in, then plays in time to a perfect result', () => {
    const e = new Engine(song, opts());
    expect(e.currentBeat).toBeLessThan(0);
    const t0 = 1000;
    e.start(t0);
    const lead = -e.currentBeat * 500; // ms until beat 0
    for (const n of melody) {
      const t = t0 + lead + n.start * 500;
      e.tick(t);
      e.input(n.midi, t);
    }
    e.tick(t0 + lead + 12 * 500);
    expect(e.state).toBe('finished');
    const r = e.result();
    expect(r.accuracy).toBe(100);
    expect(r.stars).toBe(3);
  });

  it('wait mode freezes on the next note until it is played', () => {
    const e = new Engine(song, opts({ wait: true }));
    const t0 = 0;
    e.start(t0);
    const lead = -e.currentBeat * 500;
    e.tick(t0 + lead + 5000); // way past the first note
    expect(e.waiting).toBe(true);
    expect(e.currentBeat).toBe(0);
    expect(e.expectedNow()).toEqual([60]);
    expect(e.input(61, t0 + lead + 5000)?.kind).toBe('wrong');
    expect(e.input(60, t0 + lead + 5100)?.kind).toBe('hit');
    e.tick(t0 + lead + 5200);
    expect(e.waiting).toBe(false);
    e.tick(t0 + lead + 5200 + 2000); // frozen again on the next note (beat 1)
    expect(e.waiting).toBe(true);
    expect(e.currentBeat).toBe(1);
  });

  it('loops a bar range, expanding passes and counting each pass', () => {
    const e = new Engine(song, opts({ loopFrom: 2, loopTo: 2 }));
    expect(e.scorer.notes.map((n) => n.midi).slice(0, 4)).toEqual([67, 69, 71, 72]);
    e.start(0);
    const lead = -e.currentBeat * 500;
    e.tick(lead + 4 * 500 * 2.5); // two and a half passes, nothing played
    expect(e.passIndex).toBe(2);
    expect(e.state).toBe('running');
    e.finish(lead + 4 * 500 * 2.5);
    const r = e.result();
    expect(r.loopFrom).toBe(2);
    expect(r.loopTo).toBe(2);
    expect(r.missed).toBeGreaterThanOrEqual(8);
    expect(r.notesHit).toBe(0);
  });
});
