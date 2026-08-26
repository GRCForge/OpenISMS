const CACHE = 'isms-v1';
const PRECACHE = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return; // never cache API calls

  // Navigations (the HTML shell) must go network-first: a stale cached
  // index.html references hashed JS/CSS chunk filenames from whatever build
  // was live when it was cached. After a deploy those old-named chunks no
  // longer exist on the server, so serving the stale HTML first (as the
  // stale-while-revalidate strategy below does for everything else) breaks
  // the app with a blank page until the background revalidation catches up
  // on the *next* load. Only fall back to the cache when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        // Clone BEFORE returning: caches.open() is async, so by the time its
        // callback ran the page had already consumed the body and clone() threw
        // "Response body is already used" — which meant nothing was ever cached.
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone(); // see above — clone synchronously
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

self.addEventListener('push', (e) => {
  let data = { title: 'ISMS', body: 'Neue Benachrichtigung' };
  try { if (e.data) data = e.data.json(); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'ISMS', {
      body: data.body || '',
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      data: { link: data.link || '/' },
      tag: data.tag || 'isms-notification',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('navigate' in client && 'focus' in client) {
          return client.navigate(link).then(c => (c || client).focus()).catch(() => clients.openWindow(link));
        }
      }
      return clients.openWindow(link);
    })
  );
});
