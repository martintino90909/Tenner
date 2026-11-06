// Tenner service worker.
// - Keeps a copy of the app so it opens with no signal (network first, so
//   updates still arrive straight away when online).
// - Serves photos of saved stories from the offline cache.
// - Shows the morning notification and opens Tenner when it's tapped.

const SHELL = "tenner-shell-v3";
const SAVED = "tenner-saved-v1"; // written by the page when a story is saved
const ASSETS = [
  "/",
  "/app.js",
  "/learn.js",
  "/listen.js",
  "/styles.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // One failed file shouldn't stop the rest from being stored.
      await Promise.allSettled(ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("tenner-shell-") && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Try the network; if it's down or slow, use the stored copy.
async function networkFirst(request, cacheKey) {
  const cache = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (res.ok) cache.put(cacheKey || request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(cacheKey || request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Opening the app (/ or an invite link /u/<key>): every page is the same app.
  if (req.mode === "navigate" && url.origin === self.location.origin && (url.pathname === "/" || url.pathname.startsWith("/u/"))) {
    event.respondWith(networkFirst(req, "/"));
    return;
  }

  // The app's own files (not the API, which needs a live connection).
  if (url.origin === self.location.origin && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/admin")) {
    if (ASSETS.includes(url.pathname) || url.pathname.startsWith("/icons/")) {
      event.respondWith(networkFirst(req));
    }
    return;
  }

  // Photos: use the saved-story copy if there is one.
  if (req.destination === "image") {
    event.respondWith(
      (async () => {
        const hit = await (await caches.open(SAVED)).match(req.url);
        return hit || fetch(req);
      })()
    );
  }
});

/* ---------- morning notification ---------- */

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Tenner", body: event.data?.text() || "" }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "Your ten are ready", {
      body: data.body || "Today's stories are waiting.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "tenner-daily",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          w.postMessage({ type: "tenner:refresh" });
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
