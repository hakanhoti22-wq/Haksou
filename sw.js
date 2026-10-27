// Service worker : l'interface fonctionne hors ligne, la traduction passe par le réseau.
const CACHE = 'haksou-v14';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'languages.js',
  'translator.js',
  'speech.js',
  'recorder.js',
  'stt.js',
  'tts.js',
  'audio.js',
  'api.js',
  'account.js',
  'config.js',
  'privacy.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fichiers de l'app : réseau d'abord (mises à jour immédiates), cache en secours.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // « no-cache » : toujours vérifier auprès du serveur, pour recevoir les mises à jour tout de suite.
  event.respondWith(
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
