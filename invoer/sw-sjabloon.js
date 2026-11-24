// Service worker: maakt het openen van de app mogelijk zonder verbinding.
// Alleen de app zelf wordt bewaard; gegevens lopen via de app (IndexedDB).
// De bestandenlijst en de versie worden bij het bouwen ingevuld (vite.config.ts).
const BESTANDEN = __BESTANDEN__;
const CACHE = "invoer-" + __VERSIE__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/invoer/", ...BESTANDEN])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("invoer-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || e.request.headers.has("authorization")) return;
  // Alleen vooraf bekende statische buildbestanden; geen dynamische antwoorden,
  // querystrings of API-data, ook niet wanneer een toekomstig pad /invoer/ bevat.
  if (url.search) return;
  if (e.request.mode === "navigate" && ["/invoer/","/invoer/index.html"].includes(url.pathname)) {
    e.respondWith(fetch(e.request).catch(async () => (await caches.open(CACHE)).match("/invoer/")));
    return;
  }
  if (!BESTANDEN.includes(url.pathname)) return;
  e.respondWith((async () => (await caches.open(CACHE)).match(url.pathname) || fetch(e.request))());
});
