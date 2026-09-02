require("dotenv").config();

function req(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env var ${name} (see .env.example)`); process.exit(1); }
  return v;
}

const cfg = {
  PORT: Number(process.env.PORT || 3000),
  BASE_URL: (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ""),
  TWITCH_CLIENT_ID: req("TWITCH_CLIENT_ID"),
  TWITCH_CLIENT_SECRET: req("TWITCH_CLIENT_SECRET"),
  ANSWER_MODE: (process.env.ANSWER_MODE || "free").toLowerCase() === "claude" ? "claude" : "free",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  ADMIN_KEY: req("ADMIN_KEY"),
  SESSION_SECRET: process.env.SESSION_SECRET || req("ADMIN_KEY"),
  DATA_DIR: process.env.DATA_DIR || "./data",
  BOT_NAME: process.env.BOT_NAME || "OH Wiki Bot",
  WIKI_BASE: process.env.WIKI_BASE || "https://ohwikiguide.com",
  COMMANDS: (process.env.COMMANDS || "!ask,!wiki").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  USER_COOLDOWN_SECONDS: Number(process.env.USER_COOLDOWN_SECONDS || 20),
  CHANNEL_COOLDOWN_SECONDS: Number(process.env.CHANNEL_COOLDOWN_SECONDS || 3),
  MAX_CONCURRENT_ANSWERS: Number(process.env.MAX_CONCURRENT_ANSWERS || 8),
  TERMS_URL: process.env.TERMS_URL || "https://ohwikiguide.com/OH_Wiki_Bot_Terms_of_Service",
  PRIVACY_URL: process.env.PRIVACY_URL || "https://ohwikiguide.com/Privacy_Policy",
  DISCORD_URL: process.env.DISCORD_URL || "",
};
if (cfg.ANSWER_MODE === "claude" && !cfg.ANTHROPIC_API_KEY) { console.error("ANSWER_MODE=claude needs ANTHROPIC_API_KEY"); process.exit(1); }
module.exports = cfg;
