self.addEventListener('install', e => self.skipWaiting())
self.addEventListener('activate', e => clients.claim())
// Pas de cache — on veut toujours les notes fraîches
self.addEventListener('fetch', e => e.respondWith(fetch(e.request)))