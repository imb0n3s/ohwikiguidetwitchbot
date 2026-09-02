// twitch.js — OAuth helpers, token refresh for the bot account, Helix calls
const cfg = require("./config");
const db = require("./db");

const OAUTH = "https://id.twitch.tv/oauth2";
const HELIX = "https://api.twitch.tv/helix";

// Scopes the BOT ACCOUNT grants once (during /setup)
const BOT_SCOPES = ["user:read:chat", "user:write:chat", "user:bot"];
// Scope a STREAMER grants when adding the bot (lets the bot act as a bot in their channel)
const STREAMER_SCOPES = ["channel:bot"];

function authorizeUrl({ scopes, state, forceVerify = false }) {
  const u = new URL(`${OAUTH}/authorize`);
  u.search = new URLSearchParams({
    client_id: cfg.TWITCH_CLIENT_ID,
    redirect_uri: `${cfg.BASE_URL}/auth/callback`,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    ...(forceVerify ? { force_verify: "true" } : {}),
  });
  return u.toString();
}

async function exchangeCode(code) {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.TWITCH_CLIENT_ID, client_secret: cfg.TWITCH_CLIENT_SECRET,
      code, grant_type: "authorization_code", redirect_uri: `${cfg.BASE_URL}/auth/callback`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_in, scope, token_type }
}

async function refreshToken(refresh_token) {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.TWITCH_CLIENT_ID, client_secret: cfg.TWITCH_CLIENT_SECRET,
      grant_type: "refresh_token", refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getUser(accessToken) {
  const res = await fetch(`${HELIX}/users`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": cfg.TWITCH_CLIENT_ID },
  });
  if (!res.ok) throw new Error(`/users failed: ${res.status}`);
  const { data } = await res.json();
  return data[0]; // { id, login, display_name, ... }
}

async function getUsersByLogin(accessToken, logins) {
  const u = new URL(`${HELIX}/users`);
  for (const l of logins) u.searchParams.append("login", l);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": cfg.TWITCH_CLIENT_ID } });
  if (!res.ok) throw new Error(`/users failed: ${res.status}`);
  return (await res.json()).data;
}

// ---------- app access token (client credentials) ----------
// Used for EventSub conduits and for sending chat. This is what makes Twitch
// list the account under "Chat Bots" instead of as a regular user.
let appToken = null; // { token, expires_at }

async function getAppToken(force = false) {
  if (!force && appToken && Date.now() < appToken.expires_at - 5 * 60 * 1000) return appToken.token;
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.TWITCH_CLIENT_ID, client_secret: cfg.TWITCH_CLIENT_SECRET, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`app token failed: ${res.status} ${await res.text()}`);
  const t = await res.json();
  appToken = { token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
  return appToken.token;
}

// ---------- bot account token management ----------

let refreshing = null;

async function getBotToken() {
  const bot = db.getBotAccount();
  if (!bot) throw new Error("Bot account not set up yet — open /setup in the browser.");
  if (Date.now() < bot.expires_at - 5 * 60 * 1000) return bot;
  if (!refreshing) refreshing = doRefresh(bot).finally(() => (refreshing = null));
  return refreshing;
}

async function doRefresh(bot) {
  const t = await refreshToken(bot.refresh_token);
  const updated = { ...bot, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  db.saveBotAccount(updated);
  console.log("[twitch] refreshed bot token");
  return updated;
}

// Helix call, retrying once on 401 after a refresh. `as: "app"` uses the app token
// (EventSub conduits, sending chat); `as: "bot"` (default) uses the bot account's token.
async function helix(method, path, { body, query, as = "bot" } = {}) {
  const call = async (token) => {
    const u = new URL(`${HELIX}${path}`);
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return fetch(u, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Client-Id": cfg.TWITCH_CLIENT_ID, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  };
  let res;
  if (as === "app") {
    res = await call(await getAppToken());
    if (res.status === 401) res = await call(await getAppToken(true));
  } else {
    let bot = await getBotToken();
    res = await call(bot.access_token);
    if (res.status === 401) { bot = await doRefresh(bot); res = await call(bot.access_token); }
  }
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Helix ${method} ${path} -> ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function sendChat(broadcasterId, message, replyToMessageId) {
  const bot = db.getBotAccount();
  const r = await helix("POST", "/chat/messages", {
    as: "app",
    body: {
      broadcaster_id: broadcasterId,
      sender_id: bot.user_id,
      message: message.slice(0, 500),
      ...(replyToMessageId ? { reply_parent_message_id: replyToMessageId } : {}),
    },
  });
  const d = r?.data?.[0];
  if (!d || !d.is_sent) console.warn(`[twitch] message NOT sent in ${broadcasterId}: ${JSON.stringify(r)}`);
  else console.log(`[twitch] sent to ${broadcasterId}: ${message.slice(0, 80)}`);
  return d;
}

module.exports = { BOT_SCOPES, STREAMER_SCOPES, authorizeUrl, getAppToken, exchangeCode, refreshToken, getUser, getUsersByLogin, getBotToken, helix, sendChat };
