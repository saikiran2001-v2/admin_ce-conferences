// Admin portal service worker — network-first, never caches API calls
const CACHE_NAME = 'ceconf-admin-v1';

const SHELL_URLS = [
    './index.html',
    './manifest.json',
    './assets/images/favicon.png',
    './assets/images/icon-192.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never intercept non-GET or cross-origin requests
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

    // Never cache /api/* — always go to network
    if (url.pathname.startsWith('/api/')) return;

    // For navigation (the shell HTML) — network first, fall back to cache
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // For static shell assets — cache first, refresh in background
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request).then((response) => {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            });
            return cached || fetchPromise;
        })
    );
});
