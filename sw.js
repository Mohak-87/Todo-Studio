/* Todo Studio – Offline-Hülle: Die Oberfläche öffnet sich auch ohne Netz (Daten dann vom letzten Stand). */
const VERSION = 'studio-v7-bau';
const DATEIEN = ['./', 'index.html', 'style.css', 'studio.js', 'jarvis.js', 'wolke.js', 'planer.js', 'demo.js', 'demo-zentrale.js', 'demo-katalog.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== VERSION).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Google-Skript, Zentrale und Fremdserver nie zwischenspeichern (Three.js lädt der Browser selbst)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Erst Netz (damit Updates sofort ankommen), sonst Zwischenspeicher
  e.respondWith(
    fetch(e.request).then((res) => {
      const kopie = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, kopie));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
