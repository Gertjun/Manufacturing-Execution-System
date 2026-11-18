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
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !url.pathname.startsWith("/invoer/")) return; // API niet cachen
  if (e.request.mode === "navigate") {
    // Eerst het netwerk (nieuwste versie), anders de bewaarde pagina.
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const kopie = r.clone();
          caches.open(CACHE).then((c) => c.put("/invoer/", kopie));
          return r;
        })
        .catch(() => caches.match("/invoer/")),
    );
    return;
  }
  // Bestanden met een hash in de naam veranderen nooit: eerst uit de cache.
  e.respondWith(
    caches.match(e.request).then(
      (gevonden) =>
        gevonden ||
        fetch(e.request).then((r) => {
          if (r.ok) {
            const kopie = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, kopie));
          }
          return r;
        }),
    ),
  );
});
