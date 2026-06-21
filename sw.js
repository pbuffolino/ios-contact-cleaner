// sw.js — caches the app shell so the tool works offline and as an installed
// PWA. It only ever caches the app's own static files; contact data never
// touches the cache (it's only ever held in memory while the page is open).

const CACHE = "contact-cleaner-v1";
const SHELL = [
  ".",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/vcard.js",
  "js/dedupe.js",
  "js/format.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Cache-first for our own GET requests; never touch cross-origin requests.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
