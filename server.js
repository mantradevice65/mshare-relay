const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'M_Share Cloud Relay', status: 'ONLINE' }));
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

function generateCode() {
  let code;
  let attempts = 0;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
    attempts++;
  } while (rooms.has(code) && attempts < 1000);
  return code;
}

wss.on('connection', (ws) => {
  let boundCode = null;
  let clientRole = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'REGISTER_MOBILE') {
        boundCode = generateCode();
        clientRole = 'MOBILE';
        rooms.set(boundCode, { mobileWs: ws, pcWs: null });
        ws.send(JSON.stringify({ type: 'CODE_ASSIGNED', code: boundCode }));
        console.log(`[ROOM CREATED] PIN: ${boundCode}`);
      }
      else if (msg.type === 'JOIN_PC') {
        const targetCode = (msg.code || '').trim();
        if (rooms.has(targetCode)) {
          const session = rooms.get(targetCode);
          if (!session.pcWs || session.pcWs.readyState !== WebSocket.OPEN) {
            boundCode = targetCode;
            clientRole = 'PC';
            session.pcWs = ws;
            ws.send(JSON.stringify({ type: 'JOINED_SUCCESS', code: boundCode }));
            if (session.mobileWs && session.mobileWs.readyState === WebSocket.OPEN) {
              session.mobileWs.send(JSON.stringify({ type: 'PEER_CONNECTED' }));
            }
            console.log(`[PAIRED] PC joined Room: ${boundCode}`);
          } else {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Room already active' }));
          }
        } else {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid 6-Digit PIN' }));
        }
      }
      else if (msg.type === 'TRIGGER_CAPTURE') {
        if (boundCode && rooms.has(boundCode)) {
          const session = rooms.get(boundCode);
          if (session.mobileWs && session.mobileWs.readyState === WebSocket.OPEN) {
            session.mobileWs.send(JSON.stringify(msg));
          }
        }
      }
      else if (msg.type === 'CAPTURE_RESPONSE') {
        if (boundCode && rooms.has(boundCode)) {
          const session = rooms.get(boundCode);
          if (session.pcWs && session.pcWs.readyState === WebSocket.OPEN) {
            session.pcWs.send(JSON.stringify(msg));
          }
        }
      }
    } catch (err) {
      console.error(err.message);
    }
  });

  ws.on('close', () => {
    if (boundCode && rooms.has(boundCode)) {
      const session = rooms.get(boundCode);
      const target = (clientRole === 'MOBILE') ? session.pcWs : session.mobileWs;
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({ type: 'PEER_DISCONNECTED' }));
      }
      if (clientRole === 'MOBILE') rooms.delete(boundCode);
      else session.pcWs = null;
    }
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

server.listen(PORT, () => {
  console.log(`M_Share Relay running on port ${PORT}`);
});
