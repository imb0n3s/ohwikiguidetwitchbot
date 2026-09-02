// answerer.js — picks the answer engine. Build/loadout questions go to the
// Community Builds decoder first; everything else to free or claude mode.
const cfg = require("./config");
const builds = require("./builds");
const base = cfg.ANSWER_MODE === "claude" ? require("./answer") : require("./answer-free");

async function answerQuestion(question) {
  if (builds.isBuildQuestion(question)) {
    try {
      const r = await builds.answerBuild(question);
      if (r) return r;
    } catch (e) { console.error("[builds] failed, falling back:", e.message); }
  }
  return base.answerQuestion(question);
}

module.exports = { answerQuestion };
