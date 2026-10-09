/*
 * B-17 Portal service worker (Phase 9G). Template: `vite.config.ts` replaces the two
 * placeholders below at build time and writes the result to `dist/sw.js`.
 *
 * Deliberately small and conservative:
 *  - Precache ONLY the app shell (index.html + the entry JS/CSS that index.html itself loads).
 *    Lazy route chunks (Phase 9H) are NOT precached — they are cached the first time they are used.
 *  - Navigations: network first, falling back to the cached shell so the SPA (and React Router)
 *    still boots offline and direct URLs keep working. The server's own response always wins online.
 *  - /assets/* (content-hashed, immutable): cache first, filled on demand.
 *  - Everything else — other origins, non-GET requests, /images, and any future API — is not
 *    touched, so there is no data caching and no offline mutation queue.
 *  - A new version waits until the page asks it to take over (SKIP_WAITING); it never forces a reload.
 */
const BUILD_ID = "__BUILD_ID__"
const PRECACHE_URLS = __PRECACHE_URLS__
const CACHE_PREFIX = "b17-"
const CACHE_NAME = CACHE_PREFIX + BUILD_ID
const SHELL_URL = "/"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // `reload` bypasses the HTTP cache so a fresh deploy never precaches a stale shell.
      cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })))
    )
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting()
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(SHELL_URL, { cacheName: CACHE_NAME }).then((shell) => shell || Response.error())))
    return
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              // Only successful, same-origin responses are kept.
              if (response.ok && response.type === "basic") cache.put(request, response.clone())
              return response
            })
        )
      )
    )
  }
})
