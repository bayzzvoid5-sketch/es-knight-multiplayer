import { DurableObject } from "cloudflare:workers";

function send(ws, msg) {
  try { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch (_) {}
}
function cleanName(v, fallback) { return String(v || fallback).slice(0, 12); }
function randomRoom(rooms) {
  let code = "";
  do {
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);
    code = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  } while (rooms.has(code));
  return code;
}

export class RoomHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      const meta = ws.deserializeAttachment();
      if (meta) this.sessions.set(ws, meta);
    }
    try { this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch (_) {}
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Heroes Knight multiplayer WebSocket endpoint", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const meta = { room:null, role:null, name:"Player", weapon:"Sword" };
    server.serializeAttachment(meta);
    this.sessions.set(server, meta);
    return new Response(null, { status:101, webSocket:client });
  }

  roomMembers(roomCode) {
    const out = [];
    for (const [ws, meta] of this.sessions) if (meta.room === roomCode) out.push([ws, meta]);
    return out;
  }
  findRoom(roomCode) {
    const members = this.roomMembers(roomCode);
    return {
      host: members.find(([,m]) => m.role === "host"),
      guest: members.find(([,m]) => m.role === "guest")
    };
  }

  webSocketMessage(ws, message) {
    let m;
    try { m = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); }
    catch (_) { return; }

    const meta = this.sessions.get(ws) || ws.deserializeAttachment() ||
      { room:null, role:null, name:"Player", weapon:"Sword" };

    if (m.type === "create") {
      if (meta.room) return;
      const rooms = new Set();
      for (const [,s] of this.sessions) if (s.room) rooms.add(s.room);
      meta.room = randomRoom(rooms);
      meta.role = "host";
      meta.name = cleanName(m.name, "Player 1");
      meta.weapon = m.weapon || "Sword";
      ws.serializeAttachment(meta);
      this.sessions.set(ws, meta);
      send(ws, {type:"room_created", room:meta.room, id:"host"});
      return;
    }

    if (m.type === "join") {
      if (meta.room) return;
      const roomCode = String(m.room || "").toUpperCase();
      const room = this.findRoom(roomCode);
      if (!room || !room.host) return send(ws, {type:"error", message:"Room tidak ditemukan."});
      if (room.guest) return send(ws, {type:"error", message:"Room sudah penuh (2 pemain)."});
      meta.room = roomCode;
      meta.role = "guest";
      meta.name = cleanName(m.name, "Player 2");
      meta.weapon = m.weapon || "Sword";
      ws.serializeAttachment(meta);
      this.sessions.set(ws, meta);
      send(ws, {type:"joined", room:roomCode, id:"guest",
        hostName:room.host[1].name, hostWeapon:room.host[1].weapon});
      send(room.host[0], {type:"peer_joined", name:meta.name, weapon:meta.weapon});
      return;
    }

    const room = meta.room ? this.findRoom(meta.room) : null;
    if (!room) return;

    if (m.type === "input" && meta.role === "guest")
      return room.host && send(room.host[0], {type:"peer_input", input:m.input || {}});
    if (m.type === "action" && meta.role === "guest")
      return room.host && send(room.host[0], {type:"peer_action", action:m.action});
    if (m.type === "start" && meta.role === "host")
      return room.guest && send(room.guest[0], {type:"start", hostName:meta.name,
        hostWeapon:meta.weapon, room:meta.room});
    if (m.type === "snapshot" && meta.role === "host")
      return room.guest && send(room.guest[0], {type:"snapshot", state:m.state});
  }

  webSocketClose(ws) {
    const meta = this.sessions.get(ws) || ws.deserializeAttachment();
    this.sessions.delete(ws);
    if (!meta || !meta.room) return;
    const room = this.findRoom(meta.room);
    if (!room) return;
    if (meta.role === "host" && room.guest) send(room.guest[0], {type:"peer_left"});
    if (meta.role === "guest" && room.host) send(room.host[0], {type:"peer_left"});
  }
  webSocketError(ws) { this.webSocketClose(ws); }
}

export default {
  async fetch(request, env) {
    if (request.headers.get("Upgrade") === "websocket") {
      const id = env.ROOM_HUB.idFromName("heroes-knight-global");
      return env.ROOM_HUB.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
