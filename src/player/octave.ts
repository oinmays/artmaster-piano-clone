/** "Accept any octave": helpers for matching a played note to an expected one by letter name. */

/** Expected notes plus the same notes one and two octaves either side (piano range only). */
export function expandOctaves(expected: readonly number[], out: number[] = []): number[] {
  out.length = 0;
  for (const m of expected) {
    for (const d of [0, -12, 12, -24, 24]) {
      const v = m + d;
      if (v >= 21 && v <= 108 && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** The expected note a played note stands for: itself if expected, else one with the same letter, else itself. */
export function octaveMatch(played: number, expected: readonly number[]): number {
  if (expected.includes(played)) return played;
  return expected.find((m) => (m - played) % 12 === 0) ?? played;
}
