/**
 * Where can a USB/MIDI keyboard reach Keys? (T13)
 *
 * WebKit has no Web MIDI, so on iPhone/iPad every browser (all of them are WebKit) and the
 * home-screen app can't see a keyboard, whatever the cable. There the only route is the
 * Keys iOS app (ios/), which bridges CoreMIDI into the page.
 *
 * Native bridge contract (T14 → T12):
 * - At document start the iOS app sets `window.keysNative = { platform: 'ios', midi: true,
 *   devices: string[] }`.
 * - Each MIDI message: `window.dispatchEvent(new CustomEvent('keysnative:midi',
 *   { detail: { data: [status, data1, data2], device?: string } }))`.
 * - Device list changes: update `keysNative.devices`, then dispatch
 *   `new CustomEvent('keysnative:devices', { detail: { names: string[] } })`.
 */

export interface KeysNative {
  platform: 'ios';
  midi: boolean;
  devices?: string[];
  version?: string;
}

declare global {
  interface Window {
    keysNative?: KeysNative;
  }
}

export const NATIVE_MIDI_EVENT = 'keysnative:midi';
export const NATIVE_DEVICES_EVENT = 'keysnative:devices';

export type MidiPlatform =
  /** The Keys iOS app: CoreMIDI via the native bridge. */
  | 'ios-app'
  /** A browser with Web MIDI (Chrome/Edge/Firefox desktop, Chrome Android). */
  | 'web-midi'
  /** Safari / any browser / home-screen app on iPhone or iPad: no MIDI possible. */
  | 'ios-browser'
  /** Desktop Safari or another browser without Web MIDI. */
  | 'no-web-midi';

export interface PlatformProbe {
  userAgent: string;
  /** navigator.platform, for iPadOS's desktop-class "MacIntel" user agent. */
  platform?: string;
  maxTouchPoints?: number;
  hasWebMidi: boolean;
  native?: KeysNative;
}

function probe(): PlatformProbe {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    userAgent: nav?.userAgent ?? '',
    platform: nav?.platform,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    hasWebMidi: !!nav && 'requestMIDIAccess' in nav,
    native: typeof window !== 'undefined' ? window.keysNative : undefined,
  };
}

/** iPhone, iPod or iPad, including iPadOS 13+ which reports itself as a Mac. */
export function isAppleMobile(p: PlatformProbe = probe()): boolean {
  if (/iPhone|iPad|iPod/.test(p.userAgent)) return true;
  // Trust the user agent over navigator.platform, which emulators and some Android builds misreport.
  return /Macintosh/.test(p.userAgent) && (p.maxTouchPoints ?? 0) > 1;
}

export function midiPlatform(p: PlatformProbe = probe()): MidiPlatform {
  if (p.native?.midi) return 'ios-app';
  if (isAppleMobile(p)) return 'ios-browser';
  return p.hasWebMidi ? 'web-midi' : 'no-web-midi';
}

/** True when a MIDI keyboard can reach the app on this device. */
export const midiPossible = (p: PlatformProbe = probe()): boolean => {
  const m = midiPlatform(p);
  return m === 'ios-app' || m === 'web-midi';
};

export interface MidiHelp {
  ok: boolean;
  title: string;
  body: string;
}

/** One honest sentence or two for Settings, the player and Mic check. */
export function midiHelp(m: MidiPlatform = midiPlatform()): MidiHelp {
  switch (m) {
    case 'ios-app':
      return { ok: true, title: 'USB keyboard ready', body: 'Plug the keyboard in with a data cable and play. Notes arrive directly, no microphone needed.' };
    case 'web-midi':
      return { ok: true, title: 'USB keyboard supported', body: 'Plug the keyboard in with a data cable (not charge-only). The browser may ask to allow MIDI devices.' };
    case 'ios-browser':
      return {
        ok: false,
        title: 'USB keyboards need the Keys iOS app',
        body: "Apple doesn't let Safari or any iPhone/iPad browser read MIDI, so a cable alone won't work here. Use the Keys iOS app, or open Keys in Chrome or Edge on a Mac, PC or Android. Until then, use the microphone.",
      };
    default:
      return {
        ok: false,
        title: "This browser can't read MIDI",
        body: 'Open Keys in Chrome or Edge to use a USB keyboard. Safari on Mac has no MIDI support.',
      };
  }
}
