// fixed.js — hand-written answers for questions the wiki doesn't cover well.
// Checked before every other engine. Add an entry: { match: /regex/i, text: "...", source: "..." }.
// Keep each text under ~450 chars (Twitch caps a message at 500 incl. the @reply).

const FIXED = [
  {
    match: /\bvending(\s|-)?machines?\b|\bvendings?\b/i,
    text: "Vending Machines — Manibus / Endless Dream: Harvesters' Market at 2918, -995 (near Blackfell Outpost). Way of Winter: 2414, 6568 (north of Wishland).",
    source: "fixed:vending-machines",
  },
];

function answerFixed(question) {
  const q = String(question || "");
  for (const f of FIXED) if (f.match.test(q)) return { text: f.text, source: f.source, url: f.url || null };
  return null;
}

module.exports = { answerFixed, FIXED };
