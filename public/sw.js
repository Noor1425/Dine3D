/* Dine3D conservative service worker: application shell only, never API data. */
const VERSION = 'dine3d-shell-v2';
const SHELL = `${VERSION}:shell`;
const STATIC = `${VERSION}:static`;
const OFFLINE_URL = '/offline';
const SAFE_ADMIN_ROUTES = new Set(['/admin/pos', '/admin/kds', '/admin/inventory', '/admin/sync']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll([OFFLINE_URL])));
  // Deliberately do not skipWaiting. The application verifies its durable
  // outbox before authorizing activation.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('dine3d-shell-') && key !== SHELL && key !== STATIC).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function warmOperationalShell() {
  const shell = await caches.open(SHELL);
  const staticCache = await caches.open(STATIC);
  for (const route of SAFE_ADMIN_ROUTES) {
    try {
      const response = await fetch(route, { credentials: 'include', cache: 'reload', redirect: 'manual' });
      if (!response.ok || response.type === 'opaqueredirect') continue;
      await shell.put(route, response.clone());
      const html = await response.text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => match[1].replaceAll('&amp;', '&'))
        .filter((value) => value.startsWith('/_next/static/'));
      await Promise.all([...new Set(assets)].map(async (asset) => {
        try {
          const request = new Request(asset, { credentials: 'same-origin' });
          if (await staticCache.match(request)) return;
          const assetResponse = await fetch(request);
          if (assetResponse.ok) await staticCache.put(request, assetResponse);
        } catch { /* the next authenticated warm-up retries missing assets */ }
      }));
    } catch { /* never disturb the current online session during warm-up */ }
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING_AFTER_OUTBOX_CHECK') self.skipWaiting();
  if (event.data?.type === 'WARM_OPERATIONAL_SHELL') event.waitUntil(warmOperationalShell());
});

function isForbidden(request, url) {
  return url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/superadmin')
    || url.pathname.startsWith('/uploads/')
    || url.pathname.includes('/auth/')
    || request.method !== 'GET';
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isForbidden(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && SAFE_ADMIN_ROUTES.has(url.pathname)) {
          const cache = await caches.open(SHELL);
          await cache.put(url.pathname, response.clone());
        }
        return response;
      } catch {
        if (SAFE_ADMIN_ROUTES.has(url.pathname)) {
          const cached = await caches.match(url.pathname);
          if (cached) return cached;
        }
        return caches.match(OFFLINE_URL);
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await (await caches.open(STATIC)).put(request, response.clone());
      return response;
    })());
  }
});
