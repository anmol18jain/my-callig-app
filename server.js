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

// VAPID Push Keys (Replace with your keys if generated)
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY || 'YOUR_PUBLIC_VAPID_KEY_HERE';
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY || 'YOUR_PRIVATE_VAPID_KEY_HERE';

if (PUBLIC_VAPID_KEY !== 'YOUR_PUBLIC_VAPID_KEY_HERE') {
  webpush.setVapidDetails('mailto:admin@loungesuite.local', PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);
}

// Active users store: username -> { ws, pushSub }
const users = new Map();

app.post('/api/register-push', (req, res) => {
  const { username, subscription } = req.body;
  if (username && subscription) {
    const existing = users.get(username) || { ws: null };
    users.set(username, { ...existing, pushSub: subscription });
    console.log(`[Push Registered] ${username}`);
  }
  res.status(200).json({ status: 'ok' });
});

app.post('/api/push-ring', async (req, res) => {
  const { from, targets, callMode, sessionToken } = req.body;
  if (!Array.isArray(targets)) return res.status(400).json({ error: 'Invalid targets' });

  for (const to of targets) {
    const target = users.get(to);
    if (target && target.pushSub && PUBLIC_VAPID_KEY !== 'YOUR_PUBLIC_VAPID_KEY_HERE') {
      try {
        await webpush.sendNotification(target.pushSub, JSON.stringify({
          title: `📞 Call from ${from}`,
          body: `Incoming ${callMode} call. Tap to answer!`,
          from, callMode, sessionToken, allParticipants: [from, ...targets]
        }), { Urgency: 'high', TTL: 60 });
        console.log(`[Push Sent] To ${to} from ${from}`);
      } catch (e) {
        console.log(`[Push Error] ${to}:`, e.message);
      }
    }
  }
  res.status(200).json({ status: 'sent' });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function broadcastContactList() {
  const contactList = Array.from(users.entries()).map(([name, u]) => ({
    name,
    online: u.ws !== null && u.ws.readyState === 1
  }));
  const msg = JSON.stringify({ type: 'CONTACT_UPDATE', contacts: contactList });
  for (const u of users.values()) {
    if (u.ws && u.ws.readyState === 1) u.ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  let boundUser = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === 'REGISTER') {
        boundUser = data.username;
        const existing = users.get(boundUser) || { pushSub: null };
        users.set(boundUser, { ...existing, ws });
        console.log(`[WS Connected & Registered] User: ${boundUser}`);
        broadcastContactList();
        return;
      }

      if (data.type === 'CALL_TARGETS') {
        console.log(`[Call Dispatch] From ${boundUser} to [${data.targets.join(', ')}]`);
        data.targets.forEach(tName => {
          const target = users.get(tName);
          if (target && target.ws && target.ws.readyState === 1) {
            target.ws.send(JSON.stringify({
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

      if (data.type === 'JOIN_CALL_SESSION') {
        data.participants.forEach(pName => {
          if (pName !== boundUser) {
            const peer = users.get(pName);
            if (peer && peer.ws && peer.ws.readyState === 1) {
              peer.ws.send(JSON.stringify({
                type: 'PEER_ENTERED_SESSION',
                peerName: boundUser,
                sessionToken: data.sessionToken
              }));
            }
          }
        });
        return;
      }

      // Route WebRTC Offer / Answer / Candidate packets
      if (data.target && users.has(data.target)) {
        const target = users.get(data.target);
        if (target && target.ws && target.ws.readyState === 1) {
          target.ws.send(JSON.stringify({ ...data, sender: boundUser }));
        }
      }
    } catch (err) {
      console.error('[Server Error]', err);
    }
  });

  ws.on('close', () => {
    if (boundUser && users.has(boundUser)) {
      const existing = users.get(boundUser);
      users.set(boundUser, { ...existing, ws: null });
      console.log(`[WS Disconnected] User: ${boundUser}`);
      broadcastContactList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server live on port ${PORT}`));