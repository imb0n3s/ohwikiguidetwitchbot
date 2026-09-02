// index.js — start the web site and the Twitch listener
const cfg = require("./config");
const db = require("./db");
const { Pool, cleanupOldSubscriptions } = require("./eventsub");
const { makeHandler } = require("./commands");
const { createApp } = require("./web");

async function main() {
  const pool = new Pool(null);
  pool.onChat = makeHandler(pool);

  const app = createApp(pool);
  app.listen(cfg.PORT, () => console.log(`[web] ${cfg.BOT_NAME} site on ${cfg.BASE_URL} (port ${cfg.PORT})`));

  if (db.getBotAccount()) {
    await cleanupOldSubscriptions().catch((e) => console.error("[eventsub] cleanup failed:", e.message));
    await pool.joinAllFromDb();
  } else {
    console.log(`[setup] No bot account yet. Open ${cfg.BASE_URL}/setup?key=${cfg.ADMIN_KEY} and log in as the bot's Twitch account.`);
  }
}

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
main().catch((e) => { console.error(e); process.exit(1); });
