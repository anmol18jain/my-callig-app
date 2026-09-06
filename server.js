const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BGvJGF5gcTfmZ3yA059WkFBvWAuO5Cskom8t_ltXcaEjRVqmaJaNFH6nuBm7hHidGLQJpAaTyA6dVmijq_8Ln1I';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '0bLcNGyc-2D8_8x1xIPNUiL3X5hj7Vm-XuiIFtmJmXU';

if (VAPID_PUBLIC_KEY !== 'BGvJGF5gcTfmZ3yA059WkFBvWAuO5Cskom8t_ltXcaEjRVqmaJaNFH6nuBm7hHidGLQJpAaTyA6dVmijq_8Ln1I') {
  webpush.setVapidDetails('mailto:support@loungesuite.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const directory = new Map();

function broadcastPresence() {
  const onlineUsers = [];
  directory.forEach((val, key) => {
    if (val.socket && val.socket.readyState === WebSocket.OPEN) {
      onlineUsers.push(key);
    }
  });
  const payload = JSON.stringify({ type: 'presence_update', users: onlineUsers });
  directory.forEach((val) => {
    if (val.socket && val.socket.readyState === WebSocket.OPEN) val.socket.send(payload);
  });
}

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
  let boundUser = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'register') {
      boundUser = msg.userId.trim();
      const entry = directory.get(boundUser) || {};
      directory.set(boundUser, { ...entry, socket: ws });
      broadcastPresence();
      return;
    }

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

    if (msg.type === 'offer') {
      const recipient = directory.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({
          type: 'offer',
          from: boundUser,
          offer: msg.offer,
          callMode: msg.callMode
        }));
      }
      if (recipient?.pushSubscription && VAPID_PUBLIC_KEY !== 'BGvJGF5gcTfmZ3yA059WkFBvWAuO5Cskom8t_ltXcaEjRVqmaJaNFH6nuBm7hHidGLQJpAaTyA6dVmijq_8Ln1I') {
        const payload = JSON.stringify({
          title: `Incoming ${msg.callMode === 'audio' ? 'Audio' : 'Video'} Call`,
          callerId: boundUser
        });
        webpush.sendNotification(recipient.pushSubscription, payload, { TTL: 60, urgency: 'high' })
          .catch(e => console.error('Push error:', e.statusCode));
      }
      return;
    }

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

    if (msg.type === 'hangup') {
      const recipient = directory.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({ type: 'hangup', from: boundUser }));
      }
    }
  });

  ws.on('close', () => {
    if (boundUser && directory.has(boundUser)) {
      const entry = directory.get(boundUser);
      directory.set(boundUser, { ...entry, socket: null });
      broadcastPresence();
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Lounge Server online on port ${PORT}`));