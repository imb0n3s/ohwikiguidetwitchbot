// lights.js — flash the owner's Govee light on Twitch follows, subs and raids.
//
// Off unless GOVEE_API_KEY and LIGHTS_CHANNEL are set. Events arrive through the same
// EventSub conduit as chat; the streamer grants the extra read scopes once at
// /lights/connect?key=ADMIN_KEY. Govee's cloud API is rate limited, so a flash is a
// few slow pulses (not a strobe), alerts play one at a time, and floods get trimmed.
const crypto = require("crypto");
const twitch = require("./twitch");

const GOVEE = "https://openapi.api.govee.com/router/api/v1";
const KEY = process.env.GOVEE_API_KEY || "";
const CHANNEL = (process.env.LIGHTS_CHANNEL || "").toLowerCase().trim();
const DEVICE_NAME = (process.env.GOVEE_DEVICE_NAME || "Govee Glide wall light").toLowerCase().trim();
const STEP_MS = Number(process.env.LIGHTS_STEP_MS || 900);

const SCOPES = ["moderator:read:followers", "channel:read:subscriptions"];

const PURPLE = 0x9146ff, GREEN = 0x00ff40, RED = 0xff0000, BLUE = 0x0040ff;
const PATTERNS = {
  follow: [{ color: PURPLE }, { bright: 5 }, { bright: 100 }, { bright: 5 }, { bright: 100 }],
  sub: [{ color: GREEN }, { bright: 5 }, { bright: 100 }, { bright: 5 }, { bright: 100 }],
  raid: [{ color: RED, bright: 100 }, { color: BLUE }, { color: RED }, { color: BLUE }, { color: RED }, { color: BLUE }],
};

const enabled = () => !!(KEY && CHANNEL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let broadcasterId = null;
let device = null; // { sku, device, deviceName }

// ---------- Govee API ----------
async function govee(method, path, payload) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${GOVEE}${path}`, {
      method,
      headers: { "Govee-API-Key": KEY, "Content-Type": "application/json" },
      body: payload ? JSON.stringify({ requestId: crypto.randomUUID(), payload }) : undefined,
    });
    if (res.status === 429 && attempt === 0) { await sleep(Number(res.headers.get("retry-after") || 5) * 1000); continue; }
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch { j = null; }
    if (!res.ok || (j && j.code && j.code !== 200)) throw new Error(`Govee ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    return j;
  }
}

async function listDevices() {
  return (await govee("GET", "/user/devices")).data || [];
}

async function getDevice() {
  if (device) return device;
  const all = await listDevices();
  const d = all.find((x) => (x.deviceName || "").toLowerCase().trim() === DEVICE_NAME)
    || all.find((x) => (x.deviceName || "").toLowerCase().includes(DEVICE_NAME));
  if (!d) throw new Error(`No Govee device named "${DEVICE_NAME}". Found: ${all.map((x) => `${x.deviceName} (${x.sku})`).join(", ") || "none"}`);
  device = { sku: d.sku, device: d.device, deviceName: d.deviceName };
  console.log(`[lights] using ${d.deviceName} (${d.sku})`);
  return device;
}

async function control(type, instance, value) {
  const d = await getDevice();
  await govee("POST", "/device/control", { sku: d.sku, device: d.device, capability: { type, instance, value } });
}
const setPower = (on) => control("devices.capabilities.on_off", "powerSwitch", on ? 1 : 0);
const setColor = (rgb) => control("devices.capabilities.color_setting", "colorRgb", rgb);
const setTemp = (k) => control("devices.capabilities.color_setting", "colorTemperatureK", k);
const setBright = (b) => control("devices.capabilities.range", "brightness", b);

async function getState() {
  const d = await getDevice();
  const r = await govee("POST", "/device/state", { sku: d.sku, device: d.device });
  const s = {};
  for (const c of r.payload?.capabilities || []) s[c.instance] = c.state?.value;
  return s;
}

// ---------- flashing ----------
async function flash(kind) {
  const steps = PATTERNS[kind];
  if (!steps) throw new Error(`unknown alert ${kind}`);
  let before = null;
  try { before = await getState(); } catch (e) { console.warn("[lights] couldn't read state, won't restore:", e.message); }
  try {
    if (before && !before.powerSwitch) await setPower(true);
    for (const st of steps) {
      if (st.color != null) await setColor(st.color);
      if (st.bright != null) await setBright(st.bright);
      await sleep(STEP_MS);
    }
  } finally {
    if (before) {
      try {
        if (!before.powerSwitch) await setPower(false);
        else {
          if (before.colorTemperatureK) await setTemp(before.colorTemperatureK);
          else if (before.colorRgb != null) await setColor(before.colorRgb);
          if (before.brightness) await setBright(before.brightness);
        }
      } catch (e) { console.warn("[lights] restore failed:", e.message); }
    }
  }
}

// One alert at a time. If chat gets flooded (follow bots, gift bombs) keep at most a
// few of each kind queued so the light doesn't flash for ten minutes.
const queue = [];
let running = false;
function enqueue(kind, who) {
  if (queue.filter((q) => q.kind === kind).length >= 2) return;
  queue.push({ kind, who });
  if (!running) drain();
}
async function drain() {
  running = true;
  while (queue.length) {
    const { kind, who } = queue.shift();
    console.log(`[lights] ${kind}${who ? ` (${who})` : ""}`);
    try { await flash(kind); } catch (e) { console.error(`[lights] ${kind} failed:`, e.message); }
  }
  running = false;
}

// ---------- Twitch events ----------
function subscriptionsFor(id) {
  return [
    { type: "channel.follow", version: "2", condition: { broadcaster_user_id: id, moderator_user_id: id } },
    { type: "channel.subscribe", version: "1", condition: { broadcaster_user_id: id } },
    { type: "channel.subscription.gift", version: "1", condition: { broadcaster_user_id: id } },
    { type: "channel.subscription.message", version: "1", condition: { broadcaster_user_id: id } },
    { type: "channel.raid", version: "1", condition: { to_broadcaster_user_id: id } },
  ];
}

// Subscribe the conduit to this channel's follow/sub/raid events. Returns which failed.
async function subscribe(pool, id) {
  const missing = [];
  for (const s of subscriptionsFor(id)) {
    try {
      await twitch.helix("POST", "/eventsub/subscriptions", { as: "app", body: { ...s, transport: { method: "conduit", conduit_id: pool.conduitId } } });
    } catch (e) {
      if (e.status === 409) continue; // already there
      missing.push(s.type);
      console.warn(`[lights] subscribe ${s.type} failed: ${e.message}`);
    }
  }
  return missing;
}

function onEvent(type, ev) {
  if (!broadcasterId) return;
  const bid = ev.broadcaster_user_id || ev.to_broadcaster_user_id;
  if (bid !== broadcasterId) return;
  if (type === "channel.follow") return enqueue("follow", ev.user_login);
  if (type === "channel.subscribe") return ev.is_gift ? undefined : enqueue("sub", ev.user_login); // gifts: one flash per gift bomb, below
  if (type === "channel.subscription.gift") return enqueue("sub", ev.user_login || "anonymous gift");
  if (type === "channel.subscription.message") return enqueue("sub", ev.user_login);
  if (type === "channel.raid") return enqueue("raid", ev.from_broadcaster_user_login);
}

async function init(pool) {
  if (!enabled()) return console.log("[lights] off (set GOVEE_API_KEY and LIGHTS_CHANNEL to enable)");
  const users = await twitch.helix("GET", "/users", { as: "app", query: { login: CHANNEL } });
  broadcasterId = users.data[0]?.id;
  if (!broadcasterId) return console.error(`[lights] Twitch user ${CHANNEL} not found`);
  getDevice().catch((e) => console.error("[lights]", e.message));
  const missing = await subscribe(pool, broadcasterId);
  if (missing.length) console.warn(`[lights] not yet authorized for ${missing.join(", ")} — open /lights/connect?key=ADMIN_KEY as ${CHANNEL}`);
  else console.log(`[lights] listening for follows/subs/raids in ${CHANNEL}`);
}

module.exports = { SCOPES, enabled, init, subscribe, onEvent, enqueue, listDevices, getState, channel: () => CHANNEL, broadcasterId: () => broadcasterId };
