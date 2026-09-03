const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};

wss.on('connection', (ws) => {
  ws.id = crypto.randomUUID();
  let userRoom = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === 'join') {
        userRoom = data.room;
        if (!rooms[userRoom]) {
          rooms[userRoom] = new Map();
        }

        // Evict any dead sockets
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

      // Targeted signaling (Offer / Answer / Candidate)
      if (data.target && rooms[userRoom] && rooms[userRoom].has(data.target)) {
        const targetClient = rooms[userRoom].get(data.target);
        if (targetClient && targetClient.readyState === 1) {
          targetClient.send(JSON.stringify({ ...data, sender: ws.id }));
        }
        return;
      }

      // Broadcast room-wide synchronization (Couple mode toggles, Ambience changes)
      if (userRoom && rooms[userRoom]) {
        rooms[userRoom].forEach((client) => {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify({ ...data, sender: ws.id }));
          }
        });
      }
    } catch (err) {
      console.error('Socket error:', err);
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
      if (rooms[userRoom].size === 0) {
        delete rooms[userRoom];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));