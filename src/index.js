import { DurableObject } from "cloudflare:workers";

function send(ws, msg) {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  } catch (_) {}
}

function cleanName(v, fallback) {
  return String(v || fallback).slice(0, 12);
}

function randomRoom(rooms) {
  let code = "";

  do {
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);

    code = Array.from(
      bytes,
      b => b.toString(16).padStart(2, "0")
    ).join("").toUpperCase();

  } while (rooms.has(code));

  return code;
}

export class RoomHub extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);

    this.env = env;
    this.sessions = new Map();

    for (const ws of this.ctx.getWebSockets()) {
      const meta = ws.deserializeAttachment();

      if (meta) {
        this.sessions.set(ws, meta);
      }
    }

    try {
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong")
      );
    } catch (_) {}
  }

  async fetch(request) {

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(
        "Heroes Knight Multiplayer WebSocket",
        {
          status: 426,
          headers: {
            "content-type": "text/plain; charset=utf-8"
          }
        }
      );
    }

    const pair = new WebSocketPair();

    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const meta = {
      room: null,
      role: null,
      name: "Player",
      weapon: "Sword"
    };

    server.serializeAttachment(meta);

    this.sessions.set(server, meta);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  roomMembers(roomCode) {

    const members = [];

    for (const [ws, meta] of this.sessions) {

      if (meta.room === roomCode) {
        members.push([ws, meta]);
      }

    }

    return members;
  }

  findRoom(roomCode) {

    const members = this.roomMembers(roomCode);

    if (!members.length) {
      return null;
    }

    const host = members.find(
      ([, meta]) => meta.role === "host"
    );

    const guest = members.find(
      ([, meta]) => meta.role === "guest"
    );

    return {
      host,
      guest
    };
  }

  webSocketMessage(ws, message) {

    let m;

    try {

      m = JSON.parse(
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message)
      );

    } catch (_) {

      return;

    }

    const meta =
      this.sessions.get(ws) ||
      ws.deserializeAttachment() ||
      {
        room: null,
        role: null,
        name: "Player",
        weapon: "Sword"
      };

    // =========================
    // CREATE ROOM
    // =========================

    if (m.type === "create") {

      if (meta.room) {
        return;
      }

      const activeRooms = new Set();

      for (const [, s] of this.sessions) {

        if (s.room) {
          activeRooms.add(s.room);
        }

      }

      const room = randomRoom(activeRooms);

      meta.room = room;
      meta.role = "host";
      meta.name = cleanName(m.name, "Player 1");
      meta.weapon = m.weapon || "Sword";

      ws.serializeAttachment(meta);
      this.sessions.set(ws, meta);

      send(ws, {
        type: "room_created",
        room: room,
        id: "host"
      });

      return;
    }

    // =========================
    // JOIN ROOM
    // =========================

    if (m.type === "join") {

      if (meta.room) {
        return;
      }

      const roomCode = String(
        m.room || ""
      ).toUpperCase();

      const room = this.findRoom(roomCode);

      if (!room || !room.host) {

        send(ws, {
          type: "error",
          message: "Room tidak ditemukan."
        });

        return;
      }

      if (room.guest) {

        send(ws, {
          type: "error",
          message: "Room sudah penuh (2 pemain)."
        });

        return;
      }

      meta.room = roomCode;
      meta.role = "guest";
      meta.name = cleanName(m.name, "Player 2");
      meta.weapon = m.weapon || "Sword";

      ws.serializeAttachment(meta);
      this.sessions.set(ws, meta);

      // Kirim ke player 2
      send(ws, {
        type: "joined",
        room: roomCode,
        id: "guest",

        hostName: room.host[1].name,
        hostWeapon: room.host[1].weapon
      });

      // Beritahu player 1
      send(room.host[0], {
        type: "peer_joined",
        name: meta.name,
        weapon: meta.weapon
      });

      return;
    }

    const roomCode = meta.room;

    const room = roomCode
      ? this.findRoom(roomCode)
      : null;

    if (!room) {
      return;
    }

    // =========================
    // PLAYER 2 INPUT
    // =========================

    if (
      m.type === "input" &&
      meta.role === "guest"
    ) {

      if (room.host) {

        send(room.host[0], {
          type: "peer_input",
          input: m.input || {}
        });

      }

      return;
    }

    // =========================
    // PLAYER 2 ACTION
    // =========================

    if (
      m.type === "action" &&
      meta.role === "guest"
    ) {

      if (room.host) {

        send(room.host[0], {
          type: "peer_action",
          action: m.action
        });

      }

      return;
    }

    // =========================
    // START GAME
    // =========================

    if (
      m.type === "start" &&
      meta.role === "host"
    ) {

      if (room.guest) {

        send(room.guest[0], {
          type: "start",

          hostName: meta.name,
          hostWeapon: meta.weapon,

          room: roomCode
        });

      }

      return;
    }

    // =========================
    // GAME SNAPSHOT
    // =========================

    if (
      m.type === "snapshot" &&
      meta.role === "host"
    ) {

      if (room.guest) {

        send(room.guest[0], {
          type: "snapshot",
          state: m.state
        });

      }

      return;
    }
  }

  webSocketClose(ws) {

    const meta =
      this.sessions.get(ws) ||
      ws.deserializeAttachment();

    this.sessions.delete(ws);

    if (!meta || !meta.room) {
      return;
    }

    const room = this.findRoom(meta.room);

    if (!room) {
      return;
    }

    if (meta.role === "host") {

      if (room.guest) {

        send(room.guest[0], {
          type: "peer_left"
        });

      }

    } else if (meta.role === "guest") {

      if (room.host) {

        send(room.host[0], {
          type: "peer_left"
        });

      }

    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}


// ========================================
// CLOUDFLARE WORKER
// ========================================

export default {

  async fetch(request, env) {

    const url = new URL(request.url);
    if (url.pathname === "/test") {
  return new Response("WORKER HIDUP", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
    }

    // =========================
    // WEBSOCKET
    // =========================

    if (
      url.pathname === "/websocket" &&
      request.headers.get("Upgrade") === "websocket"
    ) {

      const id =
        env.ROOM_HUB.idFromName(
          "heroes-knight-global"
        );

      const stub =
        env.ROOM_HUB.get(id);

      return stub.fetch(request);
    }

    // =========================
    // WEBSITE / GAME
    // =========================

    return env.ASSETS.fetch(request);
  }
};
