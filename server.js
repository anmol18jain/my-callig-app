const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const webpush = require('web-push');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// --- 1. SERVE FRONTEND STATIC FILES (Fixes "Cannot GET /") ---
// Serves static files if they are in a 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
// Serves static files if they are in the project root directory
app.use(express.static(__dirname));

// Route to deliver index.html at root '/'
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'index.html'));
    }
  });
});

// Explicit route for sw.js to ensure the Service Worker registers correctly
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'), (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'sw.js'));
    }
  });
});

// --- 2. CONFIGURE WEB PUSH (VAPID) ---
// Replace these strings with the output of: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BMis75qpGF20VG4RmyOjo-d29JEl339zpr0pTQouGMnuqMv3ceF-pEkDkpy4ezsjwgndPOG77dDow4MXaaXgUGM';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'CtyjNq6wh2MFb9Id2xPWZKCHmz_wyJe2wZBjp9HlHCI';

if (VAPID_PUBLIC_KEY !== 'BMis75qpGF20VG4RmyOjo-d29JEl339zpr0pTQouGMnuqMv3ceF-pEkDkpy4ezsjwgndPOG77dDow4MXaaXgUGM') {
  webpush.setVapidDetails(
    'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// In-memory store: userId -> { socket, pushSubscription }
const users = new Map();

// Endpoint for frontend to register device Web Push subscriptions
app.post('/api/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) {
    return res.status(400).json({ error: 'Missing userId or subscription' });
  }

  const existing = users.get(userId) || {};
  users.set(userId, { ...existing, pushSubscription: subscription });
  return res.status(200).json({ success: true });
});

// --- 3. WEBSOCKET SIGNALING & TRICKLE ICE ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let currentUserId = null;

  ws.on('message', async (rawMessage) => {
    let data;
    try {
      data = JSON.parse(rawMessage);
    } catch (err) {
      return;
    }

    // 1. Keep-Alive Ping (prevents Render connection drop)
    if (data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    // 2. User Registration
    if (data.type === 'register') {
      currentUserId = data.userId;
      const existing = users.get(data.userId) || {};
      users.set(data.userId, { ...existing, socket: ws });
      return;
    }

    // 3. Fast Trickle ICE Relay
    if (data.type === 'candidate') {
      const target = users.get(data.target);
      if (target && target.socket && target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({
          type: 'candidate',
          from: currentUserId,
          candidate: data.candidate
        }));
      }
      return;
    }

    // 4. Offer Initiation (Calls peer & sends Push notification if tab is sleeping)
    if (data.type === 'offer') {
      const target = users.get(data.target);

      // Path A: Active WebSocket connection
      if (target && target.socket && target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({
          type: 'offer',
          from: currentUserId,
          offer: data.offer
        }));
      }

      // Path B: Wake background device via Web Push
      if (target && target.pushSubscription && VAPID_PUBLIC_KEY !== 'BMis75qpGF20VG4RmyOjo-d29JEl339zpr0pTQouGMnuqMv3ceF-pEkDkpy4ezsjwgndPOG77dDow4MXaaXgUGM') {
        const payload = JSON.stringify({
          title: 'Incoming Call',
          body: `${currentUserId} is calling you...`,
          callerId: currentUserId
        });

        webpush.sendNotification(target.pushSubscription, payload).catch((err) => {
          console.error('Push delivery error:', err.statusCode);
        });
      }
      return;
    }

    // 5. Answer Relay
    if (data.type === 'answer') {
      const target = users.get(data.target);
      if (target && target.socket && target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({
          type: 'answer',
          from: currentUserId,
          answer: data.answer
        }));
      }
      return;
    }
  });

  ws.on('close', () => {
    if (currentUserId && users.has(currentUserId)) {
      const record = users.get(currentUserId);
      // Keep pushSubscription alive so calls can still reach the closed browser
      users.set(currentUserId, { ...record, socket: null });
    }
  });
});

// --- 4. START SERVER ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});