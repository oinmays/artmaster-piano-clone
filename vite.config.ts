import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Emits dist/sw.js with every built file in its precache list, so the app works offline. */
function serviceWorker(): Plugin {
  return {
    name: 'keys-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      // Skip source maps, legacy .woff and non-Latin font subsets (fetched on demand if ever needed).
      const files = Object.keys(bundle).filter(
        (f) => !f.endsWith('.map') && !f.endsWith('.woff') && !(f.endsWith('.woff2') && !/-latin-\d/.test(f)),
      );
      const precache = ['./', ...files.map((f) => `./${f}`), './manifest.webmanifest',
        './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png'];
      const version = Date.now().toString(36);
      const source = readFileSync('sw/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// GitHub Pages serves the app from /<repo>/, so build with a relative base.
export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node' },
} as never);
