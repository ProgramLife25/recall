// Auto-purge old caches and unregister
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network first, bypass cache
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
