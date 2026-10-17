/**
 * Title and artist tags from audio file bytes (T25):
 *   - ID3v2.2 / 2.3 / 2.4 at the start (MP3, also inside a WAV "id3 " chunk): TIT2/TPE1 (TT2/TP1),
 *     TPE2/TP2 (album artist) only when there is no TPE1. Text encodings 0 latin1, 1 UTF-16 with BOM,
 *     2 UTF-16BE, 3 UTF-8. Syncsafe sizes, tag-wide (2.2/2.3) and per-frame (2.4) unsynchronisation,
 *     extended header skipped, compressed/encrypted frames skipped.
 *   - ID3v1 ("TAG" in the last 128 bytes) for whatever ID3v2 did not give.
 *   - MP4/M4A: moov/udta/meta/ilst ©nam and ©ART (aART as fallback) 'data' atoms.
 *   - RIFF WAVE: LIST/INFO INAM and IART.
 */
import type { NameMeta } from './naming';

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};
function utf16(b: Uint8Array, littleEndian: boolean): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(littleEndian ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  return s;
}
function utf8(b: Uint8Array, fallbackLatin1 = false): string {
  try {
    return new TextDecoder('utf-8', { fatal: fallbackLatin1 }).decode(b);
  } catch {
    return latin1(b);
  }
}
/** Trim nulls and spaces; several null-separated values (ID3v2.4) are joined with ", ". */
const clean = (s: string) =>
  s
    .split('\0')
    .map((x) => x.replace(/^﻿/, '').trim())
    .filter(Boolean)
    .join(', ');

const str4 = (b: Uint8Array, at: number) => (at + 4 <= b.length ? latin1(b.subarray(at, at + 4)) : '');
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const syncsafe = (b: Uint8Array, at: number) => ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f);

/** Undo ID3 unsynchronisation: every 0xFF 0x00 becomes 0xFF. */
function unsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

function decodeText(body: Uint8Array): string {
  if (!body.length) return '';
  const enc = body[0];
  const data = body.subarray(1);
  if (enc === 0) return clean(latin1(data));
  if (enc === 3) return clean(utf8(data));
  if (enc === 2) return clean(utf16(data, false));
  if (enc === 1) {
    // UTF-16 with BOM; each null-separated value may carry its own BOM.
    let out = '';
    let le = true;
    for (let i = 0; i + 1 < data.length; ) {
      if (data[i] === 0xff && data[i + 1] === 0xfe) [le, i] = [true, i + 2];
      else if (data[i] === 0xfe && data[i + 1] === 0xff) [le, i] = [false, i + 2];
      else {
        out += String.fromCharCode(le ? data[i] | (data[i + 1] << 8) : (data[i] << 8) | data[i + 1]);
        i += 2;
      }
    }
    return clean(out);
  }
  return '';
}

interface Tags {
  title?: string;
  artist?: string;
  albumArtist?: string;
}

/** ID3v2 tag starting at `at` (normally 0). */
function readId3v2(bytes: Uint8Array, at = 0): Tags {
  const out: Tags = {};
  if (bytes.length < at + 10 || latin1(bytes.subarray(at, at + 3)) !== 'ID3') return out;
  const major = bytes[at + 3];
  if (major < 2 || major > 4) return out;
  const flags = bytes[at + 5];
  const size = syncsafe(bytes, at + 6);
  let tag = bytes.subarray(at + 10, Math.min(bytes.length, at + 10 + size));
  if (flags & 0x80 && major < 4) tag = unsync(tag);
  let pos = 0;
  if (flags & 0x40 && major >= 3) {
    // Extended header: v2.3 size excludes its own 4 bytes, v2.4 is syncsafe and includes them.
    pos = major === 3 ? u32be(tag, 0) + 4 : syncsafe(tag, 0);
  }
  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;
  const wanted: Record<string, keyof Tags> =
    major === 2 ? { TT2: 'title', TP1: 'artist', TP2: 'albumArtist' } : { TIT2: 'title', TPE1: 'artist', TPE2: 'albumArtist' };

  while (pos + headLen <= tag.length) {
    if (tag[pos] === 0) break; // padding
    const id = latin1(tag.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let len: number;
    if (major === 2) len = (tag[pos + 3] << 16) | (tag[pos + 4] << 8) | tag[pos + 5];
    else if (major === 3) len = u32be(tag, pos + 4);
    else {
      len = syncsafe(tag, pos + 4);
      // Some v2.4 writers use plain sizes: prefer the reading that lands on the next frame or padding.
      const plain = u32be(tag, pos + 4);
      if (plain !== len && !looksLikeFrame(tag, pos + headLen + len) && looksLikeFrame(tag, pos + headLen + plain)) len = plain;
    }
    const fmt = major === 2 ? 0 : tag[pos + 9];
    let body = tag.subarray(pos + headLen, Math.min(tag.length, pos + headLen + len));
    pos += headLen + len;
    const key = wanted[id];
    if (!key || out[key]) continue;
    if (major === 3) {
      if (fmt & 0xc0) continue; // compressed or encrypted
      if (fmt & 0x20) body = body.subarray(1); // grouping id
    } else if (major === 4) {
      if (fmt & 0x0c) continue; // compressed or encrypted
      if (fmt & 0x40) body = body.subarray(1); // grouping id
      if (fmt & 0x01) body = body.subarray(4); // data length indicator
      if (fmt & 0x02) body = unsync(body);
    }
    const text = decodeText(body);
    if (text) out[key] = text;
  }
  return out;
}
const looksLikeFrame = (tag: Uint8Array, at: number) =>
  at === tag.length || (at < tag.length && (tag[at] === 0 || /^[A-Z0-9]{4}$/.test(str4(tag, at))));

/** ID3v1: "TAG" + 30 title + 30 artist in the last 128 bytes. */
function readId3v1(bytes: Uint8Array): Tags {
  if (bytes.length < 128) return {};
  const t = bytes.subarray(bytes.length - 128);
  if (latin1(t.subarray(0, 3)) !== 'TAG') return {};
  const field = (from: number) => clean(latin1(t.subarray(from, from + 30)));
  return { title: field(3) || undefined, artist: field(33) || undefined };
}

// ---- MP4 ----

interface Atom {
  type: string;
  start: number;
  end: number;
  body: number;
}
function* atoms(b: Uint8Array, from: number, to: number): Generator<Atom> {
  let pos = from;
  while (pos + 8 <= to) {
    let size = u32be(b, pos);
    const type = latin1(b.subarray(pos + 4, pos + 8));
    let body = pos + 8;
    if (size === 1) {
      if (pos + 16 > to) return;
      const hi = u32be(b, pos + 8);
      size = hi * 2 ** 32 + u32be(b, pos + 12);
      body = pos + 16;
    } else if (size === 0) size = to - pos;
    if (size < body - pos) return;
    const end = Math.min(to, pos + size);
    yield { type, start: pos, end, body };
    pos += size;
  }
}
const child = (b: Uint8Array, parent: Atom, type: string, skip = 0) => {
  for (const a of atoms(b, parent.body + skip, parent.end)) if (a.type === type) return a;
  return undefined;
};

function readMp4(b: Uint8Array): Tags {
  if (str4(b, 4) !== 'ftyp') return {};
  let moov: Atom | undefined;
  for (const a of atoms(b, 0, b.length)) if (a.type === 'moov') moov = a;
  if (!moov) return {};
  const udta = child(b, moov, 'udta');
  const metaAtom = udta && child(b, udta, 'meta');
  if (!metaAtom) return {};
  // ISO 'meta' is a full box (4 bytes version/flags); QuickTime-style files omit them.
  const skip = str4(b, metaAtom.body + 4) === 'hdlr' ? 0 : 4;
  const ilst = child(b, metaAtom, 'ilst', skip);
  if (!ilst) return {};
  const out: Tags = {};
  for (const item of atoms(b, ilst.body, ilst.end)) {
    const key = item.type === '©nam' ? 'title' : item.type === '©ART' ? 'artist' : item.type === 'aART' ? 'albumArtist' : undefined;
    if (!key || out[key]) continue;
    const data = child(b, item, 'data');
    if (!data || data.body + 8 > data.end) continue;
    const kind = u32be(b, data.body) & 0xffffff;
    const value = b.subarray(data.body + 8, data.end);
    const text = clean(kind === 2 ? utf16(value, false) : utf8(value));
    if (text) out[key] = text;
  }
  return out;
}

// ---- RIFF WAVE ----

function readWav(b: Uint8Array): Tags {
  if (str4(b, 0) !== 'RIFF' || str4(b, 8) !== 'WAVE') return {};
  const out: Tags = {};
  let id3: Tags = {};
  const end = Math.min(b.length, u32le(b, 4) + 8);
  let pos = 12;
  while (pos + 8 <= end) {
    const id = str4(b, pos);
    const len = u32le(b, pos + 4);
    const body = pos + 8;
    const stop = Math.min(end, body + len);
    if (id === 'LIST' && str4(b, body) === 'INFO') {
      let p = body + 4;
      while (p + 8 <= stop) {
        const sub = str4(b, p);
        const n = u32le(b, p + 4);
        const text = clean(utf8(b.subarray(p + 8, Math.min(stop, p + 8 + n)), true));
        if (sub === 'INAM' && text && !out.title) out.title = text;
        if (sub === 'IART' && text && !out.artist) out.artist = text;
        p += 8 + n + (n & 1);
      }
    } else if (id === 'id3 ' || id === 'ID3 ') {
      id3 = readId3v2(b.subarray(body, stop));
    }
    pos = body + len + (len & 1);
  }
  return { ...id3, ...Object.fromEntries(Object.entries(out).filter(([, v]) => v)) };
}

/** Never throws; {} when there are no tags or the bytes are not understood. Only needs the first ~512 KB plus the last 128 bytes for ID3v1 — callers may pass the whole file. */
export function readAudioTags(bytes: Uint8Array): NameMeta {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length < 8) return {};
    let tags: Tags = {};
    if (latin1(bytes.subarray(0, 3)) === 'ID3') {
      tags = readId3v2(bytes);
      const v1 = readId3v1(bytes);
      tags = { title: tags.title || v1.title, artist: tags.artist || v1.artist, albumArtist: tags.albumArtist };
    } else if (str4(bytes, 4) === 'ftyp') tags = readMp4(bytes);
    else if (str4(bytes, 0) === 'RIFF') tags = readWav(bytes);
    else tags = readId3v1(bytes);
    const out: NameMeta = {};
    const title = tags.title?.trim();
    const artist = (tags.artist || tags.albumArtist)?.trim();
    if (title) out.title = title;
    if (artist) out.artist = artist;
    return out;
  } catch {
    return {};
  }
}
