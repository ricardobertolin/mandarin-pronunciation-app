/* ============================================================
   Mandarin Pronunciation Practice — Service Worker
   ============================================================
   Strategy: Cache-first for the app shell.

   On install  → pre-cache all static files.
   On activate → delete old caches so stale assets are purged
                 whenever the SW version number changes.
   On fetch    → serve from cache; fall back to network if the
                 resource isn't cached (e.g. CDN fonts).
   ============================================================ */

'use strict';

// Bump this version string whenever you update any of the cached
// files. The browser will install the new SW alongside the old
// one and swap them in after the next page load.
const CACHE_NAME = 'mandarin-practice-v3';

// Files that make up the "app shell" — everything needed to run
// the app without any network access after the first visit.
const APP_SHELL = [
  './',           // resolves to index.html via the server
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
];

/* ── Install ───────────────────────────────────────────────────
   Pre-cache the app shell. waitUntil() keeps the SW in the
   "installing" state until all files are cached so that the
   activate step never runs with a partially populated cache.
   ──────────────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching app shell');
      return cache.addAll(APP_SHELL);
    })
  );

  // Take control immediately — no need to wait for old tabs to close.
  self.skipWaiting();
});

/* ── Activate ──────────────────────────────────────────────────
   Delete every cache whose name does not match the current
   CACHE_NAME. This removes assets from previous SW versions.
   ──────────────────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      )
    )
  );

  // Claim all open clients so the new SW takes effect immediately
  // without requiring a full page reload.
  self.clients.claim();
});

/* ── Fetch ─────────────────────────────────────────────────────
   Cache-first: if the request is in the cache, serve it from
   there. Otherwise fall back to the network.

   We only intercept same-origin GET requests so that the SW
   never interferes with the browser's SpeechRecognition API
   calls or any future analytics/logging endpoints.
   ──────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests (POST, etc.) and cross-origin requests
  if (
    event.request.method !== 'GET' ||
    !event.request.url.startsWith(self.location.origin)
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Serve from cache — works fully offline
        return cachedResponse;
      }

      // Not in cache — fetch from network and (optionally) cache it
      return fetch(event.request).then((networkResponse) => {
        // Only cache valid, non-opaque responses
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic'
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
