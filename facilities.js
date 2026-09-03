// facilities.js — "where can I find a gear bench?" -> which settlements drop that facility.
// Data comes live from the Settlements wiki page (settlement name, coordinates, zone,
// "Confirmed Facility Drops" list). Also answers "what drops in Evergreen?".
const wiki = require("./wiki");

const CACHE_MS = 10 * 60 * 1000;
let cache = { ts: 0, settlements: [] };

// words that carry no meaning when matching facility names
const STOP = new Set("where can i do you get find found a an the is are my in at from how to for what does drop drops dropped location locate obtain pick up spawn which settlement settlements facility facilities".split(" "));
// spelling variants seen on the wiki / in chat
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")
  .replace(/^workbench$|^bench$|^table$/, "workbench").replace(/^supply$|^supplies$/, "supply").replace(/^gears$/, "gear").replace(/^crates$/, "crate");

async function load() {
  if (Date.now() - cache.ts < CACHE_MS && cache.settlements.length) return cache.settlements;
  const text = await wiki.getPageText("Settlements");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // scenario for each settlement comes from the nav list at the top (Manibus / Way of Winter / Isles of Abyss)
  const scenarioOf = {};
  let scen = null;
  for (const l of lines) {
    if (/^(Manibus|Way of Winter|Isles of Abyss)$/i.test(l)) { scen = l; continue; }
    if (/^Location:/i.test(l)) break;
    if (scen && !/settlement|added yet|community|improve/i.test(l)) scenarioOf[l] = scen;
  }

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^Location:\s*-?\d/i.test(lines[i])) continue;
    const s = { name: lines[i - 1], location: lines[i].replace(/^Location:\s*/i, ""), zone: "", crate: "", drops: [] };
    s.scenario = scenarioOf[s.name] || "";
    let inDrops = false;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^Tap anywhere/i.test(l)) break;
      if (/^Zone:/i.test(l)) s.zone = l.replace(/^Zone:\s*/i, "");
      else if (/^Mystical Crate:/i.test(l)) s.crate = l.replace(/^Mystical Crate:\s*/i, "");
      else if (/^Confirmed Facility Drops:/i.test(l)) inDrops = true;
      else if (inDrops && !/:$/.test(l) && !/^-?\d+,\s*-?\d+$/.test(l)) {
        // "Advanced Gear Bench 689, 6603 / 781, 6556" -> name + exact coords
        const m = l.match(/^(.*?)\s+(-?\d+,\s*-?\d+(?:\s*\/\s*-?\d+,\s*-?\d+)*)$/);
        s.drops.push(m ? { name: m[1].trim(), coords: m[2].replace(/\s+/g, " ") } : { name: l, coords: "" });
      }
    }
    out.push(s);
  }
  cache = { ts: Date.now(), settlements: out };
  return out;
}

function contentWords(question) {
  return question.toLowerCase().replace(/'s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(norm);
}

// is the question about a facility or a settlement at all?
function isFacilityQuestion(question) {
  if (/\b(drops?|found|find|get|loot)\s+(in|at)\b/i.test(question)) return true; // "what drops in Evergreen"
  return /\b(bench|workbench|facility|facilities|settlement|settlements|crate|stove|fridge|furnace|generator|drill|filter|tank|rack|pod|platform|refinery|table)\b/i.test(question)
    && /\b(where|find|get|drop|drops|location|obtain|spawn|settlement|which|what)\b/i.test(question);
}

async function answerFacility(question) {
  const settlements = await load();
  if (!settlements.length) return null;
  const q = contentWords(question);
  if (!q.length) return null;
  const url = wiki.pageUrl("Settlements");

  // 1) question names a settlement -> list its drops
  const bySettlement = settlements.find((s) => { const n = s.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(norm); return n.length && n.every((w) => q.includes(w)); });
  if (bySettlement) {
    const s = bySettlement;
    const where = [s.zone, s.scenario].filter(Boolean).join(", ");
    const drops = s.drops.length ? `Facility drops: ${s.drops.map((d) => d.name).join(", ")}` : "No confirmed facility drops listed yet";
    return { text: `${s.name} (${where}; ${s.location})${s.crate ? ` — Mystical Crate: ${s.crate}` : ""} — ${drops}`, source: "Settlements", url };
  }

  // 2) question names a facility -> which settlements drop it
  const hits = new Map(); // facility name -> settlements
  for (const s of settlements) for (const d of s.drops) {
    const words = d.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(norm);
    const meaningful = q.filter((w) => w !== "advanced" && w !== "primary" && w !== "large" && w !== "small");
    if (!meaningful.length) continue;
    // every meaningful question word must be in the facility name; a qualifier in the question ("advanced") must be too
    if (!meaningful.every((w) => words.includes(w))) continue;
    if (q.some((w) => ["advanced", "primary", "large", "small"].includes(w) && !words.includes(w))) continue;
    const key = words.join(" "); // merges "Supply/Supplies", "Bench/Workbench" spellings
    if (!hits.has(key)) hits.set(key, { name: d.name, list: [] });
    hits.get(key).list.push({ s, coords: d.coords });
  }
  if (!hits.size) return null;

  // prefer the facility whose name has the fewest extra words (closest match), list up to 3 name variants
  const ranked = [...hits.values()].sort((a, b) => a.name.length - b.name.length).slice(0, 3);
  const parts = ranked.map(({ name, list }) => `${name}: ${list.map(({ s, coords }) => `${s.name} (${s.zone || s.scenario}, ${coords || s.location})`).join("; ")}`);
  let text = `Found at settlements — ${parts.join(" | ")}`;
  if (text.length > 440) text = text.slice(0, 439).replace(/\s+\S*$/, "") + "…";
  return { text, source: "Settlements", url };
}

module.exports = { answerFacility, isFacilityQuestion, load };
