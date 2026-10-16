/** Play-route helpers and post-session coaching. Pure, no DOM. */
import type { HandsMode, Level, PlayOptions, PlayResult } from '../core/types';
import type { BarStat } from './scoring';
import { findTrickyRange } from './scoring';

const truthy = (v: string | undefined) => v != null && /^(1|true|on|yes)$/i.test(v);

/** Lenient parse of `#/play/:id?level&hands&tempo&wait&loopFrom&loopTo`. */
export function parsePlayParams(p: Record<string, string>): PlayOptions {
  const level: Level = p.level === 'medium' || p.level === 'hard' ? p.level : 'easy';
  const h = (p.hands ?? '').toLowerCase();
  const hands: HandsMode = h === 'l' || h === 'left' ? 'L' : h === 'r' || h === 'right' ? 'R' : 'both';
  const tempo = Math.max(25, Math.min(150, Math.round(Number(p.tempo) || 100)));
  const from = Number(p.loopFrom);
  const to = Number(p.loopTo);
  const loop = Number.isFinite(from) && Number.isFinite(to) && from >= 1 && to >= from;
  return {
    songId: p.id ?? '',
    level,
    hands,
    tempo,
    wait: truthy(p.wait),
    loopFrom: loop ? Math.round(from) : undefined,
    loopTo: loop ? Math.round(to) : undefined,
  };
}

/** Build the hash path (without '#') for a play session. */
export function playPath(o: PlayOptions): string {
  const q = new URLSearchParams({
    level: o.level,
    hands: o.hands,
    tempo: String(o.tempo),
    wait: o.wait ? '1' : '0',
  });
  if (o.loopFrom != null && o.loopTo != null) {
    q.set('loopFrom', String(o.loopFrom));
    q.set('loopTo', String(o.loopTo));
  }
  return `/play/${encodeURIComponent(o.songId)}?${q.toString()}`;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const slower = (tempo: number) => Math.max(25, Math.round((tempo * 0.8) / 5) * 5);

/** One or two sentences of coaching generated from the numbers. */
export function coachingLine(r: PlayResult, bars: BarStat[] = []): string {
  if (r.notesTotal === 0) return 'Play a few notes and I can tell you how it went.';
  const offBeat = r.early + r.late;
  const tricky = findTrickyRange(bars, 2);
  const where = tricky ? (tricky.from === tricky.to ? `bar ${tricky.from}` : `bars ${tricky.from}–${tricky.to}`) : '';

  if (r.stars === 3) {
    if (r.wait) return 'Every note in place. Now turn Wait Mode off and play it in time.';
    if (r.tempo < 100) return `Excellent. You're ready to nudge the tempo up to ${Math.min(150, r.tempo + 10)}%.`;
    if (r.hands !== 'both') return 'Excellent. Time to put both hands together.';
    return 'Excellent playing. Try the next level when you are ready.';
  }
  if (r.accuracy < 50) {
    return r.wait
      ? `Take it slowly: try ${slower(r.tempo)}% tempo and one hand at a time.`
      : `Lots of notes slipped by. Turn on Wait Mode so the music waits for you, and try ${slower(r.tempo)}% tempo.`;
  }
  if (r.wrong > r.notesTotal * 0.3) {
    return `Quite a few extra notes (${r.wrong}). Watch the highlighted keys and play only those.`;
  }
  if (!r.wait && offBeat >= Math.max(3, r.notesHit * 0.3)) {
    const e = pct(r.early, offBeat);
    if (e >= 60) return `You're rushing: ${e}% of your off-beat notes were early. Try ${slower(r.tempo)}% tempo and listen to the click.`;
    if (e <= 40) return `You're dragging: ${100 - e}% of your off-beat notes were late. Look ahead to the next note before it lands.`;
    return `Your notes are right but the timing wobbles. Try ${slower(r.tempo)}% tempo.`;
  }
  if (where) return `Nice work. ${where[0].toUpperCase()}${where.slice(1)} gave you the most trouble: loop it a few times.`;
  return 'Solid run. Play it once more to lock it in.';
}
