const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Configure Web Push with your generated VAPID keys
const VAPID_PUBLIC_KEY = 'BMis75qpGF20VG4RmyOjo-d29JEl339zpr0pTQouGMnuqMv3ceF-pEkDkpy4ezsjwgndPOG77dDow4MXaaXgUGM';
const VAPID_PRIVATE_KEY = 'CtyjNq6wh2MFb9Id2xPWZKCHmz_wyJe2wZBjp9HlHCI';

webpush.setVapidDetails(
  'mailto:admin@yourdomain.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Map storing active connections: userId -> { socket, pushSubscription }
const users = new Map();

// Endpoint to store browser push subscriptions
app.post('/api/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).send('Missing payload');
  
  const existing = users.get(userId) || {};
  users.set(userId, { ...existing, pushSubscription: subscription });
  return res.status(200).json({ success: true });
});

wss.on('connection', (ws) => {
  let currentUserId = null;

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // 1. Keep-Alive Ping (Render connection persistence)
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    // 2. Identify User
    if (msg.type === 'register') {
      currentUserId = msg.userId;
      const existing = users.get(msg.userId) || {};
      users.set(msg.userId, { ...existing, socket: ws });
      return;
    }

    // 3. Instant Trickle ICE Candidate relay
    if (msg.type === 'candidate') {
      const target = users.get(msg.target);
      if (target && target.socket && target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({
          type: 'candidate',
          from: currentUserId,
          candidate: msg.candidate
        }));
      }
      return;
    }

    // 4. Offer / Call Initiation
    if (msg.type === 'offer') {
      const target = users.get(msg.target);

      // A: If tab is currently open, relay over WebSocket immediately
      if (target && target.socket && target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({
          type: 'offer',
          from: currentUserId,
          offer: msg.offer
        }));
      }

      // B: Always trigger Push Notification (reaches device if tab is closed)
      if (target && target.pushSubscription) {
        const payload = JSON.stringify({
          title: 'Incoming Call',
          body: `${currentUserId} is calling you...`,
          callerId: currentUserId
        });

        webpush.sendNotification(target.pushSubscription, payload).catch(err => {
          console.error('Push delivery error:', err.statusCode);
        });
      }
      return;
    }

    // 5. Answer Relay
    if (msg.type === 'answer') {
      const target = users.get(msg.target);
      if (target && target.socket && target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({
          type: 'answer',
          from: currentUserId,
          answer: msg.answer
        }));
      }
      return;
    }
  });

  ws.on('close', () => {
    if (currentUserId && users.has(currentUserId)) {
      const record = users.get(currentUserId);
      users.set(currentUserId, { ...record, socket: null });
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));