# iOS app

A minimal native shell around the Keys web app, so a USB MIDI keyboard works on iPhone and iPad.

## Why it exists

Every browser on iPhone and iPad is WebKit underneath, and WebKit has no Web MIDI API. Safari,
Chrome for iOS and the home-screen app all run the same engine, so none of them can see a
keyboard, whatever cable you use. A native app can read MIDI through CoreMIDI, so this app does
that and hands the notes to the web page.

## What it does

- Shows the live site (https://oinmays.github.io/artmaster-piano-clone/) full screen in a
  WKWebView. Web updates arrive without rebuilding the app.
- Connects every CoreMIDI source (USB keyboards, plus network and virtual sources), reconnecting
  when a device is plugged in or unplugged.
- Bridges notes into the page using the contract in `src/listen/platform.ts`:
  - at document start: `window.keysNative = { platform: 'ios', midi: true, devices: [...], version }`
  - each MIDI message: a `keysnative:midi` event with `{ data: [status, d1, d2], device }`
  - device changes (and after every page load): `keysNative.devices` is updated and a
    `keysnative:devices` event with `{ names }` is dispatched.
- Allows the microphone for the site itself, so mic mode still works (iOS asks once).
- Adds `KeysApp/<version>` to WebKit's normal user agent.

Bluetooth MIDI isn't supported yet. It needs a pairing screen
(`CABTMIDICentralViewController`) and is a follow-up.

## Put it on your own iPad or iPhone (free Apple ID)

You need a Mac with Xcode and the device's cable.

1. Open `ios/Keys.xcodeproj` in Xcode. (If Xcode asks you to agree to its licence or install
   components, do that first. From Terminal: `sudo xcodebuild -license`.)
2. Click the **Keys** project in the left sidebar, then the **Keys** target, then
   **Signing & Capabilities**.
3. Under **Team**, choose **Add an Account…** and sign in with your Apple ID. Then pick your
   "(Personal Team)".
4. Change **Bundle Identifier** from `com.example.keys` to something unique to you, for example
   `com.yourname.keys`. Xcode will refuse to sign the placeholder.
5. Plug the iPad or iPhone into the Mac with the cable. Unlock it and tap **Trust** if asked.
6. On the device, turn on Developer Mode: **Settings → Privacy & Security → Developer Mode**.
   It restarts; confirm when it comes back. (The option appears after the device has been
   connected to Xcode once.)
7. In Xcode's toolbar, pick your device as the run destination and press **Run** (the play button).
8. The first time, iOS blocks the app. On the device go to
   **Settings → General → VPN & Device Management**, tap your developer profile and **Trust** it.
   Then open Keys.

### Free account limits

- The app stops opening after **7 days**. Plug the device in and press Run again to refresh it.
- At most **3** apps signed this way per device at a time.
- A paid Apple Developer Program membership (US$99/year) gives builds that last a year and lets
  you share the app with others through TestFlight.

## Use it

1. Connect the keyboard to the iPad or iPhone with a USB cable (a data cable, not charge-only; you
   may need a USB-C or Lightning adapter).
2. Open Keys and play.
3. To check what's arriving, open **Tools → Mic check**.

## Internet

The app loads the live site, so it needs an internet connection on first launch. The site has an
offline cache (service worker) that should let it open later without a connection, but service
workers inside an app's web view are less dependable than in Safari, so don't count on offline use.

## Developer notes

- `Keys.xcodeproj` is generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen)
  and committed, so you only need XcodeGen if you change the project structure (`cd ios && xcodegen`).
- CLI build for the simulator:
  `xcodebuild -project ios/Keys.xcodeproj -scheme Keys -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build`
- Debug builds enable the Safari Web Inspector (Safari → Develop → your device).
- The icon is the web app's 512 px icon, upscaled to the single-size 1024 icon.
