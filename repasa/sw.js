// Repasa service worker: keeps the app shell for offline start. Data (Drive, Gemini) always goes to the network.
const CACHE = "repasa-v2";
const SHELL = ["./", "index.html", "estilos.css?v=2", "drive.js?v=2", "datos.js?v=2", "ia.js?v=2", "app.js?v=2", "icono.svg", "manifest.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // Network first so updates arrive at once; cache when offline.
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: false }).then(r => r || caches.match("index.html"))));
});
