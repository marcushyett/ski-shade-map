// Service Worker for SKISHADE offline support
// Increment this version when you want to trigger an update
const SW_VERSION = '1.0.1';
const CACHE_NAME = `skishade-v${SW_VERSION}`;
const STATIC_CACHE = `skishade-static-v${SW_VERSION}`;
const DATA_CACHE = 'skishade-data-v1'; // Data cache version is separate - we want to preserve it
const MAP_TILE_CACHE = 'skishade-tiles-v1'; // Tile cache version is separate - we want to preserve it

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/favicon.svg',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${SW_VERSION}`);
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Don't skipWaiting automatically - let the app control when to update
});

// Activate event - clean up old caches (but preserve data and tile caches)
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating version ${SW_VERSION}`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // Only delete old static caches, preserve data and tile caches
            if (name === DATA_CACHE || name === MAP_TILE_CACHE) {
              return false; // Keep these
            }
            if (name.startsWith('skishade-static-') && name !== STATIC_CACHE) {
              return true; // Delete old static caches
            }
            if (name.startsWith('skishade-v') && name !== CACHE_NAME) {
              return true; // Delete old main caches
            }
            return false;
          })
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle API requests - network first, cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone the response before caching
          const responseToCache = response.clone();
          
          // Only cache successful GET requests
          if (event.request.method === 'GET' && response.ok) {
            caches.open(DATA_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          
          return response;
        })
        .catch(() => {
          // Network failed, try cache
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              // Add header to indicate this is cached data
              const headers = new Headers(cachedResponse.headers);
              headers.set('X-From-Cache', 'true');
              return new Response(cachedResponse.body, {
                status: cachedResponse.status,
                statusText: cachedResponse.statusText,
                headers,
              });
            }
            
            // No cache, return offline error
            return new Response(
              JSON.stringify({ error: 'Offline', offline: true }),
              { 
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              }
            );
          });
        })
    );
    return;
  }

  // Handle map tiles - cache first, then network
  if (url.hostname.includes('maptiler.com') || url.hostname.includes('tiles.')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request).then((response) => {
          // Cache successful tile responses
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(MAP_TILE_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        }).catch(() => {
          // Return a transparent tile for missing tiles when offline
          return new Response('', { status: 404 });
        });
      })
    );
    return;
  }

  // Handle static assets - network first for HTML to get updates, cache for others
  const isNavigationRequest = event.request.mode === 'navigate';
  const isHTMLRequest = event.request.headers.get('accept')?.includes('text/html');
  
  if (isNavigationRequest || isHTMLRequest) {
    // For navigation/HTML requests, try network first to get latest version
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline, use cache
          return caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || caches.match('/');
          });
        })
    );
    return;
  }

  // For other static assets - cache first
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(event.request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && event.request.method === 'GET') {
          const responseToCache = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      });
    })
  );
});

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    console.log(`[SW] Received SKIP_WAITING, activating new version`);
    self.skipWaiting();
  }
  
  if (event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
  
  if (event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => caches.delete(name))
      );
    });
  }
  
  if (event.data.type === 'CLEAR_STATIC_CACHE') {
    // Only clear static cache, preserve data and tiles
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('skishade-static-') || name.startsWith('skishade-v'))
          .map((name) => caches.delete(name))
      );
    });
  }
});
