const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// VAPID PUSH CONFIGURATION (Replace with your generated keys)
// -------------------------------------------------------------
const PUBLIC_VAPID_KEY = 'BOZaNWGt6kdd33z0PpLxXhmwpTSm_epeb0vaUo4JVjSYDajaXcifybrnhTG3gyQxc5XlWyrjVwcRhbio8ULuY3k';
const PRIVATE_VAPID_KEY = 'lkm0wllEJGO7bnUrcZ0WQTxjF5gNf3yvdyac0cfnL1U';

webpush.setVapidDetails(
  'mailto:admin@loungesuite.local',
  PUBLIC_VAPID_KEY,
  PRIVATE_VAPID_KEY
);

// In-memory push subscription store: room -> Map(userId, subscription)
const pushRegistry = new Map();

// Save client subscription
app.post('/api/subscribe', (req, res) => {
  const { room, userId, subscription } = req.body;
  if (!room || !userId || !subscription) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  if (!pushRegistry.has(room)) {
    pushRegistry.set(room, new Map());
  }
  pushRegistry.get(room).set(userId, subscription);
  res.status(200).json({ status: 'subscribed' });
});

// Trigger native push call alert
app.post('/api/ring-call', async (req, res) => {
  const { room, callerId, callMode } = req.body;
  if (!room || !pushRegistry.has(room)) {
    return res.status(200).json({ status: 'no_subscribers' });
  }

  const payload = JSON.stringify({
    title: `📞 Incoming ${callMode === 'audio' ? 'Audio' : 'Video'} Call`,
    body: `Your partner is calling you in room "${room}". Tap to answer!`,
    room: room,
    callMode: callMode
  });

  const subs = pushRegistry.get(room);
  const dispatchPromises = [];

  for (const [uid, sub] of subs.entries()) {
    if (uid !== callerId) {
      dispatchPromises.push(
        webpush.sendNotification(sub, payload, { Urgency: 'high', TTL: 60 })
          .catch(err => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              subs.delete(uid); // Clean stale subscription
            }
          })
      );
    }
  }

  await Promise.all(dispatchPromises);
  res.status(200).json({ status: 'dispatched' });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------------------------------------------------
// WEBRTC SIGNALING ENGINE
// -------------------------------------------------------------
const rooms = {};

wss.on('connection', (ws) => {
  ws.id = crypto.randomUUID();
  let userRoom = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === 'join') {
        userRoom = data.room;
        if (!rooms[userRoom]) rooms[userRoom] = new Map();

        for (const [id, client] of rooms[userRoom].entries()) {
          if (client.readyState !== 1) rooms[userRoom].delete(id);
        }

        const existingPeers = Array.from(rooms[userRoom].keys());
        ws.send(JSON.stringify({
          type: 'room-info',
          myId: ws.id,
          peers: existingPeers
        }));

        rooms[userRoom].forEach((client) => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'peer-joined', peerId: ws.id }));
          }
        });

        rooms[userRoom].set(ws.id, ws);
        return;
      }

      if (data.target && rooms[userRoom] && rooms[userRoom].has(data.target)) {
        const targetClient = rooms[userRoom].get(data.target);
        if (targetClient && targetClient.readyState === 1) {
          targetClient.send(JSON.stringify({ ...data, sender: ws.id }));
        }
        return;
      }

      if (userRoom && rooms[userRoom]) {
        rooms[userRoom].forEach((client) => {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify({ ...data, sender: ws.id }));
          }
        });
      }
    } catch (err) {
      console.error('Signaling error:', err);
    }
  });

  ws.on('close', () => {
    if (userRoom && rooms[userRoom]) {
      rooms[userRoom].delete(ws.id);
      rooms[userRoom].forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'peer-left', peerId: ws.id }));
        }
      });
      if (rooms[userRoom].size === 0) delete rooms[userRoom];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Master Lounge Suite running on port ${PORT}`));