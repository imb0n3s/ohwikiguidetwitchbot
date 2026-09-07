// silos.js — "what's the boss in EX1?" / "what drops in Sigma?" / "rewards for Theta nightmare?"
// Reads the Securement Silo page's pop-up cards straight from the wikitext, so each silo
// keeps its scenario (Manibus / Way of Winter / Isles of Abyss). A silo name that exists in
// more than one scenario (e.g. EX1) is answered once per scenario unless the question names one.
const wiki = require("./wiki");

const CACHE_MS = 10 * 60 * 1000;
let cache = { ts: 0, silos: [] };

const SCENARIOS = [
  { re: /\b(manibus|mani)\b/i, name: "Manibus", idHint: /^(manibus|man)/ },
  { re: /\b(way of winter|wow|winter)\b/i, name: "Way of Winter", idHint: /^wow/ },
  { re: /\b(isles? of abyss|isles|abyss|ioa)\b/i, name: "Isles of Abyss", idHint: /^(ioa|isles|abyss)/ },
];
const DIFFICULTIES = ["Normal", "Hard", "Pro", "Nightmare"];

async function load() {
  if (Date.now() - cache.ts < CACHE_MS && cache.silos.length) return cache.silos;
  const raw = await (await fetch(`${wiki.WIKI_BASE}/index.php?title=Securement_Silo&action=raw`)).text();

  // nav tiles at the top tell us which scenario each silo belongs to
  const navScenarios = {}; // lower name -> [scenario]
  const navText = wiki.htmlToText(raw.split(/mw-customcollapsible-silo/)[0].replace(/\[\[File:[^\]]*\]\]/g, ""));
  let scen = null;
  for (const l of navText.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const s = SCENARIOS.find((x) => x.name.toLowerCase() === l.toLowerCase());
    if (s) { scen = s.name; continue; }
    if (scen && l.length < 20) (navScenarios[l.toLowerCase()] ||= []).push(scen);
  }

  const silos = [];
  const parts = raw.split(/<div id="mw-customcollapsible-silo([a-z0-9]+)"/);
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i];
    const lines = wiki.htmlToText(parts[i + 1].replace(/\[\[File:[^\]]*\]\]/g, "")).split("\n").map((s) => s.trim())
      .filter((l) => l && !/^class=|^style=|Tap anywhere|^Video Guide$/i.test(l));
    const name = lines[0];
    const silo = { id, name, scenario: "", location: "", zone: "", boss: "", fields: [], tiers: {} };
    const hinted = SCENARIOS.find((s) => s.idHint.test(id));
    silo.scenario = hinted ? hinted.name : (navScenarios[name.toLowerCase()] || []).join(" / ");
    let tier = null;
    for (const l of lines.slice(1)) {
      if (DIFFICULTIES.includes(l)) { tier = { level: "", rewards: [], weekly: [] }; silo.tiers[l] = tier; tier.section = "rewards"; continue; }
      if (tier) {
        if (/^Recommended Level:/i.test(l)) tier.level = l.replace(/^Recommended Level:\s*/i, "");
        else if (/^Challenge Rewards/i.test(l)) tier.section = "rewards";
        else if (/^Weekly Bonus Rewards/i.test(l)) tier.section = "weekly";
        else tier[tier.section].push(l);
        continue;
      }
      if (/^Location:/i.test(l)) silo.location = l.replace(/^Location:\s*/i, "");
      else if (/^Zone:/i.test(l)) silo.zone = l.replace(/^Zone:\s*/i, "");
      else if (/^Boss:/i.test(l)) silo.boss = l.replace(/^Boss:\s*/i, "");
      else silo.fields.push(l); // Deviation, Seepage Zone, Elite before..., 1st Room...
    }
    silos.push(silo);
  }
  cache = { ts: Date.now(), silos };
  return silos;
}

function siloNamePattern(name) {
  const n = name.toLowerCase();
  const m = n.match(/^([a-z]+)(\d+)$/); // ex1 -> ex1 | ex-1 | ex 1
  return new RegExp(`\\b${m ? `${m[1]}[ -]?${m[2]}` : n.replace(/[^a-z0-9]/g, "")}\\b`, "i");
}

async function isSiloQuestion(question) {
  if (/\bsilos?\b/i.test(question)) return true;
  const silos = await load();
  return silos.some((s) => siloNamePattern(s.name).test(question));
}

function describe(s, question) {
  const head = `${s.name} silo (${s.scenario || "?"})`;
  const q = question;
  const wantedTier = DIFFICULTIES.find((d) => new RegExp(`\\b${d}\\b`, "i").test(q));
  const tierLine = (d) => { const t = s.tiers[d]; return t ? `${d} (Lv ${t.level || "?"}): ${t.rewards.join(", ")}${t.weekly.length ? ` · Weekly: ${t.weekly.join(", ")}` : ""}` : ""; };

  if (/\b(boss|bosses|fight|who)\b/i.test(q)) {
    const extra = s.fields.filter((f) => /^(elite|seepage|\d\w* room|main boss)/i.test(f));
    return `${head} — Boss: ${s.boss || "not listed"}${extra.length ? ` · ${extra.join(" · ")}` : ""}`;
  }
  if (/\b(level|lvl|recommended)\b/i.test(q)) {
    return `${head} — Recommended levels: ${DIFFICULTIES.filter((d) => s.tiers[d]).map((d) => `${d} ${s.tiers[d].level}`).join(", ")}`;
  }
  if (/\b(reward|rewards|loot|mod|mods|weekly|bonus)\b/i.test(q) || wantedTier) {
    const tiers = wantedTier ? [wantedTier] : DIFFICULTIES;
    return `${head} — ${tiers.map(tierLine).filter(Boolean).join(" | ")}`;
  }
  if (/\b(deviation|deviations|drop|drops|farm)\b/i.test(q)) {
    const dev = s.fields.filter((f) => /deviation|room|seepage|elite/i.test(f));
    return `${head} — ${dev.length ? dev.join(" · ") : "no deviation drops listed"}`;
  }
  if (/\b(where|location|coords?|coordinates|find)\b/i.test(q)) {
    return `${head} — Location: ${[s.zone, s.location].filter(Boolean).join(" ")}`;
  }
  return `${head} — Location: ${[s.zone, s.location].filter(Boolean).join(" ")} · Boss: ${s.boss || "?"}${s.fields[0] ? ` · ${s.fields[0]}` : ""}`;
}

async function answerSilo(question) {
  const silos = await load();
  let matches = silos.filter((s) => siloNamePattern(s.name).test(question));
  if (!matches.length) return null;
  const scen = SCENARIOS.find((x) => x.re.test(question));
  let note = "";
  if (/\bendless\s*dreams?\b/i.test(question)) {
    // Endless Dream = Manibus + Way of Winter maps combined -> answer both, no filtering
    matches = matches.filter((s) => /Manibus|Way of Winter/.test(s.scenario));
    if (!matches.length) return null;
    note = "(Endless Dream = Manibus + Way of Winter) ";
  } else if (scen) {
    if (matches.some((s) => s.scenario.includes(scen.name))) matches = matches.filter((s) => s.scenario.includes(scen.name));
    else note = `(No ${scen.name} card for ${matches[0].name} on the wiki yet — showing ${matches.map((s) => s.scenario).join("/")}) `;
  }
  let text = note + matches.map((s) => describe(s, question)).join(" | ");
  if (text.length > 440) text = text.slice(0, 439).replace(/\s+\S*$/, "") + "…";
  return { text, source: "Securement Silo", url: wiki.pageUrl("Securement Silo") };
}

module.exports = { answerSilo, isSiloQuestion, load };
