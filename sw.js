const CACHE_NAME = 'yt-offline-player-v1';
const VIDEO_CACHE_NAME = 'video-cache-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/manifest.json',
    '/sw.js'
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
                        .filter((name) => name !== CACHE_NAME && name !== VIDEO_CACHE_NAME)
                        .map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

function isOfflineVideoRequest(request) {
    const url = new URL(request.url);
    return url.pathname.startsWith(OFFLINE_VIDEO_PREFIX);
}

function isRangeRequest(request) {
    return request.headers.has('range');
}

function parseVideoKey(pathname) {
    if (!pathname.startsWith(OFFLINE_VIDEO_PREFIX)) return null;
    const key = pathname.slice(OFFLINE_VIDEO_PREFIX.length);
    if (!key) return null;
    return `video-${key}`;
}

async function handleOfflineVideoRequest(request) {
    const cache = await caches.open(VIDEO_CACHE_NAME);
    const url = new URL(request.url);
    const cacheKey = parseVideoKey(url.pathname);
    
    if (!cacheKey) {
        return new Response('Invalid video path', { status: 400 });
    }
    
    const cachedResponse = await cache.match(cacheKey);
    
    if (!cachedResponse) {
        return new Response('Video not found in cache', { status: 404 });
    }
    
    if (isRangeRequest(request)) {
        return handleRangeRequest(cachedResponse, request);
    }
    
    return cachedResponse;
}

async function handleRangeRequest(response, request) {
    const rangeHeader = request.headers.get('range');
    if (!rangeHeader) return response;
    
    let blob;
    try {
        blob = await response.blob();
    } catch (e) {
        console.error('[SW] Failed to read blob:', e);
        return new Response('', { status: 500 });
    }
    
    const totalSize = blob.size;
    const ranges = parseRange(rangeHeader, totalSize);
    
    if (!ranges || ranges.length !== 1) {
        return new Response('', { 
            status: 416, 
            headers: { 'Content-Range': `bytes */${totalSize}` }
        });
    }
    
    const { start, end } = ranges[0];
    const chunkSize = end - start + 1;
    
    const slicedBlob = blob.slice(start, end + 1);
    
    const headers = new Headers(response.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    headers.set('Content-Length', chunkSize.toString());
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Type', response.headers.get('Content-Type') || 'video/mp4');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    
    return new Response(slicedBlob, {
        status: 206,
        statusText: 'Partial Content',
        headers
    });
}

function parseRange(rangeHeader, totalSize) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!match) return null;
    
    let start = parseInt(match[1], 10);
    let end = parseInt(match[2], 10);
    
    if (isNaN(start) && isNaN(end)) return null;
    
    if (isNaN(start)) {
        start = totalSize - end;
        end = totalSize - 1;
    } else if (isNaN(end)) {
        end = totalSize - 1;
    }
    
    if (start > end || start < 0 || end >= totalSize) return null;
    
    return [{ start, end }];
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
    
    if (isOfflineVideoRequest(request)) {
        event.respondWith(handleOfflineVideoRequest(request));
        return;
    }
    
    event.respondWith(handleStaticRequest(request));
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
    
    if (event.data?.type === 'CLEAR_VIDEO_CACHE') {
        event.waitUntil(
            caches.delete(VIDEO_CACHE_NAME)
                .then(() => {
                    event.ports[0]?.postMessage({ success: true });
                })
                .catch(() => {
                    event.ports[0]?.postMessage({ success: false });
                })
        );
    }
    
    if (event.data?.type === 'GET_CACHE_SIZE') {
        event.waitUntil(
            (async () => {
                const cache = await caches.open(VIDEO_CACHE_NAME);
                const keys = await cache.keys();
                let totalSize = 0;
                
                for (const key of keys) {
                    const response = await cache.match(key);
                    if (response) {
                        const blob = await response.blob();
                        totalSize += blob.size;
                    }
                }
                
                event.ports[0]?.postMessage({ size: totalSize });
            })()
        );
    }
});

self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-video-cache') {
        event.waitUntil(syncVideoCache());
    }
});

async function syncVideoCache() {
    console.log('[SW] Background sync triggered');
}