// ── Billware Service Worker ──
// IMPORTANT: Change CACHE_NAME on every deploy so installed apps get the latest version
const CACHE_NAME = 'mm-pakkam-v107';

// Pages and assets to cache for offline use
const PRECACHE_URLS = [
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
    '/js/auth.js',
    '/js/supabase.js',
    '/icon-192.png',
    '/icon-512.png',
    '/manifest.json',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ── Install: pre-cache all core files ──
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

// ── Activate: remove ALL old caches so app gets fresh files ──
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
            console.log('[SW] Claiming all clients — new version active');
            return self.clients.claim(); // Take over all tabs immediately
        })
    );
});

// ── Fetch handler ──
// Strategy: Network-first for everything except images
// This ensures the web app and installed app ALWAYS get the latest from Vercel
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

    // HTML pages & JS files: ALWAYS network-first (get latest from Vercel)
    if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.json')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request)) // Offline fallback
        );
        return;
    }

    // For images & other static assets: Cache-first (fast), update in background
    event.respondWith(
        caches.match(event.request).then(cached => {
            const networkFetch = fetch(event.request).then(response => {
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
                return response;
            });
            return cached || networkFetch;
        })
    );
});

// ── Message handler: force skip waiting when told by the page ──
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
