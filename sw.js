const BASE = new URL('./', self.registration.scope).pathname;
const CACHE_NAME = 'yt-offline-player-v1';
const PROXY_CACHE_NAME = 'proxy-cache-v1';
const PROXY_HOST = 'are-silence-3d13.amogus6666zx.workers.dev';
const STATIC_ASSETS = [
    BASE,
    BASE + 'index.html',
    BASE + 'style.css',
    BASE + 'manifest.json',
    BASE + 'sw.js'
];

const OFFLINE_VIDEO_PREFIX = '/offline-video/';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            for (const url of STATIC_ASSETS) {
                try {
                    const resp = await fetch(url);
                    if (resp.ok) {
                        await cache.put(url, resp);
                    } else {
                        console.warn(`[SW] Пропущен ${url}: статус ${resp.status}`);
                    }
                } catch (e) {
                    console.warn(`[SW] Пропущен ${url}:`, e.message);
                }
            }
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME && name !== PROXY_CACHE_NAME)
                        .map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

async function handleProxyRequest(request) {
    const cache = await caches.open(PROXY_CACHE_NAME);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (e) {
        return new Response('Proxy fetch failed', { status: 502 });
    }
}

async function handleStaticRequest(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
        const fetchPromise = fetch(request).then((networkResponse) => {
            if (networkResponse.ok) {
                cache.put(request, networkResponse.clone());
            }
            return networkResponse;
        }).catch(() => cachedResponse);
        
        return cachedResponse;
    }
    
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        return new Response('Offline', { status: 503 });
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    if (request.method !== 'GET') return;
    
    if (!url.protocol.startsWith('http')) return;
    
    if (url.hostname === PROXY_HOST) {
        event.respondWith(handleProxyRequest(request));
        return;
    }
    
    if (url.origin !== self.location.origin) return;
    
    event.respondWith(handleStaticRequest(request));
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});