// Who is the Spy? — offline shell cache. Bump CACHE on every release.
const CACHE = "spy-v16";
const SHELL = ["./", "index.html", "styles.css?v=16", "script.js?v=16", "manifest.webmanifest", "assets/lobby-loop.wav?v=16"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener("message", e => {
  if (e && e.data && e.data.type === "SKIP_WAITING") {
    try { self.skipWaiting(); } catch (err) {}
  }
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k.indexOf("spy-") === 0).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isEntryRequest(url) {
  return url.pathname === "/" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/");
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (isEntryRequest(url)) {
    const key = new Request("index.html");
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(key).then(hit => hit || new Response("offline", { status: 503, statusText: "offline" })))
    );
    return;
  }
  // Immutable versioned asset requests (?v=N) get served cache-first directly
  const isVersionedAsset = url.searchParams.has("v") || /\.(woff2?|ttf|png|ico)$/.test(url.pathname);
  if (isVersionedAsset) {
    e.respondWith(
      caches.match(e.request, { ignoreSearch: false }).then(hit => {
        if (hit) return hit;
        return fetch(e.request).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        }).catch(() => new Response("offline", { status: 503, statusText: "offline" }));
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net.then(r => r || new Response("offline", { status: 503, statusText: "offline" }));
    })
  );
});
