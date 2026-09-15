const CACHE_NAME = 'inventario-vial-v3';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './jszip.min.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: siempre intenta traer la versión más nueva del servidor y
// actualiza el caché con ella. Si no hay conexión, recién ahí usa el caché.
// (Antes era 'cache-first', lo que hacía que las actualizaciones subidas a
// GitHub Pages nunca se reflejaran en el celular una vez que la app había
// cacheado la primera versión — ese era el bug.)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
