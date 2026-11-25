// Self-unregistering service worker to cleanly retire any previously installed PWA worker
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  self.registration.unregister();
});
