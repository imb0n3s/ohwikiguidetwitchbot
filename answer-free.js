// answer-free.js — no AI, no per-question cost.
// Finds the best wiki page for the question, works out which part of the page
// the question is about ("where does X drop" -> the "Drops From" field), and
// replies with those lines plus the link.
const wiki = require("./wiki");

const MAX_ANSWER_CHARS = Number(process.env.MAX_ANSWER_CHARS || 380);

// question words -> page fields, in priority order
const INTENTS = [
  { re: /\b(drop|drops|farm|where|get|obtain|find|silo|securement unit|location|spawn)\b/i, fields: ["Drops From", "Location", "Obtained From", "Source", "How To Get"], only: true },
  { re: /\b(skill|attack|attacks|ability|abilities|ultimate|dps|damage)\b/i, fields: ["Attacks", "Deviation Battle Skill", "Deviation Ultimate", "Function"] },
  { re: /\b(mood|power|dormancy|environment|happy|happiness|environ)\b/i, fields: ["Securement Environment", "Notes"] },
  { re: /\b(variation|variations|trait|traits|glistening|starry|scroll)\b/i, fields: ["Variations", "Notes"] },
  { re: /\b(craft|crafts|crafting|recipe|ingredient|ingredients|cook|make|materials?|whim|potion)\b/i, fields: ["Ingredients", "Crafting Needs", "Crafts", "Whim", "Effects", "Function"] },
  { re: /\b(effect|effects|buff|perk|does)\b/i, fields: ["Effects", "Function", "Type"] },
  { re: /\b(type|kind|category)\b/i, fields: ["Type", "Function"] },
];
const DEFAULT_FIELDS = ["Summary", "Function", "Description", "Type", "Effects", "Ingredients", "Attacks", "Drops From"];

// Field names that start a new block. Other "Label: value" lines (e.g. "Manibus: Securement Units"
// under "Drops From:") stay inside the current block.
const TOP_LEVEL = new Set(["summary", "type", "function", "securement environment", "attacks", "drops from", "variations", "notes",
  "crafts", "whim", "crafting needs", "ingredients", "effects", "location", "how to get", "requirements", "description", "obtained from", "source"]);

// Split "Label: value" style page text into fields. Deviation/recipe pages all use this shape.
function parseFields(text) {
  const fields = [];
  let cur = null;
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("## ")) continue;
    const m = line.match(/^([A-Z][A-Za-z' ]{1,30}):\s*(.*)$/);
    if (m && TOP_LEVEL.has(m[1].trim().toLowerCase())) {
      cur = { name: m[1].trim(), lines: m[2] ? [m[2]] : [] };
      fields.push(cur);
      if (cur.name.toLowerCase() === "summary") cur = null; // summary is one line
      continue;
    }
    if (cur) cur.lines.push(line); else fields.push((cur = { name: "", lines: [line] }));
  }
  return fields;
}

function fieldText(f) {
  return f.lines.join("; ").replace(/\s+/g, " ").trim();
}

// Lines that merely list menu/dropdown items (builder pages) are useless as answers
function looksLikeMenu(f) {
  return f.lines.length > 6 && f.lines.every((l) => l.length < 40);
}

function summarize(title, text, question) {
  const fields = parseFields(text).filter((f) => !looksLikeMenu(f));
  const byName = (n) => fields.find((f) => f.name.toLowerCase() === n.toLowerCase() && fieldText(f).length > 2);

  const intent = INTENTS.find((i) => i.re.test(question));
  // `only` intents answer with just that field (e.g. "where do I find X" -> Drops From, nothing else)
  const wanted = intent ? (intent.only ? intent.fields : [...intent.fields, ...DEFAULT_FIELDS]) : DEFAULT_FIELDS;

  const parts = [];
  let len = title.length + 2;
  for (const name of wanted) {
    const f = byName(name);
    if (!f || parts.some((p) => p.f === f)) continue;
    const t = fieldText(f);
    if (!t) continue;
    parts.push({ f, s: `${f.name}: ${t}` });
    len += t.length + name.length + 4;
    if (len >= MAX_ANSWER_CHARS || intent?.only) break;
  }
  if (!parts.length && intent?.only) {
    // the page has no drop info: fall back to the usual summary rather than nothing
    return summarize(title, text, "");
  }
  if (!parts.length) {
    // no labelled fields (guide/build pages) — take the meaningful lines in order, skipping nav junk
    const lines = text.split("\n").map((l) => l.trim())
      .filter((l) => (l.length >= 12 || /^[•\-*]\s*\d/.test(l)) && !/^(##|▸|quick links|join the discord|return to|back to|front page|select )/i.test(l))
      .map((l) => l.replace(/^[•\-*]\s*/, ""));
    // recipe-style sections: "effect; 1 X; 2 Y" -> "effect | Ingredients: 1 X, 2 Y"
    const ing = lines.filter((l) => /^\d+\s/.test(l));
    if (ing.length && ing.length < lines.length) return `${lines.filter((l) => !/^\d+\s/.test(l)).join("; ")} | Ingredients: ${ing.join(", ")}`;
    return lines.join("; ").replace(/\s+/g, " ");
  }
  return parts.map((p) => p.s).join(" | ");
}

// "Variations:" lines look like "Lunar Oracle: Weapon DMG +5%. x1.5 when Sanity is below 30%"
function findVariation(text, qWords) {
  const f = parseFields(text).find((x) => x.name.toLowerCase() === "variations");
  if (!f) return null;
  for (const line of f.lines) {
    const m = line.match(/^([^:]{3,60}?)\s*:\s*(.+)$/);
    if (!m) continue;
    const words = m[1].toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    if (words.some((w) => qWords.has(w))) return { name: m[1].trim(), desc: m[2].trim() };
  }
  return null;
}

async function answerQuestion(question) {
  const candidates = await wiki.findRelevantPages(question, 3);
  if (!candidates.length) return { text: `I couldn't find that on the wiki. Try browsing ${wiki.WIKI_BASE}`, source: null, url: null };

  const q = wiki.expandNicknames(question);
  const qWords = new Set(q.replace(/'s\b/g, "").split(/[^a-z0-9]+/).filter(Boolean));
  // Prefer a page whose title is in the question, or a big page with a matching "## Section"
  // (exact, or sharing a distinctive word like "lonewolf"), over a page that merely mentions the words.
  const sectionScore = (header) => {
    const h = header.toLowerCase();
    if (h.length > 2 && wiki.includesName(q, h)) return 3;
    const words = wiki.nameWords(h);
    const hit = words.filter((w) => qWords.has(w));
    if (words.length && hit.length === words.length) return 2;
    if (hit.some((w) => w.length >= 6)) return 1 + hit.length / words.length;
    return 0;
  };
  let title = candidates[0], section = null, best = 0;
  for (const t of candidates) {
    if (wiki.includesName(q, t.toLowerCase())) { title = t; section = null; best = 4; break; }
    const text = await wiki.getPageText(t);
    for (const sec of text.split(/\n(?=## )/).slice(1)) {
      const sc = sectionScore(sec.split("\n")[0].replace(/^## /, ""));
      if (sc > best) { best = sc; title = t; section = sec; }
    }
    if (best >= 3) break;
  }

  const full = await wiki.getPageText(title);
  const body = section || wiki.trimForQuestion(full, question);
  const label = section ? section.split("\n")[0].replace(/^## /, "") : title;

  // Variation asked by name ("lunar lonewolf", "glistening blue butterfly") -> answer with just that variation
  const variation = findVariation(body, qWords);
  if (variation) return { text: `${label} — ${variation.name} variation: ${variation.desc}`, source: title, url: wiki.pageUrl(title) };

  let out = `${label} — ${summarize(label, body, question)}`.replace(/\s+/g, " ").trim();
  if (out.length > MAX_ANSWER_CHARS) out = out.slice(0, MAX_ANSWER_CHARS - 1).replace(/\s+\S*$/, "") + "…";
  return { text: out, source: title, url: wiki.pageUrl(title) };
}

module.exports = { answerQuestion };
