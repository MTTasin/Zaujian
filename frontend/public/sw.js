// Service worker for admin Web Push (new orders + chat handoffs).
// Delivers notifications even when the admin tab/browser is closed.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Zaujain Admin";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/logo.jpg",
      badge: "/logo.jpg",
      data: { url: data.url || "/admin" },
      // Re-alert even if a previous one is still on screen.
      renotify: true,
      tag: data.url || "admin",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const c of list) {
          if (c.url.includes("/admin") && "focus" in c) return c.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
