self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Incoming Video Call', body: 'Someone is calling you...', callerId: 'Unknown' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: `${data.callerId} is calling you...`,
    icon: '/icon.png',
    badge: '/badge.png',
    tag: 'active-incoming-call',
    renotify: true,
    requireInteraction: true,
    vibrate: [800, 400, 800, 400, 800, 400, 1000],
    data: {
      callerId: data.callerId,
      url: `/?incomingCaller=${encodeURIComponent(data.callerId)}`
    },
    actions: [
      { action: 'answer', title: '📞 Answer' },
      { action: 'decline', title: '❌ Decline' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'decline') return;

  const targetUrl = event.notification.data.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});