import { describe, expect, it } from 'vitest';
import { isAppleMobile, midiHelp, midiPlatform, midiPossible, type PlatformProbe } from '../src/listen/platform';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  iosChrome: 'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
};

const p = (o: Partial<PlatformProbe>): PlatformProbe => ({ userAgent: '', maxTouchPoints: 0, hasWebMidi: false, ...o });

describe('midiPlatform', () => {
  it('iPhone Safari cannot use MIDI', () => {
    expect(midiPlatform(p({ userAgent: UA.iphone, maxTouchPoints: 5 }))).toBe('ios-browser');
  });
  it('iPadOS with a desktop user agent is still an iPad', () => {
    const ipad = p({ userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 });
    expect(isAppleMobile(ipad)).toBe(true);
    expect(midiPlatform(ipad)).toBe('ios-browser');
  });
  it('Chrome on iPad is WebKit too, even if something claims Web MIDI', () => {
    expect(midiPlatform(p({ userAgent: UA.iosChrome, maxTouchPoints: 5, hasWebMidi: true }))).toBe('ios-browser');
  });
  it('desktop Safari on a Mac has no Web MIDI', () => {
    expect(midiPlatform(p({ userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 0 }))).toBe('no-web-midi');
  });
  it('Chrome on Mac and Android use Web MIDI', () => {
    expect(midiPlatform(p({ userAgent: UA.macChrome, platform: 'MacIntel', hasWebMidi: true }))).toBe('web-midi');
    expect(midiPlatform(p({ userAgent: UA.android, maxTouchPoints: 5, hasWebMidi: true }))).toBe('web-midi');
    expect(midiPlatform(p({ userAgent: UA.android, platform: 'MacIntel', maxTouchPoints: 5, hasWebMidi: true }))).toBe('web-midi');
  });
  it('the iOS app bridge wins over the user agent', () => {
    const app = p({ userAgent: UA.iphone, maxTouchPoints: 5, native: { platform: 'ios', midi: true } });
    expect(midiPlatform(app)).toBe('ios-app');
    expect(midiPossible(app)).toBe(true);
  });
});

describe('midiHelp', () => {
  it('is honest on iPhone/iPad browsers', () => {
    const h = midiHelp('ios-browser');
    expect(h.ok).toBe(false);
    expect(h.body).toMatch(/iOS app/);
    expect(h.body).toMatch(/Chrome or Edge/);
  });
  it('says it works where it does', () => {
    expect(midiHelp('web-midi').ok).toBe(true);
    expect(midiHelp('ios-app').ok).toBe(true);
  });
});
