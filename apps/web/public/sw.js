/*
 * IRONVOW service worker.
 *
 * Exists only to receive push notifications. It deliberately does not cache
 * anything: the game is server-authoritative, and a stale cached bundle
 * rendering against a live server is a class of bug nobody enjoys debugging.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'IRONVOW', body: event.data.text(), tag: 'ironvow' };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'IRONVOW', {
      body: payload.body ?? '',
      // Collapses an older notification of the same kind rather than stacking
      // three "a builder is free" alerts.
      tag: payload.tag ?? 'ironvow',
      renotify: false,
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Focus a tab that already has the game open rather than opening a second.
      for (const client of windows) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
