/**
 * Connect a keyboard (`#/tools/keyboard`): plain-language guide to plugging a USB/MIDI
 * keyboard into Keys, with an honest "On this device" status at the top (T15).
 */
import type { Screen } from '../core/types';
import { midiHelp, midiPlatform } from '../listen/platform';

const IOS_APP_URL = 'https://github.com/oinmays/artmaster-piano-clone#ios-app';

const CSS = `
.kg { max-width: 820px; }
.kg-status { border-left: 4px solid var(--warn); }
.kg-status[data-ok='true'] { border-left-color: var(--good); }
.kg-status h2 { margin-bottom: 0.375rem; }
.kg-status .row { margin-top: 0.75rem; }
.kg-sec { margin-top: 1rem; }
.kg-sec h2 { margin-bottom: 0.5rem; }
.kg-list { margin: 0; padding-left: 1.1rem; line-height: 1.55; }
.kg-list li { margin-bottom: 0.375rem; }
.kg-list li:last-child { margin-bottom: 0; }
.kg-table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; line-height: 1.45; }
.kg-table th, .kg-table td { text-align: left; vertical-align: top; padding: 0.625rem 0.75rem 0.625rem 0;
  border-bottom: 1px solid var(--surface-3); }
.kg-table th { font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); font-weight: 500; }
.kg-table tr:last-child td { border-bottom: 0; }
.kg-yes { color: var(--good); font-weight: 600; }
.kg-no { color: var(--warn); font-weight: 600; }
@media (max-width: 640px) {
  .kg-table thead { display: none; }
  .kg-table, .kg-table tbody, .kg-table tr, .kg-table td { display: block; width: 100%; }
  .kg-table tr { padding: 0.625rem 0; border-bottom: 1px solid var(--surface-3); }
  .kg-table tr:last-child { border-bottom: 0; }
  .kg-table td { border: 0; padding: 0.125rem 0; }
  .kg-table td::before { content: attr(data-label); display: block; font-size: 0.6875rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--text-muted); margin-top: 0.375rem; }
  .kg-table td:first-child { font-weight: 600; }
  .kg-table td:first-child::before { display: none; }
}
.kg p:last-child { margin-bottom: 0; }
`;

const ROWS: { device: string; cable: string; works: string; ok: boolean }[] = [
  {
    device: 'iPad or iPhone with USB-C (iPhone 15 or later)',
    cable: 'Micro-USB to USB-C data cable',
    works: 'Keys iOS app only',
    ok: true,
  },
  {
    device: 'Older iPad or iPhone with Lightning',
    cable: 'Apple Lightning to USB 3 Camera Adapter + micro-USB to USB-A data cable',
    works: 'Keys iOS app only',
    ok: true,
  },
  {
    device: 'Mac or PC',
    cable: 'Micro-USB to USB-C or USB-A data cable (whichever port you have)',
    works: 'Keys web app in Chrome or Edge',
    ok: true,
  },
  {
    device: 'Android phone or tablet',
    cable: 'Micro-USB to USB-C data cable (needs USB OTG, which most have)',
    works: 'Keys web app in Chrome',
    ok: true,
  },
  {
    device: 'Safari on any device',
    cable: 'Any',
    works: 'Not possible: Safari has no MIDI. Use the microphone.',
    ok: false,
  },
];

const screen: Screen = (root) => {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const platform = midiPlatform();
  const help = midiHelp(platform);
  const statusActions =
    platform === 'ios-browser'
      ? `<a class="btn btn--primary" href="${IOS_APP_URL}" target="_blank" rel="noopener">About the iOS app</a>
         <a class="btn" href="#/tools/mic">Use the microphone</a>`
      : help.ok
        ? `<a class="btn btn--primary" href="#/settings">Settings</a>
           <a class="btn" href="#/tools/mic">Mic check</a>`
        : `<a class="btn" href="#/tools/mic">Use the microphone</a>`;

  root.innerHTML = `
  <section class="screen kg">
    <a class="btn btn--ghost btn--sm" href="#/tools" style="padding-left:0">‹ Tools</a>
    <p class="eyebrow" style="margin-top:0.5rem">Tools</p>
    <h1>Connect a keyboard</h1>
    <p class="muted">Plug your keyboard into Keys with a USB cable instead of using the microphone.</p>

    <div class="card kg-status" data-ok="${help.ok}" role="status">
      <p class="eyebrow">On this device</p>
      <h2>${help.title}</h2>
      <p class="muted">${help.body}</p>
      <div class="row">${statusActions}</div>
    </div>

    <div class="card kg-sec">
      <h2>Why use a cable</h2>
      <ul class="kg-list">
        <li><b>Exact notes.</b> The keyboard says which key you pressed. No guessing from sound.</li>
        <li><b>Almost no delay</b>, so timing scores are fairer.</li>
        <li><b>No room noise.</b> Talking, the TV or a dog barking can't count as notes.</li>
        <li><b>No octave mix-ups.</b> C4 is always C4.</li>
      </ul>
    </div>

    <div class="card kg-sec">
      <h2>What works where</h2>
      <table class="kg-table">
        <thead><tr><th scope="col">Your device</th><th scope="col">Cable</th><th scope="col">Works with</th></tr></thead>
        <tbody>
          ${ROWS.map(
            (r) => `<tr>
              <td data-label="Your device">${r.device}</td>
              <td data-label="Cable">${r.cable}</td>
              <td data-label="Works with"><span class="${r.ok ? 'kg-yes' : 'kg-no'}">${r.works}</span></td>
            </tr>`,
          ).join('')}
        </tbody>
      </table>
    </div>

    <div class="card kg-sec">
      <h2>The cable</h2>
      <ul class="kg-list">
        <li><b>It must be a data cable.</b> Many cheap micro-USB cables only charge and carry no data. If the keyboard
          isn't detected, try a different cable first.</li>
        <li><b>Keyboard end:</b> micro-USB (Micro-B), into the port marked "USB to Host" on the back.</li>
        <li><b>Device end:</b> USB-C for USB-C iPads, iPhone 15 or later, most Android and newer Macs and PCs.
          USB-A for older Macs and PCs.</li>
        <li><b>Lightning iPhone or iPad:</b> Apple's "Lightning to USB 3 Camera Adapter" (the one with a power port),
          plus a normal micro-USB to USB-A data cable.</li>
        <li>A short cable (1 to 2 m) is fine. Avoid chaining several adapters if you can.</li>
      </ul>
    </div>

    <div class="card kg-sec">
      <h2>Power</h2>
      <ul class="kg-list">
        <li>Run the keyboard on its own power: the mains adapter or batteries. A phone or iPad can't reliably power it.</li>
        <li>With the camera adapter, if the iPad says the accessory "needs too much power", plug a charger into the
          adapter's power port.</li>
      </ul>
    </div>

    <div class="card kg-sec">
      <h2>The keyboard</h2>
      <ul class="kg-list">
        <li>Portable keyboards with a "USB to Host" port (such as the Casio Casiotone CT-S range) are USB-MIDI class
          compliant. No driver or app is needed.</li>
        <li>Turn it on before or after plugging in, either works. If no notes arrive, unplug and plug back in.</li>
        <li>The keyboard still plays through its own speakers as normal.</li>
      </ul>
    </div>

    <div class="card kg-sec">
      <h2>Then</h2>
      <ul class="kg-list">
        <li><b>iPad or iPhone:</b> use the <a href="${IOS_APP_URL}" target="_blank" rel="noopener">Keys iOS app</a>.
          It's installed from a Mac with Xcode for now, not from the App Store.</li>
        <li><b>Mac or PC:</b> open Keys in Chrome or Edge and allow MIDI devices when asked.</li>
        <li><b>Android:</b> open Keys in Chrome and allow MIDI devices when asked.</li>
        <li>In <b>Settings → Input</b>, choose <b>USB keyboard</b>.</li>
        <li><b>Tools → Mic check</b> shows each note as you play, so you can confirm it works.</li>
      </ul>
      <div class="row" style="margin-top:0.75rem">
        <a class="btn" href="#/settings">Settings</a>
        <a class="btn" href="#/tools/mic">Mic check</a>
      </div>
    </div>

    <div class="card kg-sec">
      <h2>If nothing happens</h2>
      <ul class="kg-list">
        <li>Try another cable. A charge-only cable is the most common cause.</li>
        <li>Check the cable is in the keyboard's "USB to Host" port, not a USB stick or audio port.</li>
        <li>Unplug, wait a few seconds, plug back in, then reload Keys.</li>
        <li>On a Mac or PC, check you're in Chrome or Edge, not Safari, and that MIDI wasn't blocked
          (the site settings icon in the address bar).</li>
        <li>On iPad or iPhone, a browser can't do it. You need the Keys iOS app.</li>
        <li>Still stuck? The microphone works on every device.</li>
      </ul>
    </div>

    <div class="card kg-sec">
      <h2>Bluetooth?</h2>
      <p class="muted">Some keyboards can do Bluetooth MIDI with an optional adapter (for example Casio's WU-BT10 for
        some CT-S models). Keys doesn't support Bluetooth yet. It may come later.</p>
    </div>
  </section>`;

  return () => style.remove();
};

export default screen;
