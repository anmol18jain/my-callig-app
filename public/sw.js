self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('push', (event) => {
  let payload = { title: 'Incoming Call', callerId: 'Lounge Peer' };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload.callerId = event.data.text();
    }
  }

  const options = {
    body: `${payload.callerId} is calling you on Lounge...`,
    icon: 'https://emojicdn.elk.sh/📞?style=apple',
    badge: 'https://emojicdn.elk.sh/🛋️?style=apple',
    tag: 'lounge-call-alert',
    renotify: true,
    requireInteraction: true,
    vibrate: [600, 300, 600, 300, 1000],
    data: {
      callerId: payload.callerId,
      url: `/?callFrom=${encodeURIComponent(payload.callerId)}`
    },
    actions: [
      { action: 'answer', title: '📞 Answer' },
      { action: 'decline', title: '❌ Decline' }
    ]
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'decline') return;

  const targetUrl = event.notification.data.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((winClients) => {
      for (const client of winClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});