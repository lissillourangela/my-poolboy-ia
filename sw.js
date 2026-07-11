/* My PoolBoy IA — service worker
   Stratégie : cache-first pour les fichiers statiques de l'app,
   avec repli réseau puis mise à jour du cache. */

const CACHE_NAME = "poolboy-ia-v11";
const FICHIERS_A_METTRE_EN_CACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FICHIERS_A_METTRE_EN_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((noms) =>
      Promise.all(noms.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((reponseCache) => {
      if (reponseCache) return reponseCache;
      return fetch(event.request)
        .then((reponseReseau) => {
          const clone = reponseReseau.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return reponseReseau;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
