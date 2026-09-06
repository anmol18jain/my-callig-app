self.addEventListener('push', (event) => {
  let data = { title: 'Incoming Call', body: 'Someone is calling...', callerId: '' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icon.png', // Optional: your logo icon path
    badge: '/badge.png',
    tag: 'call-ringing',
    renotify: true,
    requireInteraction: true, // Keeps notification visible until user answers or rejects
    vibrate: [500, 250, 500, 250, 500, 250, 500],
    data: {
      callerId: data.callerId,
      url: `/?caller=${encodeURIComponent(data.callerId)}`
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

  // Re-focus open tab or open a fresh one to accept the call
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url || '/');
      }
    })
  );
});