const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// STRICT NO-CACHE HEADERS: Prevents HTTP 304 cached code on mobile browsers
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}));

// VAPID Push Keys
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY || 'YOUR_PUBLIC_VAPID_KEY_HERE';
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY || 'YOUR_PRIVATE_VAPID_KEY_HERE';

if (PUBLIC_VAPID_KEY !== 'YOUR_PUBLIC_VAPID_KEY_HERE') {
  webpush.setVapidDetails('mailto:admin@loungesuite.local', PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);
}

const users = new Map();

app.post('/api/register-push', (req, res) => {
  const { username, subscription } = req.body;
  if (!username || !subscription) return res.status(400).json({ error: 'Missing data' });

  const existing = users.get(username) || { ws: null, pushSub: null };
  existing.pushSub = subscription;
  users.set(username, existing);
  res.status(200).json({ status: 'subscribed' });
});

app.post('/api/push-ring', async (req, res) => {
  const { from, targets, callMode, sessionToken } = req.body;
  if (!Array.isArray(targets)) return res.status(400).json({ error: 'Invalid targets' });

  const pushTasks = targets.map(async (targetName) => {
    const userRecord = users.get(targetName);
    if (userRecord && userRecord.pushSub && PUBLIC_VAPID_KEY !== 'YOUR_PUBLIC_VAPID_KEY_HERE') {
      try {
        await webpush.sendNotification(userRecord.pushSub, JSON.stringify({
          title: `📞 Incoming ${callMode} call`,
          body: `${from} is calling. Tap to answer!`,
          from, callMode, sessionToken,
          allParticipants: [from, ...targets]
        }), { Urgency: 'high', TTL: 60 });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) userRecord.pushSub = null;
      }
    }
  });

  await Promise.all(pushTasks);
  res.status(200).json({ status: 'dispatched' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function broadcastContactList() {
  const contactList = Array.from(users.entries()).map(([name, record]) => ({
    name,
    online: record.ws !== null && record.ws.readyState === 1
  }));
  const message = JSON.stringify({ type: 'CONTACT_UPDATE', contacts: contactList });
  for (const record of users.values()) {
    if (record.ws && record.ws.readyState === 1) {
      record.ws.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  let boundUser = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === 'REGISTER') {
        boundUser = data.username;
        const current = users.get(boundUser) || { ws: null, pushSub: null };
        current.ws = ws;
        users.set(boundUser, current);
        console.log(`[Registered] ${boundUser}`);
        broadcastContactList();
        return;
      }

      if (data.type === 'CALL_TARGETS') {
        data.targets.forEach((targetName) => {
          const targetRecord = users.get(targetName);
          if (targetRecord && targetRecord.ws && targetRecord.ws.readyState === 1) {
            targetRecord.ws.send(JSON.stringify({
              type: 'INCOMING_CALL',
              from: boundUser,
              callMode: data.callMode,
              sessionToken: data.sessionToken,
              allParticipants: [boundUser, ...data.targets]
            }));
          }
        });
        return;
      }

      if (data.type === 'CALL_ACCEPTED') {
        const callerRecord = users.get(data.target);
        if (callerRecord && callerRecord.ws && callerRecord.ws.readyState === 1) {
          callerRecord.ws.send(JSON.stringify({
            type: 'CALL_ACCEPTED_BY_PEER',
            from: boundUser,
            sessionToken: data.sessionToken
          }));
        }
        return;
      }

      if (data.target && users.has(data.target)) {
        const destination = users.get(data.target);
        if (destination && destination.ws && destination.ws.readyState === 1) {
          destination.ws.send(JSON.stringify({ ...data, sender: boundUser }));
        }
      }
    } catch (err) {
      console.error('[Signaling Error]:', err.message);
    }
  });

  ws.on('close', () => {
    if (boundUser && users.has(boundUser)) {
      const current = users.get(boundUser);
      current.ws = null;
      console.log(`[Disconnected] ${boundUser}`);
      broadcastContactList();
    }
  });
});

// Render 25s keepalive ping
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(pingInterval));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Lounge Suite active on port ${PORT}`));