import { DurableObject } from "cloudflare:workers";
import {
  createPlayer,
  fillFood,
  sanitizeName,
  sanitizeSkin,
  setDirection,
  stepMultiplayer
} from "./game-core.js";

const ROOM_PATTERN = /^[A-Z0-9]{4,8}$/;
const GRID = Object.freeze({ w: 48, h: 28 });
const TICK_MS = 110;
const COUNTDOWN_MS = 3200;
const ROUND_END_MS = 4200;

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function normalizeRoomCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "neon-snake-arena", now: Date.now() });
    }

    const match = url.pathname.match(/^\/api\/room\/([^/]+)(\/.*)?$/);
    if (match) {
      const roomCode = normalizeRoomCode(match[1]);
      if (!ROOM_PATTERN.test(roomCode)) {
        return json({ error: "Ungültiger Raumcode." }, { status: 400 });
      }
      const id = env.SNAKE_ROOMS.idFromName(roomCode);
      const stub = env.SNAKE_ROOMS.get(id);
      const forwardedUrl = new URL(request.url);
      forwardedUrl.searchParams.set("room", roomCode);
      return stub.fetch(new Request(forwardedUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};

export class SnakeRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.room = "";
    this.players = new Map();
    this.foods = [];
    this.status = "waiting";
    this.countdownEndsAt = 0;
    this.roundEndsAt = 0;
    this.round = 0;
    this.winner = null;
    this.tickHandle = null;
    this.lastBroadcastAt = 0;

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment();
      if (attachment && Number.isInteger(attachment.slot)) {
        this.players.set(
          attachment.slot,
          createPlayer(attachment.slot, attachment.name, attachment.skin, GRID)
        );
        this.room = attachment.room || this.room;
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.room = normalizeRoomCode(url.searchParams.get("room"));

    if (url.pathname.endsWith("/status")) {
      return json({
        room: this.room,
        connected: this.ctx.getWebSockets().length,
        status: this.status
      });
    }

    if (!url.pathname.endsWith("/ws")) {
      return json({ error: "Nicht gefunden." }, { status: 404 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket Upgrade erforderlich", { status: 426 });
    }

    const slot = this.findFreeSlot();
    if (slot === -1) {
      return json({ error: "Dieser Raum ist bereits voll." }, { status: 409 });
    }

    const name = sanitizeName(url.searchParams.get("name"), `Spieler ${slot + 1}`);
    const skin = sanitizeSkin(url.searchParams.get("skin"));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const attachment = { slot, name, skin, room: this.room };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`slot-${slot}`]);
    this.players.set(slot, createPlayer(slot, name, skin, GRID));

    server.send(JSON.stringify({
      type: "welcome",
      slot,
      room: this.room,
      grid: GRID,
      message: slot === 0 ? "Warte auf Spieler 2 …" : "Gegner gefunden."
    }));

    this.broadcast({ type: "presence", connected: this.ctx.getWebSockets().length });

    if (this.ctx.getWebSockets().length === 2) {
      this.startRound();
    } else {
      this.status = "waiting";
      this.broadcastState(true);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    let payload;
    try {
      payload = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    const attachment = ws.deserializeAttachment();
    if (!attachment || !Number.isInteger(attachment.slot)) return;
    const player = this.players.get(attachment.slot);
    if (!player) return;

    if (payload.type === "input" && typeof payload.direction === "string") {
      setDirection(player, payload.direction);
    } else if (payload.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
    } else if (payload.type === "rematch" && this.status === "over" && this.ctx.getWebSockets().length === 2) {
      this.startRound();
    }
  }

  webSocketClose(ws) {
    this.removeSocket(ws);
  }

  webSocketError(ws) {
    this.removeSocket(ws);
  }

  findFreeSlot() {
    const used = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment();
      if (attachment && Number.isInteger(attachment.slot)) used.add(attachment.slot);
    }
    if (!used.has(0)) return 0;
    if (!used.has(1)) return 1;
    return -1;
  }

  removeSocket(ws) {
    const attachment = ws.deserializeAttachment();
    if (attachment && Number.isInteger(attachment.slot)) {
      this.players.delete(attachment.slot);
    }
    this.stopLoop();
    this.status = "waiting";
    this.winner = null;
    this.foods = [];
    this.broadcast({ type: "opponent-left", message: "Der andere Spieler hat den Raum verlassen." });
    this.broadcastState(true);
  }

  startRound() {
    const attachments = this.ctx.getWebSockets()
      .map((ws) => ws.deserializeAttachment())
      .filter(Boolean);

    this.players.clear();
    for (const attachment of attachments) {
      this.players.set(
        attachment.slot,
        createPlayer(attachment.slot, attachment.name, attachment.skin, GRID)
      );
    }

    this.foods = fillFood(GRID, [...this.players.values()], [], 6);
    this.round += 1;
    this.status = "countdown";
    this.winner = null;
    this.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    this.roundEndsAt = 0;
    this.startLoop();
    this.broadcast({ type: "round-start", round: this.round });
    this.broadcastState(true);
  }

  startLoop() {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  stopLoop() {
    if (!this.tickHandle) return;
    clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  tick() {
    const now = Date.now();

    if (this.ctx.getWebSockets().length < 2) {
      this.stopLoop();
      this.status = "waiting";
      this.broadcastState(true);
      return;
    }

    if (this.status === "countdown") {
      if (now >= this.countdownEndsAt) {
        this.status = "playing";
        this.broadcast({ type: "go" });
      }
      this.broadcastState();
      return;
    }

    if (this.status === "over") {
      this.broadcastState();
      if (now >= this.roundEndsAt) this.startRound();
      return;
    }

    if (this.status !== "playing") return;

    const orderedPlayers = [this.players.get(0), this.players.get(1)].filter(Boolean);
    const result = stepMultiplayer(orderedPlayers, this.foods, GRID);
    this.foods = result.foods;

    for (const event of result.events) {
      this.broadcast({ type: event.type, slot: event.slot, food: event.food || null });
    }

    if (result.alive.length <= 1) {
      this.status = "over";
      this.roundEndsAt = now + ROUND_END_MS;
      this.winner = result.alive.length === 1 ? result.alive[0].slot : -1;
      this.broadcast({ type: "round-over", winner: this.winner, round: this.round });
    }

    this.broadcastState(true);
  }

  publicPlayer(player) {
    return {
      slot: player.slot,
      name: player.name,
      skin: player.skin,
      body: player.body,
      dir: player.dir,
      alive: player.alive,
      score: player.score,
      foods: player.foods
    };
  }

  broadcastState(force = false) {
    const now = Date.now();
    if (!force && now - this.lastBroadcastAt < 70) return;
    this.lastBroadcastAt = now;

    const countdown = this.status === "countdown"
      ? Math.max(0, Math.ceil((this.countdownEndsAt - now) / 1000))
      : 0;

    this.broadcast({
      type: "state",
      room: this.room,
      status: this.status,
      round: this.round,
      winner: this.winner,
      countdown,
      grid: GRID,
      food: this.foods,
      players: [...this.players.values()].map((player) => this.publicPlayer(player))
    });
  }

  broadcast(payload) {
    const encoded = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(encoded);
      } catch {
        // Closed sockets are cleaned up by the runtime close/error handlers.
      }
    }
  }
}
