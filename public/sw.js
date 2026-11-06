// Tenner service worker: shows the morning notification and opens the app
// when it's tapped. (No offline caching yet.)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Tenner", body: event.data?.text() || "" }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "Your ten are ready", {
      body: data.body || "Today's stories are waiting.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "tenner-daily",
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
