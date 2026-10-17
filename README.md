# Keys: a piano teacher web app

An installable web app (PWA) for iPhone and iPad, modelled on the practice loop of
ArtMaster's **Artie** AI piano teacher. Pick a song, follow the falling notes, and the
app listens through the microphone and scores your accuracy and timing. It also has a
tuner, a metronome and a chord finder.

**Live app:** https://oinmays.github.io/artmaster-piano-clone/

- How the original was studied: [`docs/recon.md`](docs/recon.md)
- Work plan and ownership: [`TICKETS.md`](TICKETS.md)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN, for testing on an iPad)
npm test
npm run build      # outputs dist/
```

## Install on iPhone / iPad

1. Open https://oinmays.github.io/artmaster-piano-clone/ in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Launch it from the home screen. It runs full-screen and works offline after the first load.

Microphone listening needs HTTPS (GitHub Pages provides it) and permission on first use.
With the phone on silent, sound may be muted. Turn the ring switch on, or use headphones.

## Connect a USB keyboard

A USB cable gives exact notes with almost no delay, no room noise and no octave mix-ups.
Portable keyboards with a micro-USB "USB to Host" port (such as the Casio Casiotone CT-S
range) are USB-MIDI class compliant, so no driver is needed. The in-app guide is at
**Tools → Connect a keyboard**.

| Your device | Cable | Works with |
|---|---|---|
| iPad / iPhone with USB-C (iPhone 15+) | Micro-USB to USB-C data cable | Keys iOS app only |
| Older iPad / iPhone with Lightning | Apple Lightning to USB 3 Camera Adapter + micro-USB to USB-A data cable | Keys iOS app only |
| Mac or PC | Micro-USB to USB-C or USB-A data cable | Web app in Chrome or Edge |
| Android | Micro-USB to USB-C data cable (USB OTG) | Web app in Chrome |
| Safari, any device | — | Not possible (no Web MIDI); use the microphone |

- **Use a data cable.** Many cheap micro-USB cables are charge-only and show nothing. If the keyboard isn't detected, try another cable first.
- **Power the keyboard itself** (mains adapter or batteries). With the camera adapter, plug a charger into its power port if the iPad says the accessory needs too much power.
- Turn the keyboard on before or after plugging in; if no notes arrive, unplug and replug. It still plays through its own speakers.
- Then choose **Settings → Input → USB keyboard**. **Tools → Mic check** shows notes as you play.
- WebKit has no Web MIDI, so no browser on iPhone/iPad can read a keyboard. On iPhone/iPad, see [iOS app](ios/README.md).
- Bluetooth MIDI (for example Casio's WU-BT10 adapter on some CT-S models) isn't supported yet.

## Stack

Vite + TypeScript, no UI framework. Canvas for the falling notes, Web Audio for sound
and pitch detection, localStorage for progress. Hash routing, so it works under any
GitHub Pages path.
