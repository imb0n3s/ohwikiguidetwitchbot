// web.js — the public site: landing page with "Add to my channel", OAuth callback,
// /setup for the bot account, /admin, /health
const express = require("express");
const crypto = require("crypto");
const cfg = require("./config");
const db = require("./db");
const twitch = require("./twitch");

// ---------- signed OAuth state (CSRF protection) ----------
function sign(data) {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  const mac = crypto.createHmac("sha256", cfg.SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(state) {
  const [body, mac] = String(state || "").split(".");
  if (!body || !mac) return null;
  const expect = crypto.createHmac("sha256", cfg.SESSION_SECRET).update(body).digest("base64url");
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString());
  if (Date.now() - data.ts > 10 * 60 * 1000) return null;
  return data;
}
function getCookie(req, name) {
  return (req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];
}

// ---------- HTML ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#0d1319;--card:#1f2a35;--accent:#0ea5e9;--text:#e6edf3;--muted:#9fb0c0;--twitch:#9146ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:48px 20px}
h1{font-size:2.2rem;margin:0 0 .3em}h2{font-size:1.2rem;margin:2em 0 .5em;color:var(--accent)}
p{color:var(--muted)}.card{background:var(--card);border-radius:12px;padding:20px 24px;margin:16px 0}
.btn{display:inline-block;padding:14px 26px;border-radius:10px;font-weight:600;text-decoration:none;color:#fff;background:var(--twitch)}
.btn.secondary{background:transparent;border:1px solid var(--muted);color:var(--text)}
.btn:hover{filter:brightness(1.1)}code,kbd{background:#0b1016;padding:2px 7px;border-radius:5px;color:#c9e7ff;font-size:.95em}
.stats{display:flex;gap:16px;flex-wrap:wrap}.stat{flex:1;min-width:140px;background:var(--card);border-radius:12px;padding:16px;text-align:center}
.stat b{display:block;font-size:2rem;color:var(--accent)}.chat{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;white-space:pre-wrap;color:#dfe8f0}
footer{margin-top:48px;color:var(--muted);font-size:.9em}footer a{color:var(--muted)}a{color:var(--accent)}
</style></head><body><main>${body}</main></body></html>`;
}

function landing() {
  const channels = db.countChannels();
  const answered = db.totalQuestions();
  const bot = db.getBotAccount();
  const cmd = cfg.COMMANDS[0];
  return page(cfg.BOT_NAME, `
<h1>${esc(cfg.BOT_NAME)}</h1>
<p>A Twitch chat bot for Once Human streamers. Viewers type <kbd>${esc(cmd)} &lt;question&gt;</kbd> and the bot answers straight from <a href="${esc(cfg.WIKI_BASE)}">${esc(cfg.WIKI_BASE.replace(/^https?:\/\//, ""))}</a> — deviations, builds, recipes, mods, locations — with a link to the page.</p>

<div class="card">
  <a class="btn" href="/auth/twitch?action=add">Add ${esc(cfg.BOT_NAME)} to my Twitch channel</a>
  &nbsp; <a class="btn secondary" href="/auth/twitch?action=remove">Remove it</a>
  <p style="margin-bottom:0">You'll log in with Twitch once. The bot only needs permission to read and post in your chat; it never touches your account otherwise.${bot ? ` Prefer chat? Go to <a href="https://twitch.tv/${esc(bot.login)}">twitch.tv/${esc(bot.login)}</a> and type <kbd>!join</kbd>.` : ""}</p>
</div>

<div class="stats"><div class="stat"><b>${channels}</b>channels</div><div class="stat"><b>${answered}</b>questions answered</div></div>

<h2>What it looks like in chat</h2>
<div class="card chat">viewer42: ${esc(cmd)} where does Butterfly's Emissary drop?
${esc(bot?.login || "ohwikibot")}: @viewer42 ${cfg.ANSWER_MODE === "claude"
  ? "Butterfly's Emissary drops from Securement Units in both Manibus and Way of Winter — there's no specific silo, it can come from any of them."
  : "Butterfly's Emissary — Drops From: Manibus: Securement Units; Way of Winter: Securement Units; Monolith: N/A | Notes: No specific Silo but can drop from anyone"} ${esc(cfg.WIKI_BASE)}/Butterfly's_Emissary</div>

<h2>Commands</h2>
<div class="card">
<p><kbd>${esc(cfg.COMMANDS.join("</kbd> / <kbd>"))}</kbd> &lt;question&gt; — ask anything about Once Human.</p>
<p><kbd>!ohwiki</kbd> — short help message.</p>
<p><kbd>!ohwiki cooldown 30</kbd> — (mods/broadcaster) per-viewer cooldown in seconds. Default ${cfg.USER_COOLDOWN_SECONDS}s.</p>
<p><kbd>!ohwiki leave</kbd> — (mods/broadcaster) remove the bot from your channel.</p>
</div>

<h2>How it works</h2>
<p>${cfg.ANSWER_MODE === "claude"
  ? "Each question is matched against the wiki's pages, the relevant page text is pulled live (so wiki edits show up within minutes), and an AI writes a short, chat-sized answer using only that wiki content. If the wiki doesn't cover something, the bot says so instead of guessing."
  : "Each question is matched against the wiki's pages, the best page is pulled live (so wiki edits show up within minutes), and the bot replies with the most relevant lines from it plus the link. Name the thing you're asking about — <kbd>!ask Atomic Snail</kbd> or <kbd>!ask where does Butterfly's Emissary drop</kbd> — and it'll find the page."}</p>
<p>Tip: mod the bot (<kbd>/mod ${esc(bot?.login || "ohwikibot")}</kbd>) so it isn't slowed by Twitch's rate limits for normal users.</p>

<footer><a href="${esc(cfg.TERMS_URL)}">Terms</a> · <a href="${esc(cfg.PRIVACY_URL)}">Privacy</a>${cfg.DISCORD_URL ? ` · <a href="${esc(cfg.DISCORD_URL)}">Discord</a>` : ""} · Not affiliated with Starry Studio / NetEase.</footer>`);
}

function simple(title, heading, text, extra = "") {
  return page(title, `<h1>${esc(heading)}</h1><p>${text}</p>${extra}<p><a href="/">&larr; Back</a></p>`);
}

// ---------- app ----------
function createApp(pool) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.get("/", (req, res) => res.send(landing()));
  app.get("/health", (req, res) => res.json({ ok: true, channels: pool.channelCount, botSetUp: !!db.getBotAccount() }));
  app.get("/api/stats", (req, res) => res.json({ channels: db.countChannels(), questions: db.totalQuestions() }));

  // Streamer: add / remove
  app.get("/auth/twitch", (req, res) => {
    if (!db.getBotAccount()) return res.status(503).send(simple("Not ready", "Bot not set up yet", "The bot owner hasn't finished setup."));
    const action = req.query.action === "remove" ? "remove" : "add";
    const state = sign({ purpose: "streamer", action, nonce: crypto.randomBytes(8).toString("hex"), ts: Date.now() });
    res.setHeader("Set-Cookie", `oh_state=${state}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${cfg.BASE_URL.startsWith("https") ? "; Secure" : ""}`);
    res.redirect(twitch.authorizeUrl({ scopes: action === "add" ? twitch.STREAMER_SCOPES : [], state }));
  });

  // Owner: one-time login AS THE BOT ACCOUNT to store its tokens
  app.get("/setup", (req, res) => {
    if (req.query.key !== cfg.ADMIN_KEY) return res.status(403).send(simple("Forbidden", "Forbidden", "Add ?key=YOUR_ADMIN_KEY to the URL."));
    const state = sign({ purpose: "bot", nonce: crypto.randomBytes(8).toString("hex"), ts: Date.now() });
    res.setHeader("Set-Cookie", `oh_state=${state}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${cfg.BASE_URL.startsWith("https") ? "; Secure" : ""}`);
    res.send(simple("Bot setup", "Step 1 of 1: log in as the bot account",
      `Click below and log in to Twitch <b>as the account the bot should chat from</b> (e.g. <code>ohwikibot</code>), not your personal account. ${db.getBotAccount() ? `Currently set up as <b>${esc(db.getBotAccount().login)}</b>; doing this again replaces it.` : ""}`,
      `<p><a class="btn" href="${esc(twitch.authorizeUrl({ scopes: twitch.BOT_SCOPES, state, forceVerify: true }))}">Log in as the bot account</a></p>`));
  });

  app.get("/auth/callback", async (req, res) => {
    try {
      if (req.query.error) return res.status(400).send(simple("Cancelled", "Cancelled", `Twitch said: ${esc(req.query.error_description || req.query.error)}. Nothing was changed.`));
      const state = verify(req.query.state);
      if (!state || getCookie(req, "oh_state") !== req.query.state) return res.status(400).send(simple("Error", "Login expired", "Please start again."));
      const tok = await twitch.exchangeCode(req.query.code);
      const user = await twitch.getUser(tok.access_token);

      if (state.purpose === "bot") {
        const wasSetUp = !!db.getBotAccount();
        db.saveBotAccount({ user_id: user.id, login: user.login, access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + tok.expires_in * 1000 });
        db.addChannel({ broadcaster_id: user.id, login: user.login, display_name: user.display_name, joined_via: "web" });
        await pool.join(user.id).catch((e) => console.error("[setup] join own channel failed:", e.message));
        if (!wasSetUp) await pool.joinAllFromDb();
        return res.send(simple("Setup complete", `Bot is running as ${user.display_name}`, `Streamers can now add it from <a href="/">the home page</a> or by typing <code>!join</code> in <a href="https://twitch.tv/${esc(user.login)}">twitch.tv/${esc(user.login)}</a>.`));
      }

      if (state.action === "remove") {
        db.removeChannel(user.id);
        await pool.leave(user.id);
        return res.send(simple("Removed", `Removed from ${user.display_name}'s channel`, "The bot has left your chat. You can add it back any time."));
      }
      db.addChannel({ broadcaster_id: user.id, login: user.login, display_name: user.display_name, joined_via: "web" });
      try { await pool.join(user.id); }
      catch (e) {
        if (e.message !== "NEEDS_PERMISSION") throw e;
        return res.status(500).send(simple("Almost", "Twitch didn't grant the bot permission", `Please try <a href="/auth/twitch?action=add">Add</a> again and make sure to click <b>Authorize</b> on Twitch's page, or type <code>/mod ${esc(db.getBotAccount().login)}</code> in your chat and then add again.`));
      }
      return res.send(simple("Added", `Added to ${user.display_name}'s channel!`,
        `Try it: type <code>${esc(cfg.COMMANDS[0])} what does Atomic Snail do</code> in your chat. Consider <code>/mod ${esc(db.getBotAccount().login)}</code> so the bot isn't rate-limited.`));
    } catch (e) {
      console.error("[auth] callback error:", e);
      res.status(500).send(simple("Error", "Something went wrong", esc(e.message)));
    }
  });

  // Builder dictionary: the Community Builds page exports its slug -> name map here
  // (see README "Builder data"). CORS is open because the page lives on the wiki domain.
  const builds = require("./builds");
  app.options("/admin/builder-dict", (req, res) => res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" }).sendStatus(204));
  app.post("/admin/builder-dict", express.json({ limit: "5mb" }), (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.query.key !== cfg.ADMIN_KEY) return res.status(403).json({ error: "forbidden" });
    const d = req.body;
    if (!d || typeof d.names !== "object") return res.status(400).json({ error: "expected { names: {slug: label}, sets: {itemSlug: setName} }" });
    builds.setDict({ names: d.names, sets: d.sets || {}, updated: Date.now() });
    res.json({ ok: true, names: Object.keys(d.names).length, sets: Object.keys(d.sets || {}).length });
  });
  app.get("/admin/builds", async (req, res) => {
    if (req.query.key !== cfg.ADMIN_KEY) return res.status(403).send("forbidden");
    try {
      const rows = await builds.getBuilds();
      const q = req.query.q;
      res.json({ dict: !!builds.getDict(), count: rows.length, answer: q ? await builds.answerBuild(String(q)) : undefined, sample: rows.slice(0, 3).map((r) => ({ id: r.id, user: r.user_id, summary: r.summary, decoded: r.decoded })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Diagnostic: send a test message as the bot and show Twitch's raw reply
  app.get("/admin/say", async (req, res) => {
    if (req.query.key !== cfg.ADMIN_KEY) return res.status(403).send("forbidden");
    try {
      const ch = db.getChannelByLogin(String(req.query.channel || db.getBotAccount().login));
      if (!ch) return res.status(404).json({ error: "channel not joined" });
      const r = await twitch.sendChat(ch.broadcaster_id, String(req.query.text || "test message from OH Wiki Guide Bot"));
      res.json({ channel: ch.login, result: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/admin", (req, res) => {
    if (req.query.key !== cfg.ADMIN_KEY) return res.status(403).send("forbidden");
    const rows = db.listEnabledChannels().map((c) => `<tr><td><a href="https://twitch.tv/${esc(c.login)}">${esc(c.display_name)}</a></td><td>${new Date(c.joined_at).toISOString().slice(0, 10)}</td><td>${esc(c.joined_via)}</td><td>${c.questions}</td><td>${pool.isJoined(c.broadcaster_id) ? "live" : "<b>not subscribed</b>"}</td></tr>`).join("");
    res.send(page("Admin", `<h1>Channels (${rows ? db.countChannels() : 0})</h1><div class="card"><table style="width:100%;border-collapse:collapse"><tr><th align=left>Channel</th><th align=left>Joined</th><th align=left>Via</th><th align=left>Q's</th><th align=left>Status</th></tr>${rows}</table></div><p>Conduit: ${esc(pool.conduitId || "none")}, subscriptions: ${pool.channelCount}, questions total: ${db.totalQuestions()}</p>`));
  });

  return app;
}

module.exports = { createApp };
