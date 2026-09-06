const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) res.sendFile(path.join(__dirname, 'index.html'));
  });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'), (err) => {
    if (err) res.sendFile(path.join(__dirname, 'sw.js'));
  });
});

// Configure VAPID Keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BGvJGF5gcTfmZ3yA059WkFBvWAuO5Cskom8t_ltXcaEjRVqmaJaNFH6nuBm7hHidGLQJpAaTyA6dVmijq_8Ln1I';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '0bLcNGyc-2D8_8x1xIPNUiL3X5hj7Vm-XuiIFtmJmXU';

if (VAPID_PUBLIC_KEY !== 'BGvJGF5gcTfmZ3yA059WkFBvWAuO5Cskom8t_ltXcaEjRVqmaJaNFH6nuBm7hHidGLQJpAaTyA6dVmijq_8Ln1I') {
  webpush.setVapidDetails(
    'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// Map: userId -> { socket, pushSubscription, lastSeen }
const directory = new Map();

function broadcastDirectory() {
  const onlineUsers = [];
  directory.forEach((val, key) => {
    if (val.socket && val.socket.readyState === WebSocket.OPEN) {
      onlineUsers.push(key);
    }
  });

  const payload = JSON.stringify({ type: 'presence_update', users: onlineUsers });
  directory.forEach((val) => {
    if (val.socket && val.socket.readyState === WebSocket.OPEN) {
      val.socket.send(payload);
    }
  });
}

// Push subscription endpoint
app.post('/api/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'Missing params' });

  const record = directory.get(userId) || {};
  directory.set(userId, { ...record, pushSubscription: subscription });
  return res.status(200).json({ success: true });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let boundUser = null;

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // 1. Keep-Alive Ping (prevents Render sleep)
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    // 2. Device Registration & Instant Presence Broadcast
    if (msg.type === 'register') {
      boundUser = msg.userId.trim();
      const existing = directory.get(boundUser) || {};
      directory.set(boundUser, { ...existing, socket: ws });
      broadcastDirectory();
      return;
    }

    // 3. Lightning Trickle ICE Forwarding
    if (msg.type === 'candidate') {
      const recipient = directory.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({
          type: 'candidate',
          from: boundUser,
          candidate: msg.candidate
        }));
      }
      return;
    }

    // 4. Call Offer + Wake Push if Offline
    if (msg.type === 'offer') {
      const recipient = directory.get(msg.target?.trim());

      // If active on WebSocket
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({
          type: 'offer',
          from: boundUser,
          offer: msg.offer
        }));
      }

      // If asleep / tab closed -> Trigger Background Web Push
      if (recipient?.pushSubscription && VAPID_PUBLIC_KEY !== 'BGvJGF5gcTfmZ3yA059WkFBvWAuO5Cskom8t_ltXcaEjRVqmaJaNFH6nuBm7hHidGLQJpAaTyA6dVmijq_8Ln1I') {
        const payload = JSON.stringify({
          title: 'Incoming Call',
          callerId: boundUser
        });

        webpush.sendNotification(recipient.pushSubscription, payload, {
          TTL: 60,
          urgency: 'high'
        }).catch((err) => console.error('Push error:', err.statusCode));
      }
      return;
    }

    // 5. Answer Forwarding
    if (msg.type === 'answer') {
      const recipient = directory.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({
          type: 'answer',
          from: boundUser,
          answer: msg.answer
        }));
      }
      return;
    }

    // 6. Hangup
    if (msg.type === 'hangup') {
      const recipient = directory.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({ type: 'hangup', from: boundUser }));
      }
    }
  });

  ws.on('close', () => {
    if (boundUser && directory.has(boundUser)) {
      const record = directory.get(boundUser);
      directory.set(boundUser, { ...record, socket: null });
      broadcastDirectory();
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Active on port ${PORT}`));