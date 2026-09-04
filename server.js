const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Strict no-cache headers
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false
}));

// Map: lowercase_username -> { rawName, ws, pushSub }
const users = new Map();

function broadcastContactList() {
  const contactList = Array.from(users.entries()).map(([_, record]) => ({
    name: record.rawName,
    online: record.ws !== null && record.ws.readyState === 1
  }));
  const msg = JSON.stringify({ type: 'CONTACT_UPDATE', contacts: contactList });
  for (const record of users.values()) {
    if (record.ws && record.ws.readyState === 1) {
      record.ws.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  let boundUserKey = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === 'REGISTER') {
        const rawName = data.username.trim();
        boundUserKey = rawName.toLowerCase();
        const existing = users.get(boundUserKey) || { rawName, ws: null, pushSub: null };
        existing.rawName = rawName;
        existing.ws = ws;
        users.set(boundUserKey, existing);
        console.log(`[ONLINE] ${rawName} (${boundUserKey})`);
        broadcastContactList();
        return;
      }

      if (data.type === 'CALL_TARGETS') {
        const callerRecord = users.get(boundUserKey);
        const callerName = callerRecord ? callerRecord.rawName : boundUserKey;

        data.targets.forEach((targetRaw) => {
          const targetKey = targetRaw.trim().toLowerCase();
          const dest = users.get(targetKey);

          if (dest && dest.ws && dest.ws.readyState === 1) {
            console.log(`[RINGING] ${callerName} -> ${dest.rawName}`);
            dest.ws.send(JSON.stringify({
              type: 'INCOMING_CALL',
              from: callerName,
              callMode: data.callMode,
              sessionToken: data.sessionToken,
              allParticipants: [callerName, ...data.targets]
            }));
          } else {
            console.log(`[CALL FAILED] Target ${targetRaw} (${targetKey}) is offline or not found.`);
          }
        });
        return;
      }

      if (data.type === 'CALL_ACCEPTED') {
        const targetKey = data.target.trim().toLowerCase();
        const dest = users.get(targetKey);
        if (dest && dest.ws && dest.ws.readyState === 1) {
          console.log(`[ACCEPTED] Call accepted by ${boundUserKey}, notifying ${dest.rawName}`);
          dest.ws.send(JSON.stringify({
            type: 'CALL_ACCEPTED_BY_PEER',
            from: users.get(boundUserKey)?.rawName || boundUserKey,
            sessionToken: data.sessionToken
          }));
        }
        return;
      }

      // Forward WebRTC signals (case-insensitive target)
      if (data.target) {
        const targetKey = data.target.trim().toLowerCase();
        const dest = users.get(targetKey);
        if (dest && dest.ws && dest.ws.readyState === 1) {
          dest.ws.send(JSON.stringify({
            ...data,
            sender: users.get(boundUserKey)?.rawName || boundUserKey
          }));
        }
      }
    } catch (err) {
      console.error('[Signaling Error]:', err.message);
    }
  });

  ws.on('close', () => {
    if (boundUserKey && users.has(boundUserKey)) {
      const current = users.get(boundUserKey);
      current.ws = null;
      console.log(`[OFFLINE] ${boundUserKey}`);
      broadcastContactList();
    }
  });
});

// Render 25s ping-pong keepalive
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(pingInterval));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Lounge Suite active on port ${PORT}`));