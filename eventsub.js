// eventsub.js — reads chat from every joined channel over EventSub WebSockets.
// Twitch allows 3 sockets per user token and 300 subscriptions per socket, so
// one bot account covers up to 900 channels. (Past that: switch to Conduits.)
const WebSocket = require("ws");
const twitch = require("./twitch");

const WS_URL = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";
const MAX_SOCKETS = 3;
const MAX_SUBS_PER_SOCKET = 300;

class Socket {
  constructor(pool, url = WS_URL) {
    this.pool = pool;
    this.subs = new Map(); // broadcaster_id -> subscription id
    this.sessionId = null;
    this.ready = new Promise((r) => (this._resolveReady = r));
    this.closed = false;
    this.open(url, false);
  }

  open(url, isReconnect) {
    const ws = new WebSocket(url);
    ws.on("message", (raw) => this.onMessage(ws, JSON.parse(raw.toString()), isReconnect));
    ws.on("close", (code) => {
      if (ws !== this.ws) return; // an older socket we already replaced
      clearTimeout(this.keepTimer);
      if (this.closed) return;
      console.warn(`[eventsub] socket closed (${code}); reconnecting in 5s`);
      setTimeout(() => this.resubscribeAll(), 5000);
    });
    ws.on("error", (e) => console.error("[eventsub] socket error:", e.message));
    if (!isReconnect) this.ws = ws;
    this.pending = ws;
  }

  armKeepalive(seconds) {
    clearTimeout(this.keepTimer);
    this.keepTimer = setTimeout(() => {
      console.warn("[eventsub] keepalive missed; reconnecting");
      try { this.ws.terminate(); } catch {}
    }, (seconds + 10) * 1000);
  }

  async onMessage(ws, msg, isReconnect) {
    const type = msg.metadata?.message_type;
    if (type === "session_welcome") {
      this.sessionId = msg.payload.session.id;
      this.armKeepalive(msg.payload.session.keepalive_timeout_seconds);
      if (isReconnect) { // swap sockets; subscriptions carry over
        const old = this.ws; this.ws = ws; try { old.close(); } catch {}
      }
      this._resolveReady();
      return;
    }
    if (ws !== this.ws && !isReconnect) return;
    if (type === "session_keepalive") return this.armKeepalive(30);
    if (type === "session_reconnect") return this.open(msg.payload.session.reconnect_url, true);
    if (type === "revocation") {
      const bid = msg.payload.subscription.condition.broadcaster_user_id;
      console.warn(`[eventsub] subscription revoked for ${bid}: ${msg.payload.subscription.status}`);
      this.subs.delete(bid);
      return;
    }
    if (type === "notification") {
      this.armKeepalive(30);
      if (msg.metadata.subscription_type === "channel.chat.message") this.pool.onChat(msg.payload.event);
    }
  }

  // After an unexpected drop the session is gone, so make a fresh one and re-subscribe.
  async resubscribeAll() {
    const ids = [...this.subs.keys()];
    this.subs.clear();
    this.sessionId = null;
    this.ready = new Promise((r) => (this._resolveReady = r));
    this.open(WS_URL, false);
    await this.ready;
    for (const bid of ids) await this.subscribe(bid).catch((e) => console.error(`[eventsub] resubscribe ${bid} failed:`, e.message));
  }

  async subscribe(broadcasterId) {
    await this.ready;
    const bot = await twitch.getBotToken();
    const r = await twitch.helix("POST", "/eventsub/subscriptions", {
      body: {
        type: "channel.chat.message", version: "1",
        condition: { broadcaster_user_id: broadcasterId, user_id: bot.user_id },
        transport: { method: "websocket", session_id: this.sessionId },
      },
    });
    this.subs.set(broadcasterId, r.data[0].id);
  }

  async unsubscribe(broadcasterId) {
    const id = this.subs.get(broadcasterId);
    if (!id) return;
    this.subs.delete(broadcasterId);
    await twitch.helix("DELETE", "/eventsub/subscriptions", { query: { id } }).catch((e) => console.error("[eventsub] unsubscribe failed:", e.message));
  }
}

class Pool {
  constructor(onChat) {
    this.onChat = onChat;
    this.sockets = [];
  }

  socketFor(broadcasterId) {
    return this.sockets.find((s) => s.subs.has(broadcasterId));
  }

  async join(broadcasterId) {
    if (this.socketFor(broadcasterId)) return;
    let s = this.sockets.find((x) => x.subs.size < MAX_SUBS_PER_SOCKET);
    if (!s) {
      if (this.sockets.length >= MAX_SOCKETS) throw new Error("Channel limit reached for this bot account (900). Time to move to EventSub Conduits.");
      s = new Socket(this);
      this.sockets.push(s);
    }
    s.subs.set(broadcasterId, "pending"); // reserve the slot
    try { await s.subscribe(broadcasterId); } catch (e) { s.subs.delete(broadcasterId); throw e; }
  }

  async leave(broadcasterId) {
    const s = this.socketFor(broadcasterId);
    if (s) await s.unsubscribe(broadcasterId);
  }

  get channelCount() { return this.sockets.reduce((n, s) => n + s.subs.size, 0); }

  // On startup (or right after /setup): subscribe to the bot's own channel + every enabled channel
  async joinAllFromDb() {
    const db = require("./db");
    const bot = db.getBotAccount();
    if (!bot) return console.log("[eventsub] bot account not set up yet — open /setup?key=... in your browser");
    const ids = new Set([bot.user_id, ...db.listEnabledChannels().map((c) => c.broadcaster_id)]);
    let ok = 0;
    for (const id of ids) {
      try { await this.join(id); ok++; } catch (e) { console.error(`[eventsub] join ${id} failed:`, e.message); }
    }
    console.log(`[eventsub] listening in ${ok}/${ids.size} channels`);
  }
}

// Delete stale websocket subscriptions left over from earlier runs (they'd count against limits)
async function cleanupOldSubscriptions() {
  let cursor;
  let removed = 0;
  do {
    const r = await twitch.helix("GET", "/eventsub/subscriptions", { query: cursor ? { after: cursor } : {} });
    for (const s of r.data) {
      if (s.transport.method === "websocket" && s.status !== "enabled") {
        await twitch.helix("DELETE", "/eventsub/subscriptions", { query: { id: s.id } }).catch(() => {});
        removed++;
      }
    }
    cursor = r.pagination?.cursor;
  } while (cursor);
  if (removed) console.log(`[eventsub] cleaned up ${removed} stale subscriptions`);
}

module.exports = { Pool, cleanupOldSubscriptions };
