// â”€â”€ Billware Service Worker â”€â”€
// IMPORTANT: Change CACHE_NAME on every deploy so installed apps get the latest version
const CACHE_NAME = 'mm-pakkam-v239';

// Pages and assets to cache for offline use + instant navigation
const PRECACHE_URLS = [
    '/',
    '/login.html',
    '/index.html',
    '/purchase.html',
    '/sales.html',
    '/report.html',
    '/customer.html',
    '/doctor.html',
    '/setup.html',
    '/manage-users.html',
    '/schedule-h.html',
    '/khata.html',
    '/inventory.html',
    '/directory.html',
    '/shop-setup.html',
    '/js/auth.js',
    '/js/supabase.js',
    '/js/modal.js',
    '/js/keyboard-nav.js',
    '/js/notifications.js',
    '/js/thermal-print.js',
    '/js/drug-master.js',
    '/js/substitutes.js',
    '/js/ocr-preprocess.js',
    '/js/combo.js',
    '/js/tally-export.js',
    '/icon-192.png',
    '/icon-512.png',
    '/manifest.json',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// â”€â”€ Install: pre-cache all core files â”€â”€
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Pre-caching core files');
            // Cache individually so one failure doesn't block all
            return Promise.allSettled(
                PRECACHE_URLS.map(url => cache.add(url).catch(() => {}))
            );
        }).then(() => self.skipWaiting()) // Force activate immediately
    );
});

// â”€â”€ Activate: remove ALL old caches so app gets fresh files â”€â”€
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log('[SW] Deleting old cache:', key);
                        return caches.delete(key);
                    })
            )
        ).then(() => {
            console.log('[SW] Claiming all clients â€” new version active');
            return self.clients.claim(); // Take over all tabs immediately
        })
    );
});

// â”€â”€ Fetch handler â”€â”€
// Strategy:
//   â€¢ Supabase API  â†’ ALWAYS network-first (live data must never be stale)
//   â€¢ Everything else (pages, JS, CSS, images, CDN libs) â†’ STALE-WHILE-REVALIDATE:
//     serve the cached copy instantly (0 ms â€” this is what makes navigation feel
//     native), and fetch a fresh copy in the background for the next load.
//     New deploys still arrive automatically: the browser re-checks sw.js on
//     navigation, the bumped CACHE_NAME re-caches everything, and the pages'
//     `controllerchange` listeners reload them onto the new version.
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Always network-first for Supabase API endpoints (but NOT the library CDN)
    if (url.hostname.includes('supabase.co')) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response(JSON.stringify({ error: 'offline' }), {
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    // Never try to cache non-GET requests (Cache API only supports GET)
    if (event.request.method !== 'GET') return;

    // Stale-while-revalidate for everything else
    event.respondWith(
        caches.open(CACHE_NAME).then(cache =>
            cache.match(event.request).then(cached => {
                // Kick off a background refresh regardless of cache hit
                const networkFetch = fetch(event.request)
                    .then(response => {
                        // Only cache good, cacheable responses
                        if (response && (response.ok || response.type === 'opaque')) {
                            cache.put(event.request, response.clone()).catch(() => {});
                        }
                        return response;
                    })
                    // Offline: fall back to cache. On a cache miss there is
                    // nothing to fall back to, and handing respondWith undefined
                    // throws "Failed to convert value to 'Response'" instead of
                    // failing the request cleanly.
                    .catch(() => cached || new Response('Offline', {
                        status: 503,
                        statusText: 'Offline',
                        headers: { 'Content-Type': 'text/plain' }
                    }));

                // Cache hit â†’ instant response; miss â†’ wait for network
                return cached || networkFetch;
            })
        )
    );
});

// â”€â”€ Message handler: force skip waiting when told by the page â”€â”€
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
