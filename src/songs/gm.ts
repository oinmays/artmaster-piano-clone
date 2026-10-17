/**
 * General MIDI instrument names and families (T26). Programs are 0-based, 0 = Acoustic Grand Piano,
 * as stored in a program change event (GM charts number them 1–128).
 */
export type GmFamily =
  | 'piano' | 'chromatic' | 'organ' | 'guitar' | 'bass' | 'strings' | 'ensemble' | 'brass'
  | 'reed' | 'pipe' | 'synth lead' | 'synth pad' | 'synth effects' | 'ethnic' | 'percussive' | 'sound effects';

/** The 16 families of 8 programs each, in program order. */
const FAMILIES: GmFamily[] = [
  'piano', 'chromatic', 'organ', 'guitar', 'bass', 'strings', 'ensemble', 'brass',
  'reed', 'pipe', 'synth lead', 'synth pad', 'synth effects', 'ethnic', 'percussive', 'sound effects',
];

const NAMES = [
  // Piano
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  // Chromatic percussion
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  // Organ
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  // Guitar
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
  'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  // Bass
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  // Strings
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  // Ensemble
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Choir', 'Orchestra Hit',
  // Brass
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  // Reed
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  // Pipe
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  // Synth lead
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  // Synth pad
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  // Synth effects
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  // Ethnic
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  // Percussive
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  // Sound effects
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

/**
 * Short part names for track labels ("Piano", "Bass", "Strings"…). A family-wide name where the
 * family sounds alike to a learner, the instrument itself where it doesn't (a cello is not a harp).
 */
const SHORT: string[] = [
  'Piano', 'Piano', 'Piano', 'Piano', 'Electric Piano', 'Electric Piano', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Bells', 'Dulcimer',
  'Organ', 'Organ', 'Organ', 'Organ', 'Organ', 'Accordion', 'Harmonica', 'Accordion',
  ...Array<string>(8).fill('Guitar'),
  ...Array<string>(8).fill('Bass'),
  'Violin', 'Viola', 'Cello', 'Double Bass', 'Strings', 'Strings', 'Harp', 'Timpani',
  'Strings', 'Strings', 'Strings', 'Strings', 'Choir', 'Choir', 'Choir', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Trumpet', 'French Horn', 'Brass', 'Brass', 'Brass',
  'Sax', 'Sax', 'Sax', 'Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  ...Array<string>(8).fill('Synth Lead'),
  ...Array<string>(8).fill('Synth Pad'),
  ...Array<string>(8).fill('Synth FX'),
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  ...Array<string>(8).fill('Percussion'),
  ...Array<string>(8).fill('Sound Effects'),
];

const valid = (p: number) => Number.isInteger(p) && p >= 0 && p <= 127;

/** "Acoustic Grand Piano" for 0; "Unknown instrument" outside 0–127. */
export function gmName(program: number): string {
  return valid(program) ? NAMES[program] : 'Unknown instrument';
}

/** 'piano' for 0–7, 'bass' for 32–39, 'strings' for 40–47 … (out-of-range programs are clamped). */
export function gmFamily(program: number): GmFamily {
  const p = Math.max(0, Math.min(127, Math.floor(program) || 0));
  return FAMILIES[p >> 3];
}

/** Short name for a part label: "Piano", "Electric Piano", "Bass", "Strings"…; "Part" outside 0–127. */
export function gmShortName(program: number): string {
  return valid(program) ? SHORT[program] : 'Part';
}

/**
 * Pianos, electric pianos, harpsichord/clavinet, organs: parts a pianist would play.
 * That is programs 0–7 (the whole piano family) and 16–20 (drawbar, percussive, rock, church and
 * reed organs). Accordion, harmonica and tango accordion (21–23) sit in the GM organ family but are
 * squeeze-box and mouth parts, usually a melody line rather than a keyboard part, so they don't count.
 * Chromatic percussion (celesta, vibes…) doesn't count either.
 */
export function isKeys(program: number): boolean {
  return valid(program) && (program <= 7 || (program >= 16 && program <= 20));
}
