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
  {
    // Hydrangea colours: "how do I get purple flowers", "how to grow black hydrangea", "what seed makes red"
    match: (q) => /\bhydrangeas?\b/i.test(q)
      || (/\b(flower|flowers|seed|seeds|bloom|blooms)\b/i.test(q) && /\b(blue|white|black|purple|yellow|red|pink)\b/i.test(q)),
    text: (q) => {
      const colour = (q.match(/\b(blue|white|black|purple|yellow|red|pink)\b/i) || [])[1]?.toLowerCase();
      const how = {
        blue: "Blue hydrangeas come from the Blue Hydrangea Seed with normal growth.",
        yellow: "Yellow hydrangeas come from the Yellow Hydrangea Seed with normal growth.",
        white: "White hydrangeas come from the Blue Hydrangea Seed when it has deviated growth (Blue seed deviated can give White, Black or Purple).",
        black: "Black hydrangeas come from the Blue Hydrangea Seed when it has deviated growth (Blue seed deviated can give White, Black or Purple).",
        red: "Red hydrangeas come from the Yellow Hydrangea Seed when it has deviated growth (Yellow seed deviated can give Red, Pink or Purple).",
        pink: "Pink hydrangeas come from the Yellow Hydrangea Seed when it has deviated growth (Yellow seed deviated can give Red, Pink or Purple).",
        purple: "Purple hydrangeas can come from either seed with deviated growth: Blue Hydrangea Seed (White/Black/Purple) or Yellow Hydrangea Seed (Red/Pink/Purple).",
      };
      return how[colour] || "Hydrangea colours — Blue seed: Blue (normal) or White/Black/Purple (deviated). Yellow seed: Yellow (normal) or Red/Pink/Purple (deviated).";
    },
    source: "fixed:hydrangea",
  },
];

function answerFixed(question) {
  const q = String(question || "");
  for (const f of FIXED) {
    const hit = typeof f.match === "function" ? f.match(q) : f.match.test(q);
    if (hit) return { text: typeof f.text === "function" ? f.text(q) : f.text, source: f.source, url: f.url || null };
  }
  return null;
}

module.exports = { answerFixed, FIXED };
