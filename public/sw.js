const CACHE_NAME = 'lounge-cache-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

// Receive background call push notification
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};

  const title = data.title || '📞 Incoming Lounge Call';
  const options = {
    body: data.body || 'Your partner is calling...',
    icon: 'https://cdn-icons-png.flaticon.com/512/3616/3616930.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/3616/3616930.png',
    tag: 'incoming-lounge-call',
    renotify: true,
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 500, 200, 1000],
    actions: [
      { action: 'answer', title: '📞 Answer' },
      { action: 'decline', title: '✕ Decline' }
    ],
    data: {
      room: data.room,
      callMode: data.callMode
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification actions (Answer or Decline)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'decline') return;

  const { room, callMode } = event.notification.data;
  const targetUrl = `/#${room}?autoAnswer=true&mode=${callMode}`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(room) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});