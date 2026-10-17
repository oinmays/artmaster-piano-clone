/**
 * Public-domain pieces, transcribed by hand for Keys. Ordered from easiest to hardest.
 *
 * Every song is written once as a right-hand melody plus a chord chart:
 *   easy   = the melody (optionally with a simplified rhythm), right hand only
 *   medium = melody + left-hand roots on each chord change (C3–B3)
 *   hard   = melody + a left-hand pattern built from the chords (or a hand-written part)
 */
import type { Song } from '../core/types';
import {
  NOTATION_ERRORS,
  PATTERNS,
  accompany,
  combine,
  parse,
  parseHarmony,
  roots,
  simplify,
  type PatternName,
  type SimplifyOptions,
} from './notation';

interface SongDef extends Omit<Song, 'levels'> {
  melody: string;
  /** Chord chart, same length as the melody. */
  harmony: string;
  /** Left-hand pattern for the hard level… */
  pattern?: PatternName;
  /** …or a hand-written left-hand part. */
  hardLeft?: string;
  /** Rhythm simplifications applied to the easy level. */
  easy?: SimplifyOptions;
}

function build(def: SongDef): Song {
  const { melody, harmony, pattern, hardLeft, easy, ...meta } = def;
  const bpb = meta.beatsPerBar;
  const mel = parse(melody, 'R', bpb, `${meta.id} melody`);
  const chords = parseHarmony(harmony, bpb, `${meta.id} harmony`);
  if (Math.abs(mel.end - chords.end) > 1e-6) {
    NOTATION_ERRORS.push(`${meta.id}: melody is ${mel.end} beats but harmony is ${chords.end}`);
  }
  const left = hardLeft
    ? parse(hardLeft, 'L', bpb, `${meta.id} hard left`).notes
    : accompany(chords.spans, PATTERNS[pattern ?? 'pulse']);
  return {
    ...meta,
    levels: {
      easy: easy ? simplify(mel.notes, easy) : mel.notes.map((n) => ({ ...n })),
      medium: combine(mel.notes, roots(chords.spans)),
      hard: combine(mel.notes, left),
    },
  };
}

const DEFS: SongDef[] = [
  {
    id: 'mary-had-a-little-lamb',
    title: 'Mary Had a Little Lamb',
    composer: 'Traditional',
    blurb: 'Nursery rhyme · 1830',
    bpm: 100,
    beatsPerBar: 4,
    key: 'C major',
    tags: ['Beginner', 'Kids', 'Folk'],
    melody: `
      E4 D4 C4 D4 | E4 E4 E4:2 | D4 D4 D4:2 | E4 G4 G4:2 |
      E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:4 |`,
    harmony: 'C:4 | C:4 | G:4 | C:4 | C:4 | C:4 | G:4 | C:4 |',
    pattern: 'pulse',
  },
  {
    id: 'twinkle-twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional (French)',
    blurb: 'Nursery rhyme · 1761',
    bpm: 100,
    beatsPerBar: 4,
    key: 'C major',
    tags: ['Beginner', 'Kids', 'Folk'],
    melody: `
      C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 |
      G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 |
      C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 |`,
    harmony: `
      C:4 | F:2 C:2 | F:2 C:2 | G:2 C:2 |
      C:2 G:2 | C:2 G:2 | C:2 G:2 | C:2 G:2 |
      C:4 | F:2 C:2 | F:2 C:2 | G:2 C:2 |`,
    pattern: 'pulse',
  },
  {
    id: 'frere-jacques',
    title: 'Frère Jacques',
    composer: 'Traditional (French)',
    blurb: 'Round · 18th century',
    bpm: 100,
    beatsPerBar: 4,
    key: 'C major',
    tags: ['Beginner', 'Kids', 'Folk'],
    melody: `
      C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4:2 | E4 F4 G4:2 |
      G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4 C4 | G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4 C4 |
      C4 G3 C4:2 | C4 G3 C4:2 |`,
    harmony: 'C:4 | C:4 | C:4 | C:4 | C:4 | C:4 | C:1 G:1 C:2 | C:1 G:1 C:2 |',
    pattern: 'arp8',
    easy: { mergeEighths: true },
  },
  {
    id: 'london-bridge',
    title: 'London Bridge Is Falling Down',
    composer: 'Traditional (English)',
    blurb: 'Nursery rhyme · 18th century',
    bpm: 104,
    beatsPerBar: 4,
    key: 'C major',
    tags: ['Beginner', 'Kids', 'Folk'],
    melody: `
      G4:1.5 A4:0.5 G4 F4 | E4 F4 G4:2 | D4 E4 F4:2 | E4 F4 G4:2 |
      G4:1.5 A4:0.5 G4 F4 | E4 F4 G4:2 | D4:2 G4:2 | E4 C4:3 |`,
    harmony: 'C:4 | C:4 | G:4 | C:4 | C:4 | C:4 | G:4 | C:4 |',
    pattern: 'pulse',
    easy: { evenDotted: true },
  },
  {
    // 6/8 time: one "beat" here is an eighth note, so bpm is eighths per minute.
    id: 'row-row-row-your-boat',
    title: 'Row, Row, Row Your Boat',
    composer: 'Traditional (tune: E. O. Lyte)',
    blurb: 'Nursery round · 1881',
    bpm: 170,
    beatsPerBar: 6,
    meter: '6/8',
    key: 'C major',
    tags: ['Beginner', 'Kids', 'Folk'],
    melody: `
      C4:3 C4:3 | C4:2 D4 E4:3 | E4:2 D4 E4:2 F4 | G4:6 |
      C5 C5 C5 G4 G4 G4 | E4 E4 E4 C4 C4 C4 | G4:2 F4 E4:2 D4 | C4:6 |`,
    harmony: 'C:6 | C:6 | C:6 | C:6 | C:6 | C:6 | G7:6 | C:6 |',
    pattern: 'waltz',
  },
  {
    // 6/8 time: one "beat" here is an eighth note, so bpm is eighths per minute.
    // Also known as "The Itsy Bitsy Spider".
    id: 'incy-wincy-spider',
    title: 'Incy Wincy Spider',
    composer: 'Traditional',
    blurb: 'Nursery rhyme · c. 1910',
    bpm: 160,
    beatsPerBar: 6,
    meter: '6/8',
    key: 'C major',
    tags: ['Beginner', 'Kids', 'Folk'],
    melody: `
      R:5 G3 |
      C4:2 C4 C4:2 D4 | E4:3 E4:2 E4 | D4:2 C4 D4:2 E4 | C4:3 R:3 |
      E4:3 E4:2 F4 | G4:6 | G4:2 F4 E4:2 F4 | G4:3 E4:3 |
      C4:3 C4:2 D4 | E4:6 | E4:2 D4 C4:2 D4 | E4:3 C4 G3 G3 |
      C4:2 C4 C4:2 D4 | E4:3 E4:2 E4 | D4:2 C4 D4:2 E4 | C4:6 |`,
    harmony: `
      R:6 |
      C:6 | C:6 | C:3 G7:3 | C:6 |
      C:6 | C:6 | G7:6 | C:6 |
      F:6 | C:6 | C:3 G7:3 | C:6 |
      C:6 | C:6 | C:3 G7:3 | C:6 |`,
    pattern: 'waltz',
  },
  {
    id: 'au-clair-de-la-lune',
    title: 'Au Clair de la Lune',
    composer: 'Traditional (French)',
    blurb: 'Folk song · 18th century',
    bpm: 96,
    beatsPerBar: 4,
    key: 'F major',
    tags: ['Beginner', 'Folk'],
    melody: `
      F4 F4 F4 G4 | A4:2 G4:2 | F4 A4 G4 G4 | F4:4 |
      F4 F4 F4 G4 | A4:2 G4:2 | F4 A4 G4 G4 | F4:4 |
      G4 G4 G4 G4 | D4:2 D4:2 | G4 F4 E4 D4 | C4:4 |
      F4 F4 F4 G4 | A4:2 G4:2 | F4 A4 G4 G4 | F4:4 |`,
    harmony: `
      F:4 | F:2 C:2 | F:2 C:2 | F:4 |
      F:4 | F:2 C:2 | F:2 C:2 | F:4 |
      C:4 | Dm:4 | Gm:2 C:2 | C:4 |
      F:4 | F:2 C:2 | F:2 C:2 | F:4 |`,
    pattern: 'pulse',
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven',
    blurb: 'Symphony No. 9 · 1824',
    bpm: 108,
    beatsPerBar: 4,
    key: 'C major',
    tags: ['Beginner', 'Classical'],
    melody: `
      E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2 |
      E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2 |
      D4 D4 E4 C4 | D4 E4:0.5 F4:0.5 E4 C4 | D4 E4:0.5 F4:0.5 E4 D4 | C4 D4 G3:2 |
      E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2 |`,
    harmony: `
      C:4 | G:4 | C:4 | C:2 G:2 |
      C:4 | G:4 | C:4 | G:2 C:2 |
      G:2 C:2 | G:2 C:2 | G:2 C:2 | G:4 |
      C:4 | G:4 | C:4 | G:2 C:2 |`,
    pattern: 'alberti',
    easy: { evenDotted: true },
  },
  {
    id: 'when-the-saints',
    title: 'When the Saints Go Marching In',
    composer: 'Traditional (American)',
    blurb: 'Spiritual · early 1900s',
    bpm: 112,
    beatsPerBar: 4,
    key: 'C major',
    tags: ['Beginner', 'Folk', 'Jazz'],
    melody: `
      R C4 E4 F4 | G4:4 | R C4 E4 F4 | G4:4 |
      R C4 E4 F4 | G4:2 E4:2 | C4:2 E4:2 | D4:4 |
      R E4 E4 D4 | C4:3 C4 | E4:2 G4:2 | G4 F4:3 |
      R C4 E4 F4 | G4:2 E4:2 | C4:2 D4:2 | C4:4 |`,
    harmony: `
      C:4 | C:4 | C:4 | C:4 |
      C:4 | C:4 | C:4 | G7:4 |
      C:2 G7:2 | C:4 | C7:4 | F:4 |
      C:4 | C:4 | C:2 G7:2 | C:4 |`,
    pattern: 'pulse',
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells',
    composer: 'James Lord Pierpont',
    blurb: 'Chorus · 1857',
    bpm: 120,
    beatsPerBar: 4,
    key: 'C major',
    tags: ['Beginner', 'Holiday'],
    melody: `
      E4 E4 E4:2 | E4 E4 E4:2 | E4 G4 C4:1.5 D4:0.5 | E4:4 |
      F4 F4 F4:1.5 F4:0.5 | F4 E4 E4 E4:0.5 E4:0.5 | E4 D4 D4 E4 | D4:2 G4:2 |
      E4 E4 E4:2 | E4 E4 E4:2 | E4 G4 C4:1.5 D4:0.5 | E4:4 |
      F4 F4 F4:1.5 F4:0.5 | F4 E4 E4 E4:0.5 E4:0.5 | G4 G4 F4 D4 | C4:4 |`,
    harmony: `
      C:4 | C:4 | C:4 | C:4 |
      F:4 | C:4 | D7:4 | G:4 |
      C:4 | C:4 | C:4 | C:4 |
      F:4 | C:4 | G7:4 | C:4 |`,
    pattern: 'pulse',
    easy: { evenDotted: true, mergeEighths: true },
  },
  {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    composer: 'Traditional (tune "New Britain")',
    blurb: 'Hymn · 1835',
    bpm: 80,
    beatsPerBar: 3,
    key: 'G major',
    tags: ['Folk', 'Hymn'],
    melody: `
      R:2 D4 |
      G4:2 B4:0.5 G4:0.5 | B4:2 A4 | G4:2 E4 | D4:2 D4 |
      G4:2 B4:0.5 G4:0.5 | B4:2 A4 | D5:5 B4 |
      D5:2 B4:0.5 G4:0.5 | B4:2 A4 | G4:2 E4 | D4:2 D4 |
      G4:2 B4:0.5 G4:0.5 | B4:2 A4 | G4:3 |`,
    harmony: `
      R:3 |
      G:3 | G:3 | C:3 | G:3 |
      G:3 | G:3 | D:3 | D:3 |
      G:3 | G:3 | C:3 | G:3 |
      G:3 | G:2 D:1 | G:3 |`,
    pattern: 'waltz',
    easy: { mergeEighths: true },
  },
  {
    id: 'canon-in-d',
    title: 'Canon in D (theme)',
    composer: 'Johann Pachelbel',
    blurb: 'Baroque · c. 1680',
    bpm: 72,
    beatsPerBar: 4,
    key: 'D major',
    tags: ['Classical', 'Wedding'],
    melody: `
      F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 |
      D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2 |
      D4 F#4 A4 G4 | F#4 D4 F#4 E4 | D4 B3 D4 A4 | G4 B4 A4 G4 |
      F#4:4 |`,
    harmony: `
      D:2 A:2 | Bm:2 F#m:2 | G:2 D:2 | G:2 A:2 |
      D:2 A:2 | Bm:2 F#m:2 | G:2 D:2 | G:2 A:2 |
      D:2 A:2 | Bm:2 F#m:2 | G:2 D:2 | G:2 A:2 |
      D:4 |`,
    pattern: 'arp8',
  },
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional (English)',
    blurb: 'Tudor ballad · 1580',
    bpm: 96,
    beatsPerBar: 3,
    key: 'A minor',
    tags: ['Folk', 'Holiday'],
    melody: `
      R:2 A4 |
      C5:2 D5 | E5:1.5 F5:0.5 E5 | D5:2 B4 | G4:1.5 A4:0.5 B4 |
      C5:2 A4 | A4:1.5 G#4:0.5 A4 | B4:2 G#4 | E4:2 A4 |
      C5:2 D5 | E5:1.5 F5:0.5 E5 | D5:2 B4 | G4:1.5 A4:0.5 B4 |
      C5:1.5 B4:0.5 A4 | G#4:1.5 F#4:0.5 G#4 | A4:6 |
      G5:3 | G5:1.5 F#5:0.5 E5 | D5:2 B4 | G4:1.5 A4:0.5 B4 |
      C5:2 A4 | A4:1.5 G#4:0.5 A4 | B4:2 G#4 | E4:3 |
      G5:3 | G5:1.5 F#5:0.5 E5 | D5:2 B4 | G4:1.5 A4:0.5 B4 |
      C5:1.5 B4:0.5 A4 | G#4:1.5 F#4:0.5 G#4 | A4:6 |`,
    harmony: `
      R:3 |
      Am:3 | C:3 | G:3 | Em:3 |
      Am:3 | E:3 | E:3 | E:3 |
      Am:3 | C:3 | G:3 | Em:3 |
      Am:3 | E:3 | Am:3 | Am:3 |
      C:3 | G:3 | G:3 | Em:3 |
      Am:3 | E:3 | E:3 | E:3 |
      C:3 | G:3 | G:3 | Em:3 |
      Am:3 | E:3 | Am:3 | Am:3 |`,
    pattern: 'waltzArp',
    easy: { evenDotted: true },
  },
  {
    id: 'minuet-in-g',
    title: 'Minuet in G',
    composer: 'Christian Petzold',
    blurb: 'Notebook for Anna Magdalena Bach · 1725',
    bpm: 104,
    beatsPerBar: 3,
    key: 'G major',
    tags: ['Classical', 'Baroque'],
    melody: `
      D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5 G4 G4 | E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5 G4 G4 |
      C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | A4:3 |
      D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5 G4 G4 | E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5 G4 G4 |
      C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | A4 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 | G4:3 |`,
    harmony: `
      G:3 | G:3 | C:3 | G:3 |
      Am:3 | G:3 | D:3 | D:3 |
      G:3 | G:3 | C:3 | G:3 |
      Am:3 | G:3 | D:3 | G:3 |`,
    pattern: 'waltz',
    easy: { mergeEighths: true },
  },
  {
    // 3/8 time: one "beat" here is an eighth note, so bpm is eighths per minute.
    id: 'fur-elise',
    title: 'Für Elise (opening)',
    composer: 'Ludwig van Beethoven',
    blurb: 'Bagatelle in A minor · 1810',
    bpm: 132,
    beatsPerBar: 3,
    meter: '3/8',
    key: 'A minor',
    tags: ['Classical', 'Romantic'],
    melody: `
      R:2 E5:0.5 D#5:0.5 |
      E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | A4 R:0.5 C4:0.5 E4:0.5 A4:0.5 |
      B4 R:0.5 E4:0.5 G#4:0.5 B4:0.5 | C5 R:0.5 E4:0.5 E5:0.5 D#5:0.5 |
      E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | A4 R:0.5 C4:0.5 E4:0.5 A4:0.5 |
      B4 R:0.5 E4:0.5 C5:0.5 B4:0.5 | A4:3 |`,
    harmony: `
      R:3 |
      R:3 | Am:3 |
      E:3 | Am:3 |
      R:3 | Am:3 |
      E:3 | Am:3 |`,
    hardLeft: `
      R:3 |
      R:3 | A2:0.5 E3:0.5 A3:0.5 R:1.5 |
      E2:0.5 E3:0.5 G#3:0.5 R:1.5 | A2:0.5 E3:0.5 A3:0.5 R:1.5 |
      R:3 | A2:0.5 E3:0.5 A3:0.5 R:1.5 |
      E2:0.5 E3:0.5 G#3:0.5 R:1.5 | A2:0.5 E3:0.5 A3:2 |`,
  },
];

export const CATALOG: Song[] = DEFS.map(build);
