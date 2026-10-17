/**
 * Artist and title from messy file names, MIDI meta and audio tags (T25).
 *
 * guessFromFileName works in this order:
 *   1. drop the folder and a known extension (.mid/.mp3/.m4a/…);
 *   2. drop downloader prefixes ("y2mate.com - "), bracketed junk ("[ytmp3.cc]", "(Official Video)",
 *      "(Lyrics)", "(1)"), bare junk ("320kbps", "piano tutorial", "easy piano", "with lyrics", "copy", "_final");
 *      meaningful version info in brackets stays ("(Live)", "(Acoustic)", "(Remix)", "(Wish Death)");
 *   3. turn underscores, and hyphens/dots in names without spaces (kebab/dot case), into spaces;
 *   4. drop track numbers ("01 - ", "01. ", "Track 3 - ") but never a leading number that is part of
 *      the name ("50 Cent", "21 Questions");
 *   5. split on " - ", " – ", " — ", " ~ " (or "Title by Artist" / "Artist: Title" when the artist is a
 *      known one). The side that is a known artist is the artist; otherwise "Artist - Title";
 *   6. without a separator, look for a known artist anywhere in the name ("lush life zara larsson");
 *   7. "feat./ft./featuring X" moves to the end of the title as "(feat. X)"; a co-artist list
 *      ("Justin Bieber, benny blanco") keeps the first as the artist and adds "(with benny blanco)";
 *   8. all-lower or ALL-CAPS fields become Title Case (small words lower except first/last);
 *      mixed-case text is kept as typed. Known artists always get their canonical spelling.
 */
import type { MidiFile } from './midifile';

export interface NameGuess {
  /** '' when unknown. */
  artist: string;
  /** Never empty ('My song' as a last resort). */
  title: string;
}
export interface NameMeta {
  title?: string;
  artist?: string;
}

const MAX = 80;

// ---- Known artists --------------------------------------------------------------------

/**
 * Canonical name, then extra aliases. A leading '~' marks a name that is also an ordinary
 * word ("Queen", "Drake"): it only counts as an artist when it is a whole side of a separator
 * or the very start of an undelimited name, never in the middle or at the end.
 */
const ARTISTS: string[][] = [
  ['50 Cent', 'fifty cent'], ['Zara Larsson'], ['Rihanna'], ['Tyler Childers'], ['Justin Bieber', 'bieber'],
  ['Ed Sheeran'], ['Adele'], ['Taylor Swift'], ['Coldplay'], ['Billie Eilish'], ['The Weeknd', 'weeknd'],
  ['Elton John'], ['Billy Joel'], ['~Queen'], ['The Beatles', 'beatles'], ['Lady Gaga'], ['Bruno Mars'],
  ['Lewis Capaldi'], ['Olivia Rodrigo'], ['Harry Styles'], ['Dua Lipa'], ['Sia'], ['John Legend'],
  ['Alicia Keys'], ['Yiruma'], ['Ludovico Einaudi', 'einaudi'], ['Joe Hisaishi', 'hisaishi'],
  ['Hans Zimmer', 'zimmer'], ['Ludwig van Beethoven', 'beethoven', 'l v beethoven'], ['Frédéric Chopin', 'chopin', 'frederic chopin'],
  ['Wolfgang Amadeus Mozart', 'mozart', 'w a mozart'], ['Johann Sebastian Bach', 'bach', 'j s bach'], ['Claude Debussy', 'debussy'],
  ['Erik Satie', 'satie'], ['Eminem'], ['~Drake'], ['Kanye West', 'kanye'], ['Post Malone'], ['Imagine Dragons'],
  ['OneRepublic', 'one republic'], ['Lana Del Rey'], ['Sam Smith'], ['Shawn Mendes'], ['Ariana Grande'],
  ['Beyoncé', 'beyonce'], ['Katy Perry'], ['Miley Cyrus'], ['Michael Jackson'], ['Whitney Houston'], ['Mariah Carey'],
  ['Celine Dion'], ['ABBA'], ['Lorde'], ['Hozier'], ['Radiohead'], ['Linkin Park'], ['Maroon 5'], ['Charlie Puth'],
  ['Sabrina Carpenter'], ['Chappell Roan'], ['SZA'], ['Doja Cat'], ['Kendrick Lamar'], ['Travis Scott'],
  ['Arctic Monkeys'], ['Fleetwood Mac'], ['Pink Floyd'], ['Led Zeppelin'], ['Nirvana'], ['Oasis'],
  ['Green Day'], ['The Killers', 'killers'], ['Gotye'], ['James Arthur'], ['Calum Scott'], ['Tom Odell'],
  ['Christina Perri'], ['Passenger'], ['Avicii'], ['Benson Boone'], ['Noah Kahan'], ['Gracie Abrams'],
  ['Kodaline'], ['Birdy'], ['Rag\'n\'Bone Man', 'rag n bone man'], ['Mumford & Sons', 'mumford and sons'],
  ['Simon & Garfunkel', 'simon and garfunkel'], ['Leonard Cohen'], ['Bob Dylan'], ['David Bowie'],
  ['Stevie Wonder'], ['Frank Sinatra'], ['Norah Jones'], ['Amy Winehouse'], ['Jason Mraz'], ['Vance Joy'],
  ['Pyotr Ilyich Tchaikovsky', 'tchaikovsky'], ['Franz Liszt', 'liszt'], ['Franz Schubert', 'schubert'],
  ['Robert Schumann', 'schumann'], ['Sergei Rachmaninoff', 'rachmaninoff', 'rachmaninov'], ['Maurice Ravel', 'ravel'],
  ['Antonio Vivaldi', 'vivaldi'], ['Johann Pachelbel', 'pachelbel'], ['Scott Joplin', 'joplin'],
  ['George Frideric Handel', 'handel'], ['Edvard Grieg', 'grieg'], ['Max Richter'], ['Ólafur Arnalds', 'olafur arnalds'],
  ['Kevin Kern'], ['Ryuichi Sakamoto', 'sakamoto'], ['Koji Kondo'], ['Toby Fox'], ['Ramin Djawadi'], ['John Williams'],
];

const deaccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Lowercase words only: "Beyoncé" -> "beyonce", "Rag'n'Bone" -> "ragnbone", "&" -> "and". */
const norm = (s: string) =>
  deaccent(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface Known {
  name: string;
  weak: boolean;
  keys: string[];
}
const KNOWN: Known[] = ARTISTS.map(([first, ...aliases]) => {
  const weak = first.startsWith('~');
  const name = weak ? first.slice(1) : first;
  const keys = [norm(name), ...aliases.map(norm)];
  // "The Beatles" also matches "Beatles" and vice versa.
  for (const k of [...keys]) if (k.startsWith('the ')) keys.push(k.slice(4));
  return { name, weak, keys: [...new Set(keys)] };
});
const KNOWN_BY_KEY = new Map<string, Known>();
for (const k of KNOWN) for (const key of k.keys) KNOWN_BY_KEY.set(key, k);

/** The known artist when the whole text is one ("the weeknd", "BEYONCE"). */
function knownWhole(text: string): Known | undefined {
  const n = norm(text);
  return KNOWN_BY_KEY.get(n) ?? (n.startsWith('the ') ? KNOWN_BY_KEY.get(n.slice(4)) : undefined);
}

/**
 * A known artist inside undelimited text, as word positions. Prefers a match at the start, then
 * at the end, then (strong names only) in the middle; longer names win ties.
 */
function knownInside(words: string[]): { known: Known; from: number; to: number } | undefined {
  const keys = words.map(norm);
  let best: { known: Known; from: number; to: number; score: number } | undefined;
  for (let i = 0; i < words.length; i++) {
    for (let j = Math.min(words.length, i + 5); j > i; j--) {
      const key = keys.slice(i, j).join(' ').replace(/\s+/g, ' ').trim();
      const known = KNOWN_BY_KEY.get(key);
      if (!known) continue;
      const atStart = i === 0;
      const atEnd = j === words.length;
      if (known.weak && !atStart) continue;
      if (atStart && atEnd) continue; // the whole name: more likely a title ("Queen.mid")
      const score = (atStart ? 300 : atEnd ? 200 : 100) + (j - i);
      if (!best || score > best.score) best = { known, from: i, to: j, score };
    }
  }
  return best;
}

// ---- Junk -----------------------------------------------------------------------------

const SITES =
  'y2mate|ytmp3|yt2mp3|ytmp3cc|mp3juices|mp3juice|savefrom|savetube|ssyoutube|flvto|onlinevideoconverter|' +
  'converto|mp3skull|tubidy|loader\\.to|musescore|onlinesequencer|bitmidi|freemidi|midiworld|vgmusic|' +
  'mididb|midis101|8notes|cvc\\s?mp3|notube|x2convert|keepvid|clipconverter|snappea|vidmate';
const DOMAIN = /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|cc|io|is|me|to|co|app|ch|nu|biz|info|tv|lol|ws|ru|fm|uk|de|cx|sx|pw|vip|xyz|online|site)\b/i;

/** Phrases removed anywhere (case-insensitive, whole words). Longest first. */
const JUNK_PHRASES = [
  'official music video', 'official lyric video', 'official lyrics video', 'official video', 'official audio',
  'official visualizer', 'official visualiser', 'official hd video', 'music video', 'lyric video',
  'lyrics video', 'video oficial', 'audio oficial', 'with lyrics', 'lyrics on screen',
  'full song', 'full audio', 'hq audio', 'hd audio', 'audio only',
  'piano tutorial', 'piano cover', 'piano version', 'piano arrangement', 'piano sheet music',
  'synthesia piano', 'synthesia', 'sheet music', 'midi file', 'easy piano tutorial',
  'easy piano', 'beginner piano', 'intermediate piano', 'advanced piano', 'very easy', 'super easy',
  'slowed and reverb', 'slowed reverb', 'slowed \\+ reverb', 'sped up', 'nightcore',
  'clean version', 'explicit version', 'free download', 'high quality', 'best quality',
];
const JUNK_RE = new RegExp(
  `(?:^|(?<=[\\s(\\[{]))(?:${JUNK_PHRASES.map((p) => p.replace(/ /g, '[\\s_-]*')).join('|')})(?=$|[\\s)\\]},.!])`,
  'gi',
);
/** Junk that is not a phrase: bitrates, resolutions, years after "remastered", site names, copy numbers. */
const JUNK_TOKENS = [
  /\b\d{2,3}\s?kbps\b/gi,
  /\b(?:128|160|192|256|320)\s?k\b/gi,
  /\b(?:360|480|720|1080|1440|2160)[pi]\b/gi,
  /\b(?:remastered|remaster)\s+(?:19|20)\d\d(?:\s+version)?\b/gi,
  /\b(?:19|20)\d\d\s+(?:remastered|remaster)(?:\s+version)?\b/gi,
  new RegExp(`\\b(?:${SITES})(?:\\.[a-z]{2,4})?\\b`, 'gi'),
];
/** Bracketed content that is only junk (after junk is removed) or a copy number like "(1)". */
const isJunkBracket = (inner: string) => {
  if (DOMAIN.test(inner)) return true;
  const rest = stripJunk(inner, true).replace(/[\s+&,.:;\-_|/]+/g, '');
  return !rest || /^\d{1,2}$/.test(rest) || /^(?:version|ver|edit|piano|easy|hard|beginner|advanced|intermediate)$/i.test(rest);
};

/**
 * Single words that are junk only at the end of a name ("… Lyrics", "… copy", "… HQ"), never in
 * the middle ("New York", "Clean Bandit"). Inside brackets they are junk anywhere.
 */
const TRAIL = '(?:official|lyrics?|letra|audio|visuali[sz]er|tutorial|cover|instrumental|piano|solo|midi|copy|final|clean|explicit|hq|hd|uhd|4k|8k|new|remastered|remaster|slowed|reverb|download|mp3|v\\d+)';
const TRAIL_RE = new RegExp(`(?:^|[\\s_-]+)${TRAIL}[\\s_.-]*$`, 'i');
const TRAIL_ANY = new RegExp(`(?:^|(?<=[\\s(\\[{]))${TRAIL}(?=$|[\\s)\\]},.!])`, 'gi');

/** Remove junk. `inBrackets`: the text is a whole bracket group, so single junk words go anywhere. */
function stripJunk(s: string, inBrackets = false): string {
  let out = s.replace(/^\s*copy of\s+/i, ' ');
  for (const re of JUNK_TOKENS) out = out.replace(re, ' ');
  // Repeat: "piano tutorial easy" leaves "easy" only after "piano tutorial" goes.
  for (let i = 0; i < 3; i++) out = out.replace(JUNK_RE, ' ');
  if (inBrackets) return out.replace(TRAIL_ANY, ' ');
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/[\s\-–—_|~:,;+]+$/, '').replace(TRAIL_RE, '');
    if (next === out || !next.trim()) break;
    out = next;
  }
  return out;
}

// ---- Casing ---------------------------------------------------------------------------

const SMALL = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'to', 'and', 'or', 'for', 'at', 'by', 'with', 'nor', 'but', 'as', 'from', 'vs']);
const ROMAN = /^(?:i{1,3}|iv|vi{0,3}|ix|x)$/i;

/** Title Case for all-lower or ALL-CAPS text; mixed case is left as typed. */
export function fixCase(s: string): string {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (!letters) return s;
  const lower = letters === letters.toLowerCase();
  const upper = letters === letters.toUpperCase();
  if (!lower && !upper) return s;
  const words = s.toLowerCase().split(' ');
  const lastWord = words.length - 1;
  return words
    .map((w, i) => {
      const bare = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (i !== 0 && i !== lastWord && SMALL.has(bare) && !/^[([]/.test(w)) return w;
      if (ROMAN.test(bare) && (upper || bare === 'i')) return w.replace(bare, bare.toUpperCase());
      // Capitalise the first letter, and the first letter after a hyphen ("anti-hero" -> "Anti-Hero").
      return w.replace(/(^|[-(\["/])(\p{L})/gu, (_m, pre: string, c: string) => pre + c.toUpperCase());
    })
    .join(' ');
}

// ---- Helpers --------------------------------------------------------------------------

const EXT = /\.(?:midi?|kar|rmi|mp3|m4a|mp4|aac|wav|wave|aif|aiff|flac|ogg|oga|opus|webm|wma|caf|3gp)$/i;
const tidy = (s: string) =>
  s
    .replace(/[([{]\s*[)\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—_|~:,;.+]+|[\s\-–—_|~:,;+]+$/g, '')
    .trim();
const clip = (s: string) => (s.length > MAX ? s.slice(0, MAX).trim() : s);

/** Remove bracket groups that are junk; pull "(feat. X)" out into `feats`. Keeps meaningful ones like "(Live)". */
function cleanBrackets(s: string, feats: string[]): string {
  let out = s;
  for (let i = 0; i < 3; i++) {
    out = out.replace(/[([{]([^()[\]{}]*)[)\]}]/g, (whole, inner: string) => {
      const feat = /^\s*(?:feat\.?|ft\.?|featuring|with)\s+(.+)$/i.exec(inner);
      if (feat && /^\s*(?:feat|ft|featuring)/i.test(inner)) {
        feats.push(tidy(feat[1]));
        return ' ';
      }
      if (isJunkBracket(inner)) return ' ';
      const kept = tidy(stripJunk(inner));
      // Placeholders that survive a nested pass use \u0001/\u0002 so this loop does not re-match them.
      return kept ? ` \u0001${kept}\u0002 ` : whole.startsWith('(') ? ' ' : ' ';
    });
  }
  // Unbalanced leftovers ("Song (Official" from a cut-off name).
  out = out.replace(/[([{][^()[\]{}\u0001\u0002]*$/, (m) => (isJunkBracket(m.slice(1)) ? ' ' : m));
  return out.replace(/\u0001/g, '(').replace(/\u0002/g, ')');
}

/** "Song ft. X" / "Artist feat. X" (unbracketed): pull the guest out up to the end of this side. */
function pullFeat(side: string, feats: string[]): string {
  return side.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i, (_m, who: string) => {
    feats.push(tidy(who));
    return '';
  });
}

/** Split "A - B" style separators. Hyphens need a space on at least one side; dashes and tildes need none. */
function splitSides(s: string): string[] {
  return s
    .split(/\s+-+\s*|\s*-+\s+|\s*[–—~]\s*|\s+\|\s+/)
    .map(tidy)
    .filter(Boolean);
}

/** "Justin Bieber, benny blanco" -> main "Justin Bieber" + others, when the first is a known artist (or a comma list). */
function splitArtists(side: string): { main: string; others: string[] } {
  const parts = side.split(/\s*,\s*|\s+(?:&|and|x|×|\+|vs\.?)\s+/i).map(tidy).filter(Boolean);
  if (parts.length > 1 && !knownWhole(side) && (knownWhole(parts[0]) || side.includes(','))) {
    return { main: parts[0], others: parts.slice(1) };
  }
  return { main: side, others: [] };
}

const artistName = (s: string) => knownWhole(s)?.name ?? fixCase(s);

/** The core of guessFromFileName without the extension/path step. */
function parse(raw: string): NameGuess {
  const feats: string[] = [];
  let s = raw;

  // Underscores are spaces; "Artist_-_Title" becomes "Artist - Title".
  s = s.replace(/_/g, ' ');
  // Downloader prefix: "y2mate.com - ", "[ytmp3.cc] ".
  s = s.replace(/^\s*(?:www\.)?[a-z0-9-]+\.(?:com|net|org|cc|io|is|me|to|co|app|ch|nu|biz|info|tv|lol|ws|ru|fm)\s*[-–—:|~]+\s*/i, '');
  // Newer downloader suffixes: "-<YouTube id>-192k-1700000000".
  s = s.replace(/[-\s]\d{9,13}\s*$/, '').replace(/[-\s]\d{2,3}k\s*$/i, '');
  s = s.replace(/[-\s]([A-Za-z0-9_-]{11})\s*$/, (m, id: string) =>
    /\d/.test(id) || /[A-Z].*[A-Z]/.test(id.slice(1)) && /[a-z]/.test(id) ? '' : m,
  );
  s = cleanBrackets(s, feats);
  // Dot case "Ed.Sheeran.Perfect" (no spaces, several words).
  if (!/\s/.test(s) && /[\p{L}\d]{2,}\.[\p{L}\d]{2,}/u.test(s)) s = s.replace(/\./g, ' ');
  // Kebab case "lush-life-zara-larsson" (no spaces, two or more hyphens).
  let kebab = false;
  // "adele-hello": one unspaced hyphen splits only when a side is a known artist.
  const halves = /^([^\s-]+)-([^\s-]+)$/.exec(s.trim());
  if (halves && (knownWhole(halves[1]) || knownWhole(halves[2]))) s = `${halves[1]} - ${halves[2]}`;
  else if (!/\s/.test(s.trim()) && (s.match(/-/g) ?? []).length >= 2) {
    s = s.replace(/-+/g, ' ');
    kebab = true;
  }
  s = stripJunk(s);
  for (const re of JUNK_TOKENS) s = s.replace(re, ' ');
  s = tidy(s);
  // Track numbers: "01 - ", "01. ", "1) ", "Track 3 - ", "01 Song" (zero-padded only).
  s = s.replace(/^(?:track\s*\d{1,3}|\d{1,3})\s*(?:[.)\]:]|\s[-–—]|-)\s*/i, '').replace(/^0\d\s+/, '');
  s = tidy(s);

  // Casing is judged on the whole name: "Kendrick Lamar - DNA." keeps "DNA.", "50 CENT - 21 QUESTIONS" is fixed.
  const recase = (x: string) => (fixCase(s) === s ? x : fixCase(x));
  let artist = '';
  let title = '';
  const sides = kebab ? [s] : splitSides(s);

  if (sides.length >= 2) {
    const knownAt = sides.findIndex((x) => knownWhole(x) || knownWhole(splitArtists(x).main));
    let ai = 0;
    if (knownAt >= 0) ai = knownAt;
    artist = sides[ai];
    title = sides.filter((_, i) => i !== ai).join(' - ');
  } else {
    const one = sides[0] ?? '';
    // "Title by Artist" / "Artist: Title" — only with a known artist, so "Stand by Me" stays whole.
    const by = /^(.+?)\s+by\s+(.+)$/i.exec(one);
    const colon = /^([^:]+):\s+(.+)$/.exec(one);
    if (by && (knownWhole(by[2]) || knownWhole(splitArtists(by[2]).main))) {
      title = by[1];
      artist = by[2];
    } else if (colon && knownWhole(colon[1])) {
      artist = colon[1];
      title = colon[2];
    } else {
      const words = one.split(' ').filter(Boolean);
      const hit = knownInside(words);
      if (hit) {
        artist = hit.known.name;
        title = [...words.slice(0, hit.from), ...words.slice(hit.to)].join(' ');
      } else {
        title = one;
      }
    }
  }

  artist = pullFeat(tidy(artist), feats);
  title = pullFeat(tidy(title), feats);
  const { main, others } = splitArtists(tidy(artist));
  artist = tidy(main);
  title = tidy(recase(tidy(title)));
  if (!title && artist && !knownWhole(artist)) [title, artist] = [recase(artist), ''];
  if (!title && artist) [title, artist] = [artistName(artist), ''];
  const name = (x: string) => knownWhole(x)?.name ?? recase(x);
  const guests = feats.filter(Boolean).map(name);
  if (title && guests.length) title += ` (feat. ${guests.join(', ')})`;
  if (title && others.length) title += ` (with ${others.map(name).join(', ')})`;
  return { artist: clip(artist ? name(artist) : ''), title: clip(title) };
}

// ---- Public API -----------------------------------------------------------------------

/** "50 Cent - 21 Questions (Official Music Video) [ytmp3.cc] 320kbps.mp3" -> { artist: '50 Cent', title: '21 Questions' } */
export function guessFromFileName(fileName: string): NameGuess {
  const base = String(fileName ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(EXT, '')
    .trim();
  const g = parse(base);
  return { artist: g.artist, title: g.title || 'My song' };
}

/** A sequence/track name that carries no song information. */
const JUNK_NAME =
  /^(?:track|trk|untitled|sequence|seq|melody|midi|song|tempo|tempo track|bass|drums?|voice|vocals?|instrument|channel|ch|part|staff|noname|no name|new song|new track|title|main|lead|harmony|accompaniment|accomp|right hand|left hand|rh|lh|treble|piano right|piano left|conductor|control|system|copy of .*|generated|unnamed|default)\s*[#.:-]?\s*\d*$/i;
const INSTRUMENTS =
  /^(?:(?:(?:acoustic|bright|electric|grand|honky-?tonk|upright|rhodes|soft|classical|concert)\s+)*piano(?: \d)?|(?:acoustic |electric |nylon |steel |jazz |clean |overdriven |distortion )?(?:guitar|bass)(?: \(?\w+\)?)?|strings?(?: ensemble)?(?: \d)?|string ensemble \d|violin|viola|cello|contrabass|harp|organ|church organ|rock organ|harpsichord|clavi(?:net)?|celesta|glockenspiel|music box|vibraphone|marimba|xylophone|flute|piccolo|recorder|oboe|clarinet|bassoon|trumpet|trombone|tuba|french horn|horn|sax(?:ophone)?|alto sax|tenor sax|choir|choir aahs|voice oohs|synth(?: \w+)?|pad(?: \d)?|lead(?: \d)?|percussion|timpani|orchestra|orchestral hit|brass(?: section)?|ensemble|keyboard|keys|epiano|e\.?\s?piano)$/i;
const CREDIT_JUNK = /^(?:created|generated|made|exported|converted|sequenced|transcribed|arranged|written|saved|edited|programmed)\b/i;

function usefulName(s: string | undefined): string {
  if (!s) return '';
  const t = s.replace(/\0/g, '').trim();
  if (t.length < 2 || t.length > 120) return '';
  if (/^\d+$/.test(t) || JUNK_NAME.test(t) || INSTRUMENTS.test(t) || CREDIT_JUNK.test(t)) return '';
  if (/^(?:©|\(c\)|copyright)/i.test(t) || /^@/.test(t)) return '';
  if (/^[^\p{L}]*$/u.test(t)) return '';
  return t;
}

/** "Words & Music by X", "Composed by X", "Performed by X" (not "Arranged by", "Sequenced by"). */
const BY_RE =
  /\b(?:words\s*(?:&|and)\s*music|music\s*(?:&|and)\s*(?:words|lyrics)|written|composed|music|performed|recorded|song|artist|composer)\s*(?:by|:)\s*(.+)$/i;
const PUBLISHER =
  /\b(?:publishing|publishers?|records|recordings|music group|entertainment|ltd|inc|llc|gmbh|corp|corporation|limited|sony|emi|universal|warner|bmg|atv|ascap|bmi|all rights|rights reserved|midi|sequenc|www\.|\.com)\b/i;

function cleanCredit(s: string): string {
  return tidy(
    s
      .replace(/\b(?:all rights reserved|used by permission|international copyright secured)\b.*$/i, '')
      .replace(/\s*[;|]\s*(?:arr\.?|arranged|transcribed|sequenced|midi).*/i, '')
      .replace(/\s*[,(]\s*(?:arr\.?|arranged|transcribed|sequenced|midi)\b.*$/i, '')
      .trim()
      .replace(/[.]+$/, ''),
  );
}

/** Useful title/artist from a MIDI file's sequence name, copyright and text events (junk like "Track 1", "Piano" ignored). */
export function metaFromMidi(midi: MidiFile): NameMeta {
  const out: NameMeta = {};
  try {
    const texts = (midi.texts ?? []).map((t) => String(t ?? '').replace(/\0/g, '').trim()).filter(Boolean);
    const copyright = (midi.copyright ?? []).map((t) => String(t ?? '').replace(/\0/g, '').trim()).filter(Boolean);
    let artist = '';
    let title = '';

    // Karaoke (.kar): "@T" lines are title then artist.
    const kar = texts.filter((t) => /^@T/.test(t)).map((t) => t.slice(2).trim()).filter(Boolean);
    // Key-value text: "Title: X", "Artist: Y".
    for (const t of texts.slice(0, 20)) {
      const kv = /^(title|song|artist|performer|composer|by)\s*[:=]\s*(.+)$/i.exec(t);
      if (!kv) continue;
      if (/^(title|song)$/i.test(kv[1])) title ||= kv[2];
      else artist ||= cleanCredit(kv[2]);
    }
    if (!title && kar[0]) title = kar[0];
    if (!artist && kar[1]) artist = cleanCredit(kar[1]);

    // Credits in copyright and the first few text events.
    const credits = [...copyright, ...texts.filter((t) => !t.startsWith('@')).slice(0, 12)];
    if (!artist) {
      for (const c of credits) {
        if (/\b(?:arr\.|arranged|transcribed|sequenced|midi\s+by|programmed)\b/i.test(c) && !BY_RE.test(c)) continue;
        const m = BY_RE.exec(c);
        if (m) {
          const who = cleanCredit(m[1]);
          if (who && !PUBLISHER.test(who) && who.split(' ').length <= 6) {
            artist = who;
            break;
          }
        }
      }
    }
    if (!artist) {
      for (const c of copyright) {
        const m = /^(?:copyright\s*)?(?:©|\(c\)|copyright)\s*(?:©|\(c\))?\s*(?:(?:19|20)\d\d\s*(?:[-–,/]\s*(?:19|20)?\d\d)?\s*[,.]?\s*)?(?:by\s+)?(.+)$/i.exec(c);
        if (!m) continue;
        const who = cleanCredit(m[1]);
        if (who && !PUBLISHER.test(who) && !/\d{4}/.test(who) && who.split(' ').length <= 5 && /\p{L}/u.test(who)) {
          artist = who;
          break;
        }
      }
    }

    // Sequence name ("Love Yourself", or "Justin Bieber - Love Yourself", or "love_yourself.mid").
    const seq = usefulName(midi.sequenceName ?? (midi.format === 0 || midi.trackNames.length === 1 ? midi.trackNames[0] : midi.trackNames[0]));
    if (seq && !title) {
      const g = guessFromFileName(seq);
      if (g.title !== 'My song') {
        title = g.title;
        if (g.artist && !artist) artist = g.artist;
      }
    }
    // "Artist - Title" in a text event, only when one side is a known artist.
    if (!title || !artist) {
      for (const t of texts.slice(0, 12)) {
        if (t.startsWith('@') || t.length > 100) continue;
        const sides = splitSides(t);
        if (sides.length !== 2 || !sides.some((x) => knownWhole(x))) continue;
        const g = parse(t);
        if (g.artist) {
          artist ||= g.artist;
          title ||= g.title;
          break;
        }
      }
    }

    const ct = cleanField(title);
    const ca = cleanArtist(artist);
    if (ct) out.title = ct;
    if (ca) out.artist = ca;
  } catch {
    /* never throw on odd files */
  }
  return out;
}

/** Same cleaning as file names, for one field that is already known to be a title. */
function cleanField(s: string | undefined): string {
  if (!s) return '';
  const feats: string[] = [];
  let t = cleanBrackets(s.replace(/\0/g, ' ').replace(/_/g, ' '), feats);
  t = tidy(stripJunk(t));
  t = tidy(pullFeat(t, feats));
  t = fixCase(t);
  const guests = feats.filter(Boolean).map(fixCase);
  if (t && guests.length) t += ` (feat. ${guests.join(', ')})`;
  return clip(t);
}

/** An artist field: junk removed, "VEVO" / " - Topic" channel suffixes dropped, canonical spelling. */
function cleanArtist(s: string | undefined): string {
  if (!s) return '';
  let t = s.replace(/\0/g, ' ').replace(/_/g, ' ');
  t = t.replace(/\s*-\s*topic\s*$/i, '').replace(/\s*vevo\s*$/i, '').replace(/\s*official\s*$/i, '');
  t = tidy(stripJunk(cleanBrackets(t, [])));
  return clip(t ? artistName(t) : '');
}

/** Tags beat the file name, field by field; both are cleaned. */
export function pickName(fileName: string, meta: NameMeta = {}): NameGuess {
  const fromFile = guessFromFileName(fileName);
  let artist = cleanArtist(meta.artist);
  let title = '';
  if (meta.title?.trim()) {
    let raw = meta.title.trim();
    if (artist) {
      // "Zara Larsson - Lush Life" with artist "Zara Larsson": drop the repeated artist.
      const sides = splitSides(raw);
      if (sides.length >= 2 && norm(sides[0]) === norm(artist)) raw = sides.slice(1).join(' - ');
      title = cleanField(raw);
    } else {
      // No artist tag: split "Artist - Title" only when one side is a known artist.
      const sides = splitSides(raw);
      const g = parse(raw);
      if (sides.length >= 2 && g.artist && knownWhole(g.artist)) {
        title = g.title;
        artist = g.artist;
      } else {
        title = cleanField(raw);
      }
    }
  }
  if (!title) title = fromFile.title;
  if (!artist) artist = fromFile.artist;
  return { artist: clip(artist), title: clip(title) || 'My song' };
}
