// commands.js — what happens when a chat message arrives in any joined channel
const cfg = require("./config");
const db = require("./db");
const twitch = require("./twitch");
const { answerQuestion } = require("./answerer");

const lastAsk = new Map(); // `${broadcaster}:${user}` -> ts
const lastChannel = new Map(); // broadcaster -> ts
let inFlight = 0;

function isModOrOwner(ev) {
  return ev.chatter_user_id === ev.broadcaster_user_id || (ev.badges || []).some((b) => b.set_id === "moderator" || b.set_id === "broadcaster");
}

function makeHandler(pool) {
  const botLogin = () => db.getBotAccount()?.login;
  const botId = () => db.getBotAccount()?.user_id;

  return async function onChat(ev) {
    if (ev.chatter_user_id === botId()) return; // ignore ourselves
    if (ev.source_broadcaster_user_id && ev.source_broadcaster_user_id !== ev.broadcaster_user_id) return; // shared-chat echoes
    const text = (ev.message?.text || "").trim();
    if (!text.startsWith("!")) return;
    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const arg = rest.join(" ").trim();
    const bid = ev.broadcaster_user_id;
    const reply = (m) => twitch.sendChat(bid, m, ev.message_id).catch((e) => console.error("[chat] send failed:", e.message));

    // ---- commands in the bot's OWN channel: !join / !leave (like PCG) ----
    if (bid === botId()) {
      if (cmd === "!join") {
        try {
          db.addChannel({ broadcaster_id: ev.chatter_user_id, login: ev.chatter_user_login, display_name: ev.chatter_user_name, joined_via: "chat" });
          await pool.join(ev.chatter_user_id);
          return reply(`@${ev.chatter_user_name} joined your channel! Viewers can now type ${cfg.COMMANDS[0]} <question>. Type !leave here to remove me.`);
        } catch (e) {
          if (e.message === "NEEDS_PERMISSION") {
            db.removeChannel(ev.chatter_user_id);
            return reply(`@${ev.chatter_user_name} I need permission for your channel first: either type /mod ${botLogin()} in your chat and !join again, or add me in one click at ${cfg.BASE_URL}`);
          }
          console.error("[join] failed:", e.message);
          return reply(`@${ev.chatter_user_name} couldn't join right now, try again in a minute.`);
        }
      }
      if (cmd === "!leave") {
        db.removeChannel(ev.chatter_user_id);
        await pool.leave(ev.chatter_user_id);
        return reply(`@${ev.chatter_user_name} left your channel. Come back any time with !join.`);
      }
    }

    // ---- channel admin: !ohwiki <leave|cooldown N|help> ----
    if (cmd === "!ohwiki") {
      const sub = arg.split(/\s+/)[0]?.toLowerCase();
      if (sub === "leave" && isModOrOwner(ev) && bid !== botId()) {
        db.removeChannel(bid);
        await pool.leave(bid);
        return reply(`Bye! ${cfg.BOT_NAME} has left this channel. Re-add it any time at ${cfg.BASE_URL}`);
      }
      if (sub === "cooldown" && isModOrOwner(ev)) {
        const n = Math.max(0, Math.min(600, parseInt(arg.split(/\s+/)[1], 10)));
        if (Number.isNaN(n)) return reply("Usage: !ohwiki cooldown <seconds>");
        db.setCooldown(bid, n);
        return reply(`Per-viewer cooldown set to ${n}s.`);
      }
      return reply(`${cfg.BOT_NAME}: ask anything about Once Human with ${cfg.COMMANDS[0]} <question> — answers come from ${cfg.WIKI_BASE}. Mods: !ohwiki cooldown <s>, !ohwiki leave.`);
    }

    // ---- the main event: !ask <question> ----
    if (!cfg.COMMANDS.includes(cmd)) return;
    const channel = db.getChannel(bid);
    if (!channel?.enabled && bid !== botId()) return;

    if (!arg) return reply(`Usage: ${cmd} <your question> — e.g. ${cmd} where does Butterfly's Emissary drop?`);

    const now = Date.now();
    const userCd = (channel?.user_cooldown ?? cfg.USER_COOLDOWN_SECONDS) * 1000;
    const key = `${bid}:${ev.chatter_user_id}`;
    if (!isModOrOwner(ev) && now - (lastAsk.get(key) || 0) < userCd) return;
    if (now - (lastChannel.get(bid) || 0) < cfg.CHANNEL_COOLDOWN_SECONDS * 1000) return;
    if (inFlight >= cfg.MAX_CONCURRENT_ANSWERS) return reply("I'm swamped right now, try again in a few seconds!");
    lastAsk.set(key, now);
    lastChannel.set(bid, now);

    inFlight++;
    console.log(`[#${ev.broadcaster_user_login}] ${ev.chatter_user_name}: ${arg}`);
    try {
      const { text: answer, source, url } = await answerQuestion(arg);
      await reply(`${answer}${url ? ` ${url}` : ""}`);
      db.bumpQuestions(bid);
      db.logQuestion(bid, ev.chatter_user_login, arg, source, true);
    } catch (e) {
      console.error("[ask] failed:", e.message);
      db.logQuestion(bid, ev.chatter_user_login, arg, null, false);
      await reply("Sorry, I hit an error looking that up — try again in a sec.");
    } finally {
      inFlight--;
    }
  };
}

// house-keeping so the maps don't grow forever
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, v] of lastAsk) if (v < cutoff) lastAsk.delete(k);
}, 10 * 60 * 1000).unref();

module.exports = { makeHandler };
