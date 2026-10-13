// Who is the Spy? — offline shell cache. Bump CACHE on every release.
const CACHE = "spy-v13";
const SHELL = ["./", "index.html", "styles.css?v=13", "script.js?v=13", "manifest.webmanifest", "assets/lobby-loop.wav"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isEntryRequest(url) {
  return url.pathname === "/" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/");
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Entry HTML must revalidate every load (matches server no-cache) —
  // cache-first here would pin stale index.html behind a new deploy.
  if (isEntryRequest(url)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match("index.html")).then(hit => hit || new Response("offline", { status: 503, statusText: "offline" })))
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
