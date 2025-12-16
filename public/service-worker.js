const CACHE_NAME = "iptv-pwa-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // No cachear streams ni API
  if (req.url.includes("/api/")) return;

  event.respondWith(
    caches.match(req).then(res => res || fetch(req))
  );
});
