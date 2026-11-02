/* Todo Studio – Offline-Hülle: Die Oberfläche öffnet sich auch ohne Netz (Daten dann vom letzten Stand). */
const VERSION = 'studio-v40-scharf';
const DATEIEN = ['./', 'index.html', 'style.css', 'studio.js', 'push.js', 'weckwort.js', 'jarvis.js', 'dateien.js', 'hud.js', 'wolke.js', 'globus.js', 'erde-maske.png', 'planer.js', 'demo.js', 'demo-zentrale.js', 'demo-katalog.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-180.png'];

self.addEventListener('install', (e) => {
  // Einzeln zwischenspeichern: fehlt eine Datei (z. B. ein Icon), scheitert nicht die ganze Offline-Hülle
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(DATEIEN.map((f) => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
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
    // „no-cache“: beim Server nachfragen, ob es eine neuere Fassung gibt (sonst hält der Browser alte Dateien fest)
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      const kopie = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, kopie));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

// Web-Push von der Zentrale (Erinnerungen von MO) – erscheint auch, wenn das Studio geschlossen ist
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { text: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titel || 'MO', {
    body: d.text || 'Neue Meldung von MO.', tag: d.tag || undefined, renotify: !!d.tag,
    icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || self.registration.scope }
  }));
});

// Tippen auf die Benachrichtigung: offenes Studio nach vorn holen, sonst öffnen
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ziel = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
    const offen = fenster.find((f) => f.url.startsWith(self.registration.scope));
    return offen ? offen.focus() : self.clients.openWindow(ziel);
  }));
});
