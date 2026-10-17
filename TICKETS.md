# Ticket board: MVP 1

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
