/* global self, caches */
/*
 * E6 offline shell. Same-origin files only: market data, news and keys never pass through here
 * (every cross-origin request goes straight to the network, untouched).
 *
 * - Pages: network first, so a deploy shows at once; offline, the last page this browser loaded.
 * - /assets/*: content-hashed, so cache first. When a fresh page links a new build of an entry
 *   file (index-<hash>.js), the cached older build of it is dropped; other files (fonts, the feed
 *   worker, chunks loaded on demand) stay, so the app still starts offline.
 */
const CACHE = 'parallax-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

/** 'index-Bsqv6B9v.js' -> 'index.js': a file's name without its content hash. */
const stem = (path) => path.replace(/-[\w-]{8}(\.\w+)$/, '$1');

/** Drop cached builds of the files a new page links under a new name. */
async function prune(cache, html) {
  const linked = new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? []);
  const stems = new Set([...linked].map(stem));
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/assets/') && !linked.has(path) && stems.has(stem(path))) {
      await cache.delete(request);
    }
  }
}

async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put('/', response.clone());
      await prune(cache, await response.clone().text());
    }
    return response;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

async function asset(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(page(request));
    return;
  }
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    event.respondWith(asset(request));
  }
});
