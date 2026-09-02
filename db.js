// db.js — SQLite storage: joined channels, the bot account's tokens, usage stats
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const cfg = require("./config");

fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
const db = new Database(path.join(cfg.DATA_DIR, "ohwiki-bot.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS channels (
  broadcaster_id TEXT PRIMARY KEY,
  login          TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  joined_at      INTEGER NOT NULL,
  joined_via     TEXT NOT NULL,        -- 'web' | 'chat'
  enabled        INTEGER NOT NULL DEFAULT 1,
  user_cooldown  INTEGER,              -- per-channel override (seconds)
  questions      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bot_account (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  user_id       TEXT NOT NULL,
  login         TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             INTEGER NOT NULL,
  broadcaster_id TEXT NOT NULL,
  chatter        TEXT NOT NULL,
  question       TEXT NOT NULL,
  source_page    TEXT,
  ok             INTEGER NOT NULL
);
`);

const q = {
  upsertChannel: db.prepare(`INSERT INTO channels (broadcaster_id, login, display_name, joined_at, joined_via, enabled)
    VALUES (@broadcaster_id, @login, @display_name, @joined_at, @joined_via, 1)
    ON CONFLICT(broadcaster_id) DO UPDATE SET login=excluded.login, display_name=excluded.display_name, enabled=1`),
  disableChannel: db.prepare(`UPDATE channels SET enabled=0 WHERE broadcaster_id=?`),
  getChannel: db.prepare(`SELECT * FROM channels WHERE broadcaster_id=?`),
  getChannelByLogin: db.prepare(`SELECT * FROM channels WHERE login=?`),
  listEnabled: db.prepare(`SELECT * FROM channels WHERE enabled=1 ORDER BY joined_at`),
  countEnabled: db.prepare(`SELECT COUNT(*) AS n FROM channels WHERE enabled=1`),
  setCooldown: db.prepare(`UPDATE channels SET user_cooldown=? WHERE broadcaster_id=?`),
  bumpQuestions: db.prepare(`UPDATE channels SET questions=questions+1 WHERE broadcaster_id=?`),
  getBot: db.prepare(`SELECT * FROM bot_account WHERE id=1`),
  saveBot: db.prepare(`INSERT INTO bot_account (id, user_id, login, access_token, refresh_token, expires_at)
    VALUES (1, @user_id, @login, @access_token, @refresh_token, @expires_at)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, login=excluded.login, access_token=excluded.access_token,
      refresh_token=excluded.refresh_token, expires_at=excluded.expires_at`),
  logQuestion: db.prepare(`INSERT INTO questions (ts, broadcaster_id, chatter, question, source_page, ok) VALUES (?, ?, ?, ?, ?, ?)`),
  totalQuestions: db.prepare(`SELECT COUNT(*) AS n FROM questions`),
  getSetting: db.prepare(`SELECT value FROM settings WHERE key=?`),
  setSetting: db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
};

module.exports = {
  addChannel: (c) => q.upsertChannel.run({ joined_at: Date.now(), ...c }),
  removeChannel: (id) => q.disableChannel.run(id),
  getChannel: (id) => q.getChannel.get(id),
  getChannelByLogin: (login) => q.getChannelByLogin.get(login.toLowerCase()),
  listEnabledChannels: () => q.listEnabled.all(),
  countChannels: () => q.countEnabled.get().n,
  setCooldown: (id, s) => q.setCooldown.run(s, id),
  bumpQuestions: (id) => q.bumpQuestions.run(id),
  getBotAccount: () => q.getBot.get(),
  saveBotAccount: (b) => q.saveBot.run(b),
  logQuestion: (bid, chatter, question, source, ok) => q.logQuestion.run(Date.now(), bid, chatter, question, source, ok ? 1 : 0),
  totalQuestions: () => q.totalQuestions.get().n,
  getSetting: (k) => q.getSetting.get(k)?.value ?? null,
  setSetting: (k, v) => q.setSetting.run(k, v),
};
