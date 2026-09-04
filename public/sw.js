self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'Tap to answer the call.',
    icon: 'https://emojicdn.elk.sh/🛋️?style=apple',
    badge: 'https://emojicdn.elk.sh/🛋️?style=apple',
    tag: 'call-alert',
    renotify: true,
    requireInteraction: true,
    vibrate: [500, 250, 500, 250, 500, 250, 500],
    actions: [
      { action: 'answer', title: '📞 Answer' },
      { action: 'decline', title: '✕ Decline' }
    ],
    data: {
      from: data.from,
      callMode: data.callMode || 'video',
      sessionToken: data.sessionToken,
      participants: data.allParticipants || []
    }
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Incoming Call', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'decline') return;

  const payload = event.notification.data || {};
  const queryParams = new URLSearchParams({
    autoAnswer: 'true',
    from: payload.from || '',
    mode: payload.callMode || 'video',
    session: payload.sessionToken || '',
    participants: (payload.participants || []).join(',')
  }).toString();
  const targetUrl = `/?${queryParams}`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});