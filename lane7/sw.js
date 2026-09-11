/* ===================================================================
   Service worker. Precaches the whole shell on install, then serves
   network-first with the cache as the fallback: a player who is online
   always gets the current build, a player in a tunnel gets the last
   build they loaded. Nothing here is game logic.

   What carries the "always current" promise:
   - BUILD below must equal CONFIG.version and package.json (the rules
     tests enforce it). It lives in THIS file because WebKit's update
     check compares only the worker script's own bytes — a bump that
     only touched an imported file would never install on an iPhone.
   - GitHub Pages sends every file with a ten-minute HTTP cache
     lifetime, so the precache bypasses the HTTP cache ("reload") and
     every request revalidates against it ("no-cache": a 304 when
     nothing changed, one round trip).
   - The activate step retires every other lane7-* cache — only this
     game's, because CacheStorage is per origin and the origin is
     shared — and tells every open page which build it is, so a page
     running an older build can reload itself at a safe moment.
   =================================================================== */
const BUILD = "2.2.1";
const VERSION = "lane7-" + BUILD;

// Scripts, fonts and icons first; the two page entries last, so a
// partial precache failure never leaves the HTTP cache holding a fresh
// index.html next to stale scripts (or the reverse).
const SHELL_FILES = [
  "./manifest.webmanifest",
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
const SHELL_PAGES = ["./", "./index.html"];

// On a link that is up but not answering (a tunnel with one bar), a
// player should get the cached build after this long, not a white page.
const NETWORK_WAIT_MS = 3500;

const fresh = (u) => new Request(u, { cache: "reload" });

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL_FILES.map(fresh)).then(() => c.addAll(SHELL_PAGES.map(fresh))))
      .then(() => self.skipWaiting())
      .catch((err) => { console.error("flinch worker: precache failed, keeping the previous build", err); throw err; })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf("lane7-") === 0 && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => { for (const c of clients) c.postMessage({ type: "lane7:worker", version: BUILD }); })
  );
});

// A page asks which build is serving it (it may have loaded before this
// worker activated and missed the announcement above).
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "lane7:version?" && e.source) e.source.postMessage({ type: "lane7:worker", version: BUILD });
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  const cached = caches.match(req, { ignoreSearch: true });
  // fetch(url, init) rather than new Request(navigationRequest, init):
  // older engines refuse to copy a navigation request.
  const net = fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
    if (res && res.ok) {
      try { e.waitUntil(caches.open(VERSION).then((c) => c.put(req, res.clone()))); } catch (_) { /* event no longer extendable — fine */ }
      return res;
    }
    // A 404 or 5xx while a good copy exists (a deploy in flight, an outage): serve the copy.
    return cached.then((hit) => hit || res);
  });
  const patient = new Promise((resolve) => setTimeout(() => resolve(cached.then((hit) => hit || net)), NETWORK_WAIT_MS));
  e.respondWith(
    Promise.race([net, patient])
      .catch(() => cached.then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
