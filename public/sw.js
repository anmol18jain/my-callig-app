self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'Incoming Call', body: event.data.text() };
  }

  const title = data.title || '📞 Incoming Call';
  const options = {
    body: data.body || 'Your partner is calling. Tap to answer!',
    icon: 'https://emojicdn.elk.sh/🛋️?style=apple',
    badge: 'https://emojicdn.elk.sh/🛋️?style=apple',
    tag: 'incoming-call-alert',
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
      allParticipants: data.allParticipants || []
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
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
    participants: (payload.allParticipants || []).join(',')
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
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});