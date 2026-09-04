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

// VAPID Push Keys (Replace with your keys if generated via npx web-push generate-vapid-keys)
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY || 'BOZaNWGt6kdd33z0PpLxXhmwpTSm_epeb0vaUo4JVjSYDajaXcifybrnhTG3gyQxc5XlWyrjVwcRhbio8ULuY3k';
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY || 'lkm0wllEJGO7bnUrcZ0WQTxjF5gNf3yvdyac0cfnL1U';

if (PUBLIC_VAPID_KEY !== 'YOUR_PUBLIC_VAPID_KEY') {
  webpush.setVapidDetails('mailto:admin@loungesuite.local', PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);
}

// Active users store: username -> { ws, pushSub }
const users = new Map();

// Register background push subscription
app.post('/api/register-push', (req, res) => {
  const { username, subscription } = req.body;
  if (users.has(username)) {
    users.get(username).pushSub = subscription;
  }
  res.status(200).json({ status: 'ok' });
});

// Wake up devices via background push notification
app.post('/api/push-ring', async (req, res) => {
  const { from, targets, callMode, sessionToken } = req.body;
  if (!Array.isArray(targets)) return res.status(400).json({ error: 'targets must be an array' });

  for (const to of targets) {
    const target = users.get(to);
    if (target && target.pushSub && PUBLIC_VAPID_KEY !== 'YOUR_PUBLIC_VAPID_KEY') {
      try {
        await webpush.sendNotification(target.pushSub, JSON.stringify({
          title: `📞 Call from ${from}`,
          body: `Tap to answer ${callMode === 'audio' ? 'audio' : 'video'} call`,
          from, callMode, sessionToken
        }), { Urgency: 'high', TTL: 60 });
      } catch (e) {
        console.log('Push send error:', e.message);
      }
    }
  }
  res.status(200).json({ status: 'sent' });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Broadcast online contact presence
function broadcastContactList() {
  const list = Array.from(users.entries()).map(([name, u]) => ({
    name,
    online: u.ws !== null && u.ws.readyState === 1
  }));
  const msg = JSON.stringify({ type: 'CONTACT_UPDATE', contacts: list });
  for (const u of users.values()) {
    if (u.ws && u.ws.readyState === 1) u.ws.send(msg);
  }
}

// WebSocket Signaling Engine
wss.on('connection', (ws) => {
  let currentUser = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);

      // User Registration
      if (data.type === 'REGISTER') {
        currentUser = data.username;
        const existing = users.get(currentUser) || {};
        users.set(currentUser, { ...existing, ws });
        broadcastContactList();
        return;
      }

      // Ring Targets
      if (data.type === 'CALL_TARGETS') {
        const targets = data.targets;
        targets.forEach(targetName => {
          const target = users.get(targetName);
          if (target && target.ws && target.ws.readyState === 1) {
            target.ws.send(JSON.stringify({
              type: 'INCOMING_CALL',
              from: currentUser,
              callMode: data.callMode,
              sessionToken: data.sessionToken,
              allParticipants: [currentUser, ...targets]
            }));
          }
        });
        return;
      }

      // Enter Mesh Session
      if (data.type === 'JOIN_CALL_SESSION') {
        const { sessionToken, participants } = data;
        participants.forEach(pName => {
          if (pName !== currentUser) {
            const peer = users.get(pName);
            if (peer && peer.ws && peer.ws.readyState === 1) {
              peer.ws.send(JSON.stringify({
                type: 'PEER_ENTERED_SESSION',
                peerName: currentUser,
                sessionToken
              }));
            }
          }
        });
        return;
      }

      // Targeted P2P signaling (offer, answer, candidate, decline)
      if (data.target && users.has(data.target)) {
        const target = users.get(data.target);
        if (target && target.ws && target.ws.readyState === 1) {
          target.ws.send(JSON.stringify({ ...data, sender: currentUser }));
        }
      }
    } catch (err) {
      console.error('Signaling error:', err);
    }
  });

  ws.on('close', () => {
    if (currentUser && users.has(currentUser)) {
      users.get(currentUser).ws = null;
      broadcastContactList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Master Lounge Suite running on port ${PORT}`));