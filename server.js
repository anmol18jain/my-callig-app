const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend assets
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

// Configure VAPID Keys for Background Push
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BGvJGF5gcTfmZ3yA059WkFBvWAuO5Cskom8t_ltXcaEjRVqmaJaNFH6nuBm7hHidGLQJpAaTyA6dVmijq_8Ln1I';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '0bLcNGyc-2D8_8x1xIPNUiL3X5hj7Vm-XuiIFtmJmXU';

if (VAPID_PUBLIC_KEY !== 'PASTE_YOUR_PUBLIC_KEY_HERE') {
  webpush.setVapidDetails('mailto:admin@loungesuite.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// User state directory: id -> { socket, pushSubscription }
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

// Push subscription registration
app.post('/api/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'Missing params' });
  const entry = directory.get(userId) || {};
  directory.set(userId, { ...entry, pushSubscription: subscription });
  return res.status(200).json({ success: true });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let boundUserId = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Heartbeat ping-pong to keep Render connection alive
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    // User Registration
    if (msg.type === 'register') {
      boundUserId = msg.userId.trim();
      const existing = directory.get(boundUserId) || {};
      directory.set(boundUserId, { ...existing, socket: ws });
      broadcastDirectory();
      return;
    }

    // Fast Trickle ICE Relay
    if (msg.type === 'candidate') {
      const recipient = directory.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({
          type: 'candidate',
          from: boundUserId,
          candidate: msg.candidate
        }));
      }
      return;
    }

    // Call Offer Relay + Background Wakeup
    if (msg.type === 'offer') {
      const recipient = directory.get(msg.target?.trim());

      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({
          type: 'offer',
          from: boundUserId,
          offer: msg.offer,
          callMode: msg.callMode
        }));
      }

      // Wake background device if tab is closed
      if (recipient?.pushSubscription && VAPID_PUBLIC_KEY !== 'PASTE_YOUR_PUBLIC_KEY_HERE') {
        const payload = JSON.stringify({
          title: `Incoming ${msg.callMode === 'audio' ? 'Audio' : 'Video'} Call`,
          callerId: boundUserId
        });
        webpush.sendNotification(recipient.pushSubscription, payload, { TTL: 60, urgency: 'high' })
          .catch((e) => console.error('Push delivery error:', e.statusCode));
      }
      return;
    }

    // Call Answer Relay
    if (msg.type === 'answer') {
      const recipient = directory.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({
          type: 'answer',
          from: boundUserId,
          answer: msg.answer
        }));
      }
      return;
    }

    // Hangup
    if (msg.type === 'hangup') {
      const recipient = directory.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({ type: 'hangup', from: boundUserId }));
      }
    }
  });

  ws.on('close', () => {
    if (boundUserId && directory.has(boundUserId)) {
      const record = directory.get(boundUserId);
      directory.set(boundUserId, { ...record, socket: null });
      broadcastDirectory();
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Signaling server running on port ${PORT}`));