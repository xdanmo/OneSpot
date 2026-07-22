const CACHE_NAME = 'onespot-cache-v15'; // Bumped: multi-page architecture
const urlsToCache = [
  './',
  './index.html',
  './login.html',
  './privacy.html',
  './style.css',
  './app.js',
  './manifest.json',
  './dropbox-sdk.min.js'
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

// Network-First Strategy (same-origin only)
self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  // CRITICAL: Do NOT intercept cross-origin requests (e.g., Dropbox images).
  // Intercepting opaque cross-origin fetches causes silent failures on Safari/iOS/WebKit,
  // and inconsistent behavior across browsers. Let the browser handle them natively.
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // If network fails (e.g., offline), fall back to the cache
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Return a valid Response to prevent FetchEvent.respondWith crash
          return new Response(null, { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});