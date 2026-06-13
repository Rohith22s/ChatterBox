self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
    // Basic pass-through fetch to satisfy PWA requirements
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
