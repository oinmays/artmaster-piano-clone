import { describe, expect, it } from 'vitest';
import { guessFromFileName, metaFromMidi, pickName } from '../src/songs/naming';
import type { MidiFile } from '../src/songs/midifile';

/** Real-world file names (downloaders, MuseScore exports, phone rips) -> [artist, title]. */
const TABLE: [string, string, string][] = [
  ['50 Cent - 21 Questions (Official Music Video) [ytmp3.cc] 320kbps.mp3', '50 Cent', '21 Questions'],
  ['y2mate.com - Justin_Bieber_Love_Yourself_easy_piano.mid', 'Justin Bieber', 'Love Yourself'],
  ['lush-life-zara-larsson-piano-tutorial.mid', 'Zara Larsson', 'Lush Life'],
  ['Rihanna - Diamonds (Official Video) (1).mp3', 'Rihanna', 'Diamonds'],
  ['Tyler Childers - Nose On The Grindstone (Live) [Official Audio].m4a', 'Tyler Childers', 'Nose On The Grindstone (Live)'],
  ['01 - Many Men (Wish Death).mp3', '', 'Many Men (Wish Death)'],
  ['Lonely - Justin Bieber, benny blanco (Lyrics).mp3', 'Justin Bieber', 'Lonely (with benny blanco)'],
  ['ADELE - ROLLING IN THE DEEP.mp3', 'Adele', 'Rolling in the Deep'],
  ['Ed Sheeran - Perfect (feat. Beyoncé) [Official Audio].mp3', 'Ed Sheeran', 'Perfect (feat. Beyoncé)'],
  ['The Weeknd ft. Daft Punk - Starboy (Official Video).mp3', 'The Weeknd', 'Starboy (feat. Daft Punk)'],
  ['Coldplay - The Scientist copy.mid', 'Coldplay', 'The Scientist'],
  ['billie_eilish_-_lovely_with_lyrics.mp3', 'Billie Eilish', 'Lovely'],
  ['river-flows-in-you-yiruma.mid', 'Yiruma', 'River Flows in You'],
  ['Track 3 - Nuvole Bianche.mid', '', 'Nuvole Bianche'],
  ['03. Someone Like You.mp3', '', 'Someone Like You'],
  ['Hello by Adele (Lyrics) [HQ].mp3', 'Adele', 'Hello'],
  ['Clair de Lune - Debussy.mid', 'Claude Debussy', 'Clair de Lune'],
  ['Taylor Swift – Anti-Hero (Official Lyric Video) 1080p.mp4', 'Taylor Swift', 'Anti-Hero'],
  ['mp3juices - Bruno Mars - When I Was Your Man [128 kbps].mp3', 'Bruno Mars', 'When I Was Your Man'],
  ['Lewis Capaldi - Someone You Loved (Slowed + Reverb).mp3', 'Lewis Capaldi', 'Someone You Loved'],
  ['Queen - Bohemian Rhapsody (Remastered 2011).mp3', 'Queen', 'Bohemian Rhapsody'],
  ['Elton John - Your Song (Remastered 2014) (1).mp3', 'Elton John', 'Your Song'],
  ['musescore.com - Interstellar_Main_Theme_Hans_Zimmer.mid', 'Hans Zimmer', 'Interstellar Main Theme'],
  ['Some Band - Unknown Song.mp3', 'Some Band', 'Unknown Song'],
  ['my_song_final.mid', '', 'My Song'],
  ['Stand by Me.mp3', '', 'Stand by Me'],
  ['New York, New York.mid', '', 'New York, New York'],
  ['Kendrick Lamar - DNA. (Official Video).mp3', 'Kendrick Lamar', 'DNA.'],
  ['Eminem - Lose Yourself [HD].mp3', 'Eminem', 'Lose Yourself'],
  ['Billy Joel - Piano Man (Audio).mp3', 'Billy Joel', 'Piano Man'],
  ['dancing queen abba.mid', 'ABBA', 'Dancing Queen'],
  ['Für Elise.mid', '', 'Für Elise'],
  ['C:\\Users\\me\\Downloads\\Imagine_Dragons_-_Believer_(Official_Music_Video).mp3', 'Imagine Dragons', 'Believer'],
  ['adele-hello.mid', 'Adele', 'Hello'],
  ['y2mate.is - Hozier Take Me to Church Official Video-PVjiKRfKpPI-192k-1700000000.mp3', 'Hozier', 'Take Me to Church'],
  ['Rihanna x Drake - Work.mp3', 'Rihanna', 'Work (with Drake)'],
  ['.mid', '', 'My song'],
];

describe('guessFromFileName', () => {
  it.each(TABLE)('%s', (file, artist, title) => {
    expect(guessFromFileName(file)).toEqual({ artist, title });
  });

  it('keeps names to 80 characters', () => {
    const g = guessFromFileName(`${'a'.repeat(200)}.mid`);
    expect(g.title.length).toBeLessThanOrEqual(80);
  });
});

const midiWith = (m: Partial<MidiFile>): MidiFile => ({
  format: 1,
  ppq: 480,
  tempo: 500000,
  timeSig: { num: 4, den: 4 },
  trackNames: [],
  notes: [],
  ...m,
});

describe('metaFromMidi', () => {
  it('uses a real sequence name as the title', () => {
    expect(metaFromMidi(midiWith({ sequenceName: 'Love Yourself' }))).toEqual({ title: 'Love Yourself' });
  });
  it('ignores junk sequence names', () => {
    for (const junk of ['Track 1', 'Untitled', 'Piano', 'Acoustic Grand Piano', 'Sequence', 'Melody', 'MIDI', '12', 'Created by MuseScore', '', 'Right Hand']) {
      expect(metaFromMidi(midiWith({ sequenceName: junk })).title, junk).toBeUndefined();
    }
  });
  it('reads "Artist - Title" and file-name style sequence names', () => {
    expect(metaFromMidi(midiWith({ sequenceName: 'Justin Bieber - Love Yourself' }))).toEqual({ artist: 'Justin Bieber', title: 'Love Yourself' });
    expect(metaFromMidi(midiWith({ sequenceName: 'love_yourself.mid' }))).toEqual({ title: 'Love Yourself' });
  });
  it('takes the artist from credits but not from arrangers or publishers', () => {
    expect(metaFromMidi(midiWith({ copyright: ['Words & Music by Ed Sheeran'] })).artist).toBe('Ed Sheeran');
    expect(metaFromMidi(midiWith({ texts: ['Composed by Yiruma', 'Arranged by Someone Else'] })).artist).toBe('Yiruma');
    expect(metaFromMidi(midiWith({ texts: ['Arranged by Someone Else'] })).artist).toBeUndefined();
    expect(metaFromMidi(midiWith({ copyright: ['© 2015 Sony/ATV Music Publishing'] })).artist).toBeUndefined();
    expect(metaFromMidi(midiWith({ copyright: ['© 2015 Lewis Capaldi'] })).artist).toBe('Lewis Capaldi');
    expect(metaFromMidi(midiWith({ copyright: ['Copyright (c) 1998 by Jane Doe. All rights reserved.'] })).artist).toBe('Jane Doe');
  });
  it('reads karaoke @T lines and Title:/Artist: text', () => {
    expect(metaFromMidi(midiWith({ texts: ['@KMIDI KARAOKE FILE', '@TYesterday', '@TThe Beatles', 'Yes', 'ter', 'day'] }))).toEqual({
      title: 'Yesterday',
      artist: 'The Beatles',
    });
    expect(metaFromMidi(midiWith({ texts: ['Title: Hallelujah', 'Artist: Leonard Cohen'] }))).toEqual({ title: 'Hallelujah', artist: 'Leonard Cohen' });
  });
  it('finds "Artist - Title" in a text event only with a known artist', () => {
    expect(metaFromMidi(midiWith({ texts: ['Coldplay - Clocks'] }))).toEqual({ artist: 'Coldplay', title: 'Clocks' });
    expect(metaFromMidi(midiWith({ texts: ['verse - chorus'] }))).toEqual({});
  });
  it('never throws on missing fields', () => {
    expect(metaFromMidi(midiWith({}))).toEqual({});
  });
});

describe('pickName', () => {
  it('prefers tags over the file name, field by field', () => {
    expect(pickName('track01.mp3', { title: 'Lush Life', artist: 'Zara Larsson' })).toEqual({ artist: 'Zara Larsson', title: 'Lush Life' });
    expect(pickName('Rihanna - Stay.mp3', { title: 'Stay (Official Video)' })).toEqual({ artist: 'Rihanna', title: 'Stay' });
    expect(pickName('Rihanna - Stay.mp3', { artist: 'RIHANNA' })).toEqual({ artist: 'Rihanna', title: 'Stay' });
  });
  it('cleans tags like file names', () => {
    expect(pickName('x.mp3', { title: 'Zara Larsson - Lush Life (Official Video)', artist: 'Zara Larsson VEVO' })).toEqual({
      artist: 'Zara Larsson',
      title: 'Lush Life',
    });
    expect(pickName('x.mp3', { title: 'Adele - Hello [Official Audio]' })).toEqual({ artist: 'Adele', title: 'Hello' });
    expect(pickName('x.mp3', { title: 'Für Elise - Bagatelle' })).toEqual({ artist: '', title: 'Für Elise - Bagatelle' });
  });
  it('never returns an empty title and limits both fields', () => {
    expect(pickName('', {})).toEqual({ artist: '', title: 'My song' });
    expect(pickName('[ytmp3.cc].mp3', { title: '   ' }).title).toBe('My song');
    const long = pickName('a.mid', { title: 'T'.repeat(300), artist: 'A'.repeat(300) });
    expect(long.title.length).toBe(80);
    expect(long.artist.length).toBe(80);
  });
});
