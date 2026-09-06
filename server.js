const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) res.sendFile(path.join(__dirname, 'index.html'));
  });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'), (err) => {
    if (err) res.sendFile(path.join(__dirname, 'sw.js'));
  });
});

// Configure VAPID Keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BMis75qpGF20VG4RmyOjo-d29JEl339zpr0pTQouGMnuqMv3ceF-pEkDkpy4ezsjwgndPOG77dDow4MXaaXgUGM';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'CtyjNq6wh2MFb9Id2xPWZKCHmz_wyJe2wZBjp9HlHCI';

if (VAPID_PUBLIC_KEY !== 'PASTE_YOUR_PUBLIC_KEY_HERE') {
  webpush.setVapidDetails(
    'mailto:support@loungecall.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// User directory: id -> { socket, pushSubscription }
const registry = new Map();

app.post('/api/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'Missing data' });

  const record = registry.get(userId) || {};
  registry.set(userId, { ...record, pushSubscription: subscription });
  return res.status(200).json({ success: true });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let boundUserId = null;

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Ping/Pong Keep-Alive (Prevents 55s Render drop)
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'register') {
      boundUserId = msg.userId.trim();
      const existing = registry.get(boundUserId) || {};
      registry.set(boundUserId, { ...existing, socket: ws });
      return;
    }

    // Trickle ICE forwarding
    if (msg.type === 'candidate') {
      const recipient = registry.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({
          type: 'candidate',
          from: boundUserId,
          candidate: msg.candidate
        }));
      }
      return;
    }

    // Fast Call Offer with Web Push Fallback
    if (msg.type === 'offer') {
      const recipient = registry.get(msg.target?.trim());

      // If peer is connected to WebSocket, forward directly
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({
          type: 'offer',
          from: boundUserId,
          offer: msg.offer
        }));
      }

      // Always deliver background notification if push is subscribed
      if (recipient?.pushSubscription && VAPID_PUBLIC_KEY !== 'PASTE_YOUR_PUBLIC_KEY_HERE') {
        const payload = JSON.stringify({
          title: 'Incoming Call',
          callerId: boundUserId
        });

        webpush.sendNotification(recipient.pushSubscription, payload, {
          TTL: 60,
          urgency: 'high'
        }).catch((err) => console.error('Push error:', err.statusCode));
      }
      return;
    }

    // Call Answer
    if (msg.type === 'answer') {
      const recipient = registry.get(msg.target?.trim());
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
      const recipient = registry.get(msg.target?.trim());
      if (recipient?.socket?.readyState === WebSocket.OPEN) {
        recipient.socket.send(JSON.stringify({ type: 'hangup', from: boundUserId }));
      }
    }
  });

  ws.on('close', () => {
    if (boundUserId && registry.has(boundUserId)) {
      const record = registry.get(boundUserId);
      registry.set(boundUserId, { ...record, socket: null });
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));