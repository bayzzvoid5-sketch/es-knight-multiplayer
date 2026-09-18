const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT = path.join(__dirname, 'index.html');
const rooms = new Map();

function code(){
  let c;
  do c = crypto.randomBytes(3).toString('hex').toUpperCase();
  while(rooms.has(c));
  return c;
}
function send(ws, msg){
  if(ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function roomOf(ws){
  for(const [roomCode, room] of rooms){
    if(room.host.ws === ws || room.guest?.ws === ws) return [roomCode, room];
  }
  return [null, null];
}
function cleanName(v, fallback){ return String(v || fallback).slice(0, 12); }

const server = http.createServer((req,res)=>{
  if(req.url === '/health'){
    res.writeHead(200, {'content-type':'application/json; charset=utf-8'});
    return res.end(JSON.stringify({ok:true, rooms:rooms.size}));
  }
  if(req.url !== '/' && !req.url.startsWith('/?')){
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(CLIENT,(err,data)=>{
    if(err){ res.writeHead(500); return res.end('Client file missing'); }
    res.writeHead(200, {
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store'
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({server});

wss.on('connection', ws=>{
  ws.meta = {room:null, role:null, name:'Player', weapon:'Sword'};

  ws.on('message', raw=>{
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    // Player 1 creates a room.
    if(m.type === 'create'){
      if(ws.meta.room) return;
      const room = code();
      const name = cleanName(m.name, 'Player 1');
      const weapon = m.weapon || 'Sword';
      rooms.set(room, {
        host:{ws,name,weapon},
        guest:null,
        started:false
      });
      ws.meta = {room,role:'host',name,weapon};
      return send(ws,{type:'room_created',room,id:'host'});
    }

    // Player 2 joins a room.
    if(m.type === 'join'){
      const roomCode = String(m.room || '').toUpperCase();
      const room = rooms.get(roomCode);
      if(!room) return send(ws,{type:'error',message:'Room tidak ditemukan.'});
      if(room.guest) return send(ws,{type:'error',message:'Room sudah penuh (2 pemain).'});
      if(ws.meta.room) return;

      const name = cleanName(m.name, 'Player 2');
      const weapon = m.weapon || 'Sword';
      room.guest = {ws,name,weapon};
      ws.meta = {room:roomCode,role:'guest',name,weapon};

      send(ws,{type:'joined',room:roomCode,id:'guest',hostName:room.host.name,hostWeapon:room.host.weapon});
      send(room.host.ws,{type:'peer_joined',name,weapon});
      return;
    }

    const [roomCode, room] = roomOf(ws);
    if(!room) return;

    // Player 2 -> Player 1 input/action relay.
    if(m.type === 'input' && ws.meta.role === 'guest'){
      return send(room.host.ws,{type:'peer_input',input:m.input || {}});
    }
    if(m.type === 'action' && ws.meta.role === 'guest'){
      return send(room.host.ws,{type:'peer_action',action:m.action});
    }

    // Player 1 starts the match -> Player 2.
    if(m.type === 'start' && ws.meta.role === 'host'){
      room.started = true;
      return send(room.guest?.ws, {
        type:'start',
        hostName:room.host.name,
        hostWeapon:room.host.weapon,
        room:roomCode
      });
    }

    // Player 1 simulation snapshot -> Player 2.
    if(m.type === 'snapshot' && ws.meta.role === 'host'){
      return send(room.guest?.ws,{type:'snapshot',state:m.state});
    }
  });

  ws.on('close',()=>{
    const [roomCode, room] = roomOf(ws);
    if(!room) return;
    if(room.host.ws === ws){
      send(room.guest?.ws,{type:'peer_left'});
      rooms.delete(roomCode);
    } else {
      send(room.host.ws,{type:'peer_left'});
      room.guest = null;
      room.started = false;
    }
  });
});

server.listen(PORT,HOST,()=>{
  console.log(`Heroes Knight multiplayer server: http://localhost:${PORT}`);
});
