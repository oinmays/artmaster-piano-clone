import { describe, expect, it } from 'vitest';
import { readAudioTags } from '../src/songs/id3';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const utf8 = (s: string) => [...new TextEncoder().encode(s)];
const utf16le = (s: string) => [...s].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]);
const utf16be = (s: string) => [...s].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255]);
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const safe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
const audio = (n = 64) => new Array(n).fill(0xff).map((v, i) => (i % 2 ? 0xfb : v));

function id3v2(major: number, frames: number[][], flags = 0, padding = 16): number[] {
  const body = [...frames.flat(), ...new Array(padding).fill(0)];
  return [...ascii('ID3'), major, 0, flags, ...safe(body.length), ...body];
}
const frame23 = (id: string, body: number[]) => [...ascii(id), ...be32(body.length), 0, 0, ...body];
const frame24 = (id: string, body: number[], fmt = 0) => [...ascii(id), ...safe(body.length), 0, fmt, ...body];
const frame22 = (id: string, body: number[]) => [...ascii(id), (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body];

function id3v1(title: string, artist: string): number[] {
  const pad = (s: string) => [...ascii(s), ...new Array(30 - s.length).fill(0)];
  return [...ascii('TAG'), ...pad(title), ...pad(artist), ...new Array(30 + 4 + 30 + 1).fill(0)];
}

const atom = (type: string, body: number[]) => [...be32(body.length + 8), ...(type.startsWith('©') ? [0xa9, ...ascii(type.slice(1))] : ascii(type)), ...body];
const dataAtom = (text: string) => atom('data', [0, 0, 0, 1, 0, 0, 0, 0, ...utf8(text)]);

describe('readAudioTags', () => {
  it('reads ID3v2.3 with UTF-16 (BOM) text', () => {
    const bytes = new Uint8Array([
      ...id3v2(3, [
        frame23('TALB', [0, ...ascii('Album')]),
        frame23('TIT2', [1, 0xff, 0xfe, ...utf16le('Lush Life'), 0, 0]),
        frame23('TPE1', [1, 0xfe, 0xff, ...utf16be('Zara Larsson')]),
      ]),
      ...audio(),
    ]);
    expect(readAudioTags(bytes)).toEqual({ title: 'Lush Life', artist: 'Zara Larsson' });
  });

  it('reads ID3v2.4 with UTF-8 text and syncsafe sizes', () => {
    const long = 'Ł'.repeat(100); // > 127 bytes so the syncsafe size matters
    const bytes = new Uint8Array([...id3v2(4, [frame24('TIT2', [3, ...utf8(`Für Elise ${long}`)]), frame24('TPE1', [3, ...utf8('Beyoncé')])]), ...audio()]);
    expect(readAudioTags(bytes)).toEqual({ title: `Für Elise ${long}`, artist: 'Beyoncé' });
  });

  it('skips a v2.4 extended header and handles per-frame unsynchronisation', () => {
    const ext = [...safe(6), 1, 0];
    const frames = [frame24('TIT2', [0, ...ascii('Stay'), 0xff, 0x00]), frame24('TPE1', [0, ...ascii('Rihanna')])];
    const body = [...ext, ...frames.flat(), 0, 0, 0, 0];
    // Mark TIT2 as unsynchronised: its 0xFF 0x00 becomes 0xFF, which latin1 shows as ÿ.
    body[ext.length + 9] = 0x02;
    const bytes = new Uint8Array([...ascii('ID3'), 4, 0, 0x40, ...safe(body.length), ...body, ...audio()]);
    expect(readAudioTags(bytes)).toEqual({ title: 'Stayÿ', artist: 'Rihanna' });
  });

  it('reads ID3v2.2 (TT2/TP1) and falls back to the album artist', () => {
    const v22 = new Uint8Array([...id3v2(2, [frame22('TT2', [0, ...ascii('Hello')]), frame22('TP2', [0, ...ascii('Adele')])]), ...audio()]);
    expect(readAudioTags(v22)).toEqual({ title: 'Hello', artist: 'Adele' });
  });

  it('prefers TPE1 over TPE2', () => {
    const bytes = new Uint8Array([...id3v2(3, [frame23('TPE2', [0, ...ascii('Various Artists')]), frame23('TPE1', [0, ...ascii('Sia')])]), ...audio()]);
    expect(readAudioTags(bytes)).toEqual({ artist: 'Sia' });
  });

  it('reads ID3v1 at the end of the file, and fills gaps in ID3v2', () => {
    expect(readAudioTags(new Uint8Array([...audio(400), ...id3v1('Someone Like You', 'Adele')]))).toEqual({ title: 'Someone Like You', artist: 'Adele' });
    const both = new Uint8Array([...id3v2(3, [frame23('TIT2', [0, ...ascii('Real Title')])]), ...audio(), ...id3v1('Old Title', 'Old Artist')]);
    expect(readAudioTags(both)).toEqual({ title: 'Real Title', artist: 'Old Artist' });
  });

  it('reads M4A ilst ©nam / ©ART', () => {
    const ilst = atom('ilst', [...atom('©nam', dataAtom('Diamonds')), ...atom('©ART', dataAtom('Rihanna'))]);
    const meta = atom('meta', [0, 0, 0, 0, ...atom('hdlr', new Array(25).fill(0)), ...ilst]);
    const moov = atom('moov', [...atom('mvhd', new Array(100).fill(0)), ...atom('udta', meta)]);
    const bytes = new Uint8Array([...atom('ftyp', ascii('M4A \0\0\0\0isom')), ...atom('mdat', audio(200)), ...moov]);
    expect(readAudioTags(bytes)).toEqual({ title: 'Diamonds', artist: 'Rihanna' });
  });

  it('reads WAV LIST/INFO INAM and IART', () => {
    const sub = (id: string, text: string) => {
      const b = [...utf8(text), 0];
      return [...ascii(id), ...le32(b.length), ...b, ...(b.length & 1 ? [0] : [])];
    };
    const info = [...ascii('INFO'), ...sub('IART', 'Tyler Childers'), ...sub('INAM', 'Lady May')];
    const fmt = [...ascii('fmt '), ...le32(16), ...new Array(16).fill(0)];
    const list = [...ascii('LIST'), ...le32(info.length), ...info];
    const data = [...ascii('data'), ...le32(8), ...new Array(8).fill(0)];
    const body = [...ascii('WAVE'), ...fmt, ...data, ...list];
    expect(readAudioTags(new Uint8Array([...ascii('RIFF'), ...le32(body.length), ...body]))).toEqual({ title: 'Lady May', artist: 'Tyler Childers' });
  });

  it('returns {} for garbage, truncated or empty input and never throws', () => {
    expect(readAudioTags(new Uint8Array())).toEqual({});
    expect(readAudioTags(new Uint8Array(1000).map((_, i) => (i * 37) & 255))).toEqual({});
    expect(readAudioTags(new Uint8Array([...ascii('ID3'), 3, 0, 0, 127, 127, 127, 127, ...ascii('TIT2'), 255, 255]))).toEqual({});
    expect(readAudioTags(new Uint8Array([...atom('ftyp', ascii('M4A ')), 0, 0, 0, 1, ...ascii('moov')]))).toEqual({});
    expect(readAudioTags(new Uint8Array([...ascii('RIFF'), 255, 255, 255, 255, ...ascii('WAVELIST'), 255, 255, 255, 127]))).toEqual({});
    expect(readAudioTags(undefined as unknown as Uint8Array)).toEqual({});
  });
});
