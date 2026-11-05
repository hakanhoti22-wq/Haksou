// Service worker : l'appli s'ouvre même sans réseau (les données Supabase restent en ligne).
const C = 'haksou-pro-v3';
const SHELL = ['./', './index.html', './css/app.css', './manifest.webmanifest', './icon-192.png',
  './js/app.js', './js/db.js', './js/pdf.js', './js/punch.js', './js/monitor.js', './js/help.js', './vendor/jspdf.umd.min.js', './vendor/supabase.js', './js/config.js', './js/seed.js', './js/meta.js', './js/utils.js',
  ...['accueil', 'pointage', 'conges', 'planning', 'interventions', 'factures', 'clients', 'stock', 'frais', 'equipe', 'reglages', 'console'].map(m => `./js/modules/${m}.js`)];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('haksou-pro-') && k !== C).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Supabase et CDN : toujours le réseau
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
