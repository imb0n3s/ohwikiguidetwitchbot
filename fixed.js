// fixed.js — hand-written answers for questions the wiki doesn't cover well.
// Checked before every other engine. Add an entry: { match: /regex/i or (q) => boolean, text: "...", source: "..." }.
// Keep each text under ~450 chars (Twitch caps a message at 500 incl. the @reply).

const FIXED = [
  {
    match: /\bvending(\s|-)?machines?\b|\bvendings?\b/i,
    text: "Vending Machines — Manibus / Endless Dream: Harvesters' Market at 2918, -995 (near Blackfell Outpost). Way of Winter: 2414, 6568 (north of Wishland).",
    source: "fixed:vending-machines",
  },
  {
    // "where is the nightmare", "where is manibus the nightmare", "nightmare location" — but not silo/monolith
    // difficulty questions like "theta nightmare rewards" or "nightmare boss in ex1"
    match: (q) => /\bnightmare\b/i.test(q)
      && /\b(where|location|located|find|spawn|spawns|at|is)\b/i.test(q)
      && !/\b(silo|silos|monolith|reward|rewards|loot|boss|level|lvl|phi|sigma|theta|alpha|lea|ex-?1|taurus|delta|psi|normal|hard|pro|difficulty)\b/i.test(q),
    text: "The Nightmare only appears in the Endless Dream scenario, once Phase 6 starts. It has no fixed location — it's always moving — so your best bet is to check your in-game Map for its current position.",
    source: "fixed:nightmare",
  },
];

function answerFixed(question) {
  const q = String(question || "");
  for (const f of FIXED) {
    const hit = typeof f.match === "function" ? f.match(q) : f.match.test(q);
    if (hit) return { text: f.text, source: f.source, url: f.url || null };
  }
  return null;
}

module.exports = { answerFixed, FIXED };
