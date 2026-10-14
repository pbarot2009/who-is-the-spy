// Who is the Spy? — offline shell cache. Bump CACHE on every release.
const CACHE = "spy-v15";
const SHELL = ["./", "styles.css?v=15", "script.js?v=15", "manifest.webmanifest", "assets/lobby-loop.wav?v=15"];

self.addEventListener("install", e => {
  // one bad file (offline wav, 404) must not kill the whole install —
  // cache each shell file on its own so skipWaiting still runs
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
      // only our own old shells — never wipe other apps on this origin
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
  // Entry HTML must revalidate every load (matches server no-cache) —
  // cache-first here would pin stale index.html behind a new deploy.
  if (isEntryRequest(url)) {
    // one canonical key: /?room=ABCDE invites must not each store a dupe
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
