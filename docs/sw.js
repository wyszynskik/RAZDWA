var CACHE_VERSION = 'razdwa-v202607121855';

self.addEventListener('install', function (event) {
  event.waitUntil(
    Promise.resolve().then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function (name) {
              return name !== CACHE_VERSION;
            })
            .map(function (name) {
              return caches.delete(name);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (!request || request.method !== 'GET' || !request.url || request.url.indexOf('http') !== 0) {
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  if (url.hostname === 'script.google.com' || url.search.indexOf('getPrices') !== -1) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function (cache) {
              cache.put(request, clone).catch(function () {});
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || new Response('Offline - no cached version available', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
        })
    );
    return;
  }

  var isFont = request.destination === 'font' ||
    request.url.endsWith('.ttf') ||
    url.hostname === 'cdn.jsdelivr.net';

  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    isFont
  ) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        if (cached) {
          return cached;
        }

        return fetch(request)
          .then(function (response) {
            if (response && response.ok) {
              var clone = response.clone();
              caches.open(CACHE_VERSION).then(function (cache) {
                cache.put(request, clone).catch(function () {});
              });
            }
            return response;
          })
          .catch(function () {
            return caches.match(request);
          });
      })
    );
    return;
  }

  var pathname = url.pathname;
  if (pathname.endsWith('.html') || pathname.endsWith('.json')) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function (cache) {
              cache.put(request, clone).catch(function () {});
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || new Response('Offline - no cached version available', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
        })
    );
    return;
  }

  return;
});
