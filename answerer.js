// answerer.js — picks the answer engine. Build/loadout questions go to the
// Community Builds decoder first; everything else to free or claude mode.
const cfg = require("./config");
const builds = require("./builds");
const facilities = require("./facilities");
const base = cfg.ANSWER_MODE === "claude" ? require("./answer") : require("./answer-free");

async function answerQuestion(question) {
  // "where can I find a gear bench" -> settlements that drop that facility (checked before builds: "gear" is a build word)
  if (facilities.isFacilityQuestion(question)) {
    try {
      const r = await facilities.answerFacility(question);
      if (r) return r;
    } catch (e) { console.error("[facilities] failed, falling back:", e.message); }
  }
  if (builds.isBuildQuestion(question)) {
    try {
      const r = await builds.answerBuild(question);
      if (r) return r;
    } catch (e) { console.error("[builds] failed, falling back:", e.message); }
  }
  return base.answerQuestion(question);
}

module.exports = { answerQuestion };
