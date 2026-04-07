var CACHE = 'zb-v15';

self.addEventListener('install', function() {
  // Take over immediately — don't wait for old tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  // Purge all old caches, then claim all clients
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Audio streams: re-fetch via SW so browser sends Sec-Fetch-Dest: empty
  // instead of Sec-Fetch-Dest: audio, bypassing NewstalkZB's hotlink block.
  if (url.hostname === 'weekondemand.newstalkzb.co.nz') {
    e.respondWith(
      fetch(e.request.url, { mode: 'no-cors', referrerPolicy: 'no-referrer' })
        .catch(function() { return new Response('', { status: 503 }); })
    );
    return;
  }

  // Everything else: network-first, cache fallback (offline support)
  e.respondWith(
    fetch(e.request).then(function(res) {
      if (e.request.method === 'GET' && url.origin === self.location.origin) {
        var clone = res.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
      }
      return res;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
