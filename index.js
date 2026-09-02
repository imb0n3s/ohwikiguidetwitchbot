// index.js — start the web site and the Twitch listener
const cfg = require("./config");
const db = require("./db");
const { Conduit } = require("./eventsub");
const { makeHandler } = require("./commands");
const { createApp } = require("./web");

async function main() {
  const pool = new Conduit(null);
  pool.onChat = makeHandler(pool);

  const app = createApp(pool);
  app.listen(cfg.PORT, () => console.log(`[web] ${cfg.BOT_NAME} site on ${cfg.BASE_URL} (port ${cfg.PORT})`));

  if (db.getBotAccount()) {
    await pool.joinAllFromDb().catch((e) => console.error("[eventsub] startup failed:", e.message));
  } else {
    console.log(`[setup] No bot account yet. Open ${cfg.BASE_URL}/setup?key=${cfg.ADMIN_KEY} and log in as the bot's Twitch account.`);
  }
}

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
main().catch((e) => { console.error(e); process.exit(1); });
