const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));
const rooms = {};

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    if (data.type === 'join') {
      if (!rooms[data.room]) rooms[data.room] = new Set();
      rooms[data.room].add(ws);
      return;
    }
    if (rooms[data.room]) {
      rooms[data.room].forEach(client => {
        if (client !== ws && client.readyState === 1) {
          client.send(JSON.stringify(data));
        }
      });
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Server is running!');
});