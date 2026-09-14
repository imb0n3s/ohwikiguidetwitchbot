// answerer.js — picks the answer engine. Build/loadout questions go to the
// Community Builds decoder first; everything else to free or claude mode.
const cfg = require("./config");
const builds = require("./builds");
const facilities = require("./facilities");
const silos = require("./silos");
const outposts = require("./outposts");
const gardener = require("./gardener");
const base = cfg.ANSWER_MODE === "claude" ? require("./answer") : require("./answer-free");

async function answerQuestion(question) {
  // "how long does rubber take to farm" -> Gardener Glass grow times
  try {
    if (gardener.isGardenerQuestion(question)) {
      const r = await gardener.answerGardener(question);
      if (r) return r;
    }
  } catch (e) { console.error("[gardener] failed, falling back:", e.message); }
  // "which outpost sells X" / "what does Camp Igloo sell" -> Outpost merchant cards
  try {
    if (await outposts.isOutpostQuestion(question)) {
      const r = await outposts.answerOutpost(question);
      if (r) return r;
    }
  } catch (e) { console.error("[outposts] failed, falling back:", e.message); }
  // "what's the boss in EX1" -> Securement Silo cards (per scenario)
  try {
    if (await silos.isSiloQuestion(question)) {
      const r = await silos.answerSilo(question);
      if (r) return r;
    }
  } catch (e) { console.error("[silos] failed, falling back:", e.message); }
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
