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

## Stack

Vite + TypeScript, no UI framework. Canvas for the falling notes, Web Audio for sound
and pitch detection, localStorage for progress. Hash routing, so it works under any
GitHub Pages path.
