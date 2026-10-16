# Recon: artmaster.com / Artie

Captured 2026-10-17 with [`rea`](https://github.com/morluto/rea) 6.5.0 (`npx rea-agents`)
against a disposable headless Chrome on a loopback CDP port, plus plain HTML fetches.

Commands run:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9333 --user-data-dir=<scratch>/rea-profile https://www.artmaster.com/artie
npx rea-agents list-browser-targets http://127.0.0.1:9333
npx rea-agents inspect-web-page   http://127.0.0.1:9333 <target> --observation-ms 2000 --include-accessibility-text
npx rea-agents analyze-web-bundle http://127.0.0.1:9333 <target> --observation-ms 2000
npx rea-agents capture-web-screenshot http://127.0.0.1:9333 <target>
```

Screenshot: [`rea-artie-capture.png`](rea-artie-capture.png).

## What the product is

ArtMaster has two products:

1. **ArtMaster courses**: about 450 pre-recorded video lessons across piano, guitar,
   singing, production and more. Membership is $94.80/yr. There are also free web tools:
   Tuner, Metronome, Chord Finder.
2. **Artie**: an AI piano teacher (iOS app, 500k+ downloads), described on the
   `/artie` page as:
   - follow **falling notes**, no sheet music needed
   - **listens through the microphone** (or MIDI) and gives real-time feedback
   - song library with **three difficulty levels**; import your own MIDI/MusicXML
   - **slow the tempo, practise hands separately, loop a section**
   - **Wait Mode**: the music waits for you to play the right note
   - songs broken into sections, building up to both hands
   - **after each session:** breakdown of rhythm, accuracy and overall performance
   - "Ask Artie": a chat for theory/technique questions
   - Pricing: 30+ free songs and 3 MIDI imports; then $34.99/mo or $149.99/yr

"ArtMaster Piano Clone" therefore targets **Artie's practice loop plus the three web
tools**. The video courses are copyrighted media and are out of scope.

## Site architecture (from `analyze-web-bundle`)

- Angular SPA with build-hashed chunks (`main-*.js`, `chunk-*.js`, `polyfills-*.js`),
  SSR transfer state (`_transferStateService.fetch`), and Bootstrap 5 CSS.
- Routes: `/`, `all-courses`, `course/:courseSlug`, `bundle/:bundleSlug`, `artie`,
  `artie/onboarding`, `artie/voucher`, `practice-room`, `tools`, `dashboard`,
  `membership`, `voucher`, `verify/:hash`, `auth`.
- GraphQL operations: `doSignIn`, `doSignup`, `loadMe`, `saveMe`, `dashboardData`,
  `userSubscriptionCoursesData`, `doLogVideoEvent`, `welcomeSurvey`,
  `submitQuestionnaire`, `certificateVerify`, Stripe setup intents, vouchers.
- No WebMCP declarations, no service worker, and no web app manifest were observed, so the
  website itself is not installable. The practice experience lives in the native iOS app.

## Visual system (from `styles-*.css`)

| Token | Value | Use |
|---|---|---|
| Background | `#151514`, `#282826`, `#343431` | Charcoal surfaces |
| Border | `#4C4C47` | Hairlines |
| Accent | `#FE5826` | Primary buttons, links |
| Beige | `#E5D7C9`, `#B49A81` | Headings, muted text |
| Mint | `#23E7B9` | Success |
| Yellow | `#F6C810` | Warning |
| Red | `#EE374D` | Error |
| Fonts | Inter (body), Recoleta (serif display) | Recoleta is commercial, so the clone uses Fraunces |
| Radius | `.375rem` buttons, `1rem` cards | |

## Clone decisions

- Product name **"Keys"**. It does not reuse the ArtMaster/Artie names, logo or teacher
  likenesses.
- Songs are public-domain pieces transcribed by hand. Nothing is copied from Artie's library.
- iOS Safari has no Web MIDI, so on iPhone/iPad the microphone is the only "listening"
  input. Web MIDI is enabled where the browser supports it.
