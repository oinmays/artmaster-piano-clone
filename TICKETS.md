# Ticket board

The live board is GitHub Issues on this repo, milestone **MVP 1**, with labels
`status:todo` / `status:in-progress` / `status:done`. This file mirrors it.

| # | Ticket | Owner | Files (exclusive) | Status |
|---|---|---|---|---|
| T0 | Core shell and shared contracts | lead | `index.html`, `src/main.ts`, `src/core/**`, `src/styles/**` | done |
| T1 | Recon of artmaster.com/Artie with rea | lead | `docs/recon.md` | done |
| T2 | Song library content, Home / Library / Song / Progress screens | agent-songs | `src/songs/**`, `src/screens/{home,library,song,progress}.ts` | done |
| T3 | Falling-notes player, scoring, results | agent-player | `src/player/**`, `src/screens/{player,results}.ts`, `tests/scoring.test.ts` | done |
| T4 | Mic pitch detection, Web MIDI, Tuner, Settings | agent-listen | `src/listen/**`, `src/screens/{tuner,settings}.ts`, `tests/pitch.test.ts` | done |
| T5 | Tools hub, Metronome, Chord Finder | agent-tools | `src/screens/{tools,metronome,chords}.ts` | done |
| T6 | PWA: manifest, icons, offline service worker, GitHub Pages deploy | lead | `public/**`, `scripts/**`, `.github/**` | done |
| T7 | Integration and QA at iPhone / iPad sizes | lead | any | done |

## MVP 1.1 Songs

Milestone **MVP 1.1 Songs**. Keys only ships public-domain music.

| # | Ticket | Owner | Files (exclusive) | Status |
|---|---|---|---|---|
| T8 | Row, Row, Row Your Boat (6/8, Lyte 1881) | agent-songs | `src/songs/catalog.ts`, optional `meter` on `Song` | done |
| T9 | Incy Wincy Spider (6/8, traditional) | agent-songs | `src/songs/catalog.ts` | done |
| T10 | Lush Life (Zara Larsson, 2015) | — | none | todo · blocked:licence (copyrighted; can't ship, but now playable via T21: the learner loads a MIDI file they own, stored on device only) |

## MVP 1.2 Real piano input

Milestone **MVP 1.2 Real piano input**. First real-keyboard test (iPad on the music stand, mic on) registered no notes.

| # | Ticket | Owner | Files | Status |
|---|---|---|---|---|
| T11 | Mic check screen, live mic level + heard note in the player, "Accept any octave" (#12) | v1 | `src/screens/miccheck.ts`, `src/player/octave.ts`, `src/listen/**`, player, settings | done (53e6b38), awaiting real-piano check |
| T12 | Wire Web MIDI into the player: 'midi' input mode, auto-connect + hot-plug, "MIDI: <device>" indicator, exact octave, MIDI section in Mic check; same path takes the iOS app's bridge (#13) | v3 | `src/listen/midi.ts`, `src/listen/index.ts`, `src/core/store.ts`, `src/screens/{player,settings,miccheck}.ts`, `tests/midi.test.ts` | done (dfe1413), awaiting real-keyboard check |
| T13 | Platform detection + honest messaging: iPhone/iPad browsers can't read MIDI, say so and point to the iOS app or Chrome/Edge (#14) | v3 | `src/listen/platform.ts`, `tests/platform.test.ts` (UI via T12) | done (dfe1413), awaiting real-keyboard check |
| T14 | Native iOS shell (WKWebView + CoreMIDI bridge), Simulator build, install-with-Xcode guide (#15) | v3 | `ios/**` | code in (8b64dcd), not yet compiled: Xcode licence unaccepted on the build Mac |
| T15 | Cable and setup guide: Tools → Connect a keyboard + README (#16) | v3 | `src/screens/keyboardguide.ts`, route in `src/main.ts`, card in `src/screens/tools.ts`, `README.md` | done (dfe1413), awaiting real-keyboard check |
| T16 | Mic sensitivity setting in the engine: `micSensitivity` 0–100 → one threshold factor, default 0.75 (gate 2.5× → 1.875× floor, minRms 0.0008 → 0.0006), one source of truth, live updates (#17) | v4 | `src/listen/**`, `src/core/store.ts`, `tests/sensitivity.test.ts` | done (6b36ddd), awaiting real-piano check |
| T17 | Sensitivity slider under the meter on Mic check (yellow line moves live) and in Settings → Listening with Reset to default (#18) | v4 | `src/screens/miccheck.ts`, `src/screens/settings.ts` | done (be93ee5), awaiting real-piano check |
| T18 | Wider mic sensitivity range: more sensitive top end, default unchanged, hum/noise still rejected (#19) | v4-t18 | `src/listen/sensitivity.ts`, `src/listen/pitch.ts`, `tests/sensitivity.test.ts` | done (7f5abdf), awaiting real-piano check |

Sequence: T12 + T13 ship first (keyboard works in Chrome/Edge on Mac/PC/Android, honest message on iPad), T15 ships with them, T14 follows (the only route on iPad/iPhone, because WebKit has no Web MIDI).

T16 + T17 follow the first iPad test, where the mic heard the right notes only when the keyboard was very loud. They run in parallel on separate files against the agreed `micSensitivity` setting.

T18 widens the top of the range (`src/listen/sensitivity.ts`). The bottom half and the default are unchanged; above 50 the factor falls faster, with the floor-relative gate clamped at 1.2× and the chord SNR at 3:

| Slider | Factor before → after | Gate × floor before → after | minRms before → after | Chord minSnr before → after |
|---|---|---|---|---|
| 0 | 1.125 → 1.125 | 2.81 → 2.81 | 0.00090 → 0.00090 | 5.30 → 5.30 |
| 15 | 1.00 → 1.00 | 2.49 → 2.49 | 0.00080 → 0.00080 | 4.99 → 4.99 |
| 50 (default) | 0.75 → 0.75 | 1.875 → 1.875 | 0.00060 → 0.00060 | 4.33 → 4.33 |
| 75 | 0.61 → 0.47 | 1.53 → 1.20 | 0.00049 → 0.00038 | 3.91 → 3.44 |
| 100 | 0.50 → 0.30 | 1.25 → 1.20 | 0.00040 → 0.00024 | 3.54 → 3.00 |

## MVP 1.3 Fingers, songs, versions

Milestone **MVP 1.3 Fingers, songs, versions**. Requested after the first sensitivity build. Commercial songs (21 Questions, Many Men, Lush Life, Dancing in the Dark, Nose on the Grindstone, Lonely, Love Yourself, Baby) can't ship in this public repo, so T21 lets a learner load their own MIDI file, kept on the device only.

| # | Ticket | Owner | Files | Status |
|---|---|---|---|---|
| T19 | Finger numbers (1 thumb … 5 little finger) on falling notes and target keys, auto-fingered, Settings toggle (#20) | t19 | `src/player/fingering.ts`, `tests/fingering.test.ts`, player/lane/keyboard rendering, `src/core/store.ts`, Settings → Display | done (621653f) |
| T20 | Version, build date/time and commit in Settings; changelog screen generated from git history at build (#21) | v4-t18 | `vite.config.ts`, `.github/workflows/deploy.yml`, `src/screens/changelog.ts`, route in `src/main.ts`, Settings footer, `sw/sw.js` | done (f714bc4) |
| T21 | Load your own song: MIDI file import, on device only, "My songs" in the library (#22) | t21 | `src/songs/midifile.ts`, `src/songs/mine.ts`, `tests/midifile.test.ts`, library screen | done (4403328) |
| T22 | 6–8 more public-domain songs (#23): Aura Lee, Silent Night, Brahms' Lullaby, Auld Lang Syne, Scarborough Fair, The Entertainer | t22 | `src/songs/catalog.ts` | done (5007aa1) |

T19–T22 run as parallel chats in separate worktrees; each rebases on origin/main, passes typecheck/test/build, pushes to main and watches the deploy.

## Definition of done (every ticket)

- `npm run typecheck` and `npm test` pass.
- Works in a 390×844 (iPhone) and 1180×820 (iPad landscape) viewport.
- Touch targets ≥ 44px, respects safe-area insets, no horizontal page scroll.
- Only touches the files listed for that ticket. Changes to `src/core/**` go through T0.

## Out of scope for MVP 1 (candidates for MVP 2)

- "Ask Artie"-style AI chat (needs a backend and an LLM key)
- MIDI / MusicXML song import
- Accounts, sync across devices, payments
- Video lessons
