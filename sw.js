const CACHE_NAME = 'onespot-cache-v3'; // Bumped version to trigger cache refresh
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Force the new service worker to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  // Delete the old broken caches
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Network-First Strategy
self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Only cache valid responses from our own origin (type === 'basic')
        // This prevents caching opaque/cross-origin responses like Dropbox images which can bloat storage
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // If network fails (e.g., offline or blocked by adblocker), fall back to the cache
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // IMPORTANT: If not in cache, we MUST return a valid Response object 
          // to prevent the "FetchEvent.respondWith received an error: Returned response is null" crash.
          // This allows the browser to gracefully fire the <img> onerror handler.
          return new Response(null, { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});
