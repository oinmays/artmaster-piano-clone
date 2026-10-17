/* Keys service worker. Generated into dist/sw.js by the build (see vite.config.ts). */
const VERSION = '__VERSION__';
const CACHE = `keys-${VERSION}`;
const PRECACHE = __PRECACHE__;
/**
 * The note model and the audio worker (TensorFlow.js inside), T23: fetched on first use, never
 * precached, and kept across deploys (activate leaves keys-model-* alone). Bump the version only
 * when the model files change; a new worker build replaces the old one by name.
 */
const MODEL_CACHE = 'keys-model-v1';
const isModelAsset = (url) => url.pathname.includes('/models/') || /\/audio\.worker-[^/]*\.js$/.test(url.pathname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' skips the HTTP cache (Pages serves max-age=600), so a fresh worker
      // never precaches the previous build's index.html.
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('keys-') && k !== CACHE && k !== MODEL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Pages: network first so updates arrive, cached shell when offline. 'no-cache' revalidates
  // with the server instead of taking a stale HTTP-cached index.html, so a reload gets a new deploy.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Model files and the audio worker: cache first in the long-lived cache. Storing a new worker
  // build drops the older ones, so the cache holds one copy.
  const url = new URL(req.url);
  if (isModelAsset(url)) {
    event.respondWith(
      caches.open(MODEL_CACHE).then((cache) =>
        cache.match(req, { ignoreSearch: true }).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) {
                const copy = res.clone();
                const worker = /\/audio\.worker-[^/]*\.js$/.test(url.pathname);
                const prune = worker
                  ? cache.keys().then((keys) =>
                      Promise.all(
                        keys
                          .filter((k) => /\/audio\.worker-[^/]*\.js$/.test(new URL(k.url).pathname))
                          .map((k) => cache.delete(k)),
                      ),
                    )
                  : Promise.resolve();
                event.waitUntil(prune.then(() => cache.put(req, copy)));
              }
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // Hashed assets: cache first.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
