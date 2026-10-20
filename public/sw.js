/* Cowork service worker: shows push notifications and opens the right page on tap.
   No caching of pages or data (everything stays fresh and private). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Cowork", body: event.data ? event.data.text() : "" };
  }
  // Firebase Cloud Messaging wraps our fields in "data"; standard Web Push sends them directly.
  if (data && data.data && data.data.title) data = data.data;
  const title = data.title || "Cowork";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/api/brand/logo?size=192",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined,
      data: { href: typeof data.href === "string" && data.href.startsWith("/") ? data.href : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          return c.navigate(href);
        }
      }
      return self.clients.openWindow(href);
    })(),
  );
});
