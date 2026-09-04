const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// VAPID Push Keys (Generate using `npx web-push generate-vapid-keys`)
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY || 'YOUR_PUBLIC_VAPID_KEY_HERE';
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY || 'YOUR_PRIVATE_VAPID_KEY_HERE';

if (PUBLIC_VAPID_KEY !== 'YOUR_PUBLIC_VAPID_KEY_HERE') {
  webpush.setVapidDetails(
    'mailto:admin@loungesuite.local',
    PUBLIC_VAPID_KEY,
    PRIVATE_VAPID_KEY
  );
}

// Active user registry: username -> { ws: WebSocket|null, pushSub: Object|null }
const users = new Map();

app.post('/api/register-push', (req, res) => {
  const { username, subscription } = req.body;
  if (!username || !subscription) {
    return res.status(400).json({ error: 'Missing username or subscription' });
  }

  const existing = users.get(username) || { ws: null, pushSub: null };
  existing.pushSub = subscription;
  users.set(username, existing);

  console.log(`[Push] Device armed with push subscription for: ${username}`);
  res.status(200).json({ status: 'subscribed' });
});

app.post('/api/push-ring', async (req, res) => {
  const { from, targets, callMode, sessionToken } = req.body;
  if (!Array.isArray(targets) || targets.length === 0) {
    return res.status(400).json({ error: 'Targets array is required' });
  }

  const pushTasks = targets.map(async (targetName) => {
    const userRecord = users.get(targetName);
    if (userRecord && userRecord.pushSub && PUBLIC_VAPID_KEY !== 'YOUR_PUBLIC_VAPID_KEY_HERE') {
      const payload = JSON.stringify({
        title: `📞 Incoming ${callMode === 'audio' ? 'Audio' : 'Video'} Call`,
        body: `${from} is calling you. Tap to answer!`,
        from,
        callMode,
        sessionToken,
        allParticipants: [from, ...targets]
      });

      try {
        await webpush.sendNotification(userRecord.pushSub, payload, {
          Urgency: 'high',
          TTL: 60
        });
        console.log(`[Push] Dispatched call alert to: ${targetName}`);
      } catch (err) {
        console.error(`[Push] Delivery failure for ${targetName}:`, err.message);
        if (err.statusCode === 404 || err.statusCode === 410) {
          userRecord.pushSub = null;
        }
      }
    }
  });

  await Promise.all(pushTasks);
  res.status(200).json({ status: 'dispatched' });
});

app.use((req, res) => {
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

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === 'REGISTER') {
        boundUser = data.username;
        const current = users.get(boundUser) || { ws: null, pushSub: null };
        current.ws = ws;
        users.set(boundUser, current);
        console.log(`[WebSocket] Connected: ${boundUser}`);
        broadcastContactList();
        return;
      }

      if (data.type === 'CALL_TARGETS') {
        const { targets, callMode, sessionToken } = data;
        targets.forEach((targetName) => {
          const targetRecord = users.get(targetName);
          if (targetRecord && targetRecord.ws && targetRecord.ws.readyState === 1) {
            targetRecord.ws.send(JSON.stringify({
              type: 'INCOMING_CALL',
              from: boundUser,
              callMode,
              sessionToken,
              allParticipants: [boundUser, ...targets]
            }));
          }
        });
        return;
      }

      if (data.type === 'JOIN_CALL_SESSION') {
        const { sessionToken, participants } = data;
        participants.forEach((pName) => {
          if (pName !== boundUser) {
            const pRecord = users.get(pName);
            if (pRecord && pRecord.ws && pRecord.ws.readyState === 1) {
              pRecord.ws.send(JSON.stringify({
                type: 'PEER_ENTERED_SESSION',
                peerName: boundUser,
                sessionToken
              }));
            }
          }
        });
        return;
      }

      if (data.target && users.has(data.target)) {
        const destination = users.get(data.target);
        if (destination && destination.ws && destination.ws.readyState === 1) {
          destination.ws.send(JSON.stringify({ ...data, sender: boundUser }));
        }
      }
    } catch (err) {
      console.error('[WebSocket Error]:', err);
    }
  });

  ws.on('close', () => {
    if (boundUser && users.has(boundUser)) {
      const current = users.get(boundUser);
      current.ws = null;
      console.log(`[WebSocket] Disconnected: ${boundUser}`);
      broadcastContactList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Master Lounge Suite running on port ${PORT}`));