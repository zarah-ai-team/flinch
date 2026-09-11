/* ===================================================================
   Service worker. Precaches the whole shell on install, then serves
   network-first with the cache as the fallback: a player who is online
   always gets the current build, a player in a tunnel gets the last
   build they loaded. Nothing here is game logic.

   VERSION must change with every release (keep it in step with
   package.json): the activate step throws away every other cache, and
   that is the only way an old build ever leaves a phone.
   =================================================================== */
const VERSION = "lane7-2.1.0";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./src/config.js", "./src/rng.js", "./src/store.js", "./src/daily.js", "./src/shapes.js",
  "./src/sim.js", "./src/sound.js",
  "./src/engine/tween.js", "./src/engine/particles.js", "./src/engine/camera.js",
  "./src/engine/sprites.js", "./src/engine/input.js",
  "./src/render.js", "./src/hud.js", "./src/main.js",
  "./fonts/barlow-400.woff2", "./fonts/barlow-600.woff2",
  "./fonts/barlow-condensed-500.woff2", "./fonts/barlow-condensed-700.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
