self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = String(payload.title || "D’Blossom School Notification");
  const options = {
    body: String(payload.body || "You have a new school portal notification."),
    icon: "/logo.jpeg",
    badge: "/logo.jpeg",
    tag: String(payload.tag || "dblossom-message"),
    renotify: true,
    data: { url: String(payload.url || "/") }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(String(event.notification.data?.url || "/"), self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
