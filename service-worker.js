const KOBPOSH_CACHE = "kobposh-shell-v29";
const KOBPOSH_CORE_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js?v=20260605-duel-hardoff1",
  "/site.webmanifest",
  "/apple-touch-icon.png",
  "/favicon-96x96.png",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
  "/assets/images/logokobpash.png",
  "/assets/images/imagegroup.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(KOBPOSH_CACHE).then((cache) => cache.addAll(KOBPOSH_CORE_ASSETS)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key === KOBPOSH_CACHE) return Promise.resolve();
          return caches.delete(key);
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(KOBPOSH_CACHE).then((cache) => cache.put("/index.html", responseClone)).catch(() => undefined);
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("/index.html")),
    );
    return;
  }

  const isStaticAsset = /\.(?:css|js|png|jpg|jpeg|svg|webp|ico|json)$/i.test(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const responseClone = response.clone();
            caches.open(KOBPOSH_CACHE).then((cache) => cache.put(request, responseClone)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    }),
  );
});
