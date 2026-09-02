// builds.js — answers "I need a compound bow build" style questions with an actual
// loadout breakdown pulled live from the Community Builds builder on the wiki.
//
// The builder stores each shared build as a dot-separated "code" of item slugs.
// We decode it with a slug -> name dictionary that is exported from the builder
// page itself (POST /admin/builder-dict) so new items keep working.
const cfg = require("./config");
const db = require("./db");

const CACHE_MS = 10 * 60 * 1000;
let buildsCache = { rows: [], ts: 0 };
let supa = null; // { url, key } parsed from the Community Builds page
let dictCache = null;

// Field order of the builder's share code (must match shareIds() in the page)
const ARMOR = ["helmet", "top", "pants", "gloves", "shoes", "mask"];
const ARMOR_LABEL = { helmet: "Helmet", top: "Top", pants: "Pants", gloves: "Gloves", shoes: "Shoes", mask: "Mask" };
const FIELDS = [
  "dev_item", "dev_slot1", "dev_slot2", "dev_slot3",
  "w_type", "w_item", "w_calibration", "w_substat", "w_att1", "w_att2", "w_att3", "w_att4", "m_type", "m_suffix", "m_effect",
  "w2_type", "w2_item", "w2_calibration", "w2_substat", "w2_att1", "w2_att2", "w2_att3", "w2_att4", "m2_type", "m2_suffix", "m2_effect",
  ...ARMOR.flatMap((k) => [`ar_${k}_item`, `ar_${k}_hide`, `ar_${k}_mod`, `ar_${k}_suffix`]),
  "food_dish", "food_drink", "food_dish2", "food_drink2",
];

const WEAPON_TYPES = { pistol: "Pistol", sniper: "Sniper", assault_rifle: "Assault Rifle", shotgun: "Shotgun", smg: "SMG", lmg: "LMG", crossbow: "Bow/Crossbow" };

function getDict() {
  if (dictCache) return dictCache;
  try { dictCache = JSON.parse(db.getSetting("builder_dict") || "null"); } catch { dictCache = null; }
  return dictCache;
}
function setDict(d) { dictCache = d; db.setSetting("builder_dict", JSON.stringify(d)); }

const pretty = (slug) => String(slug || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function name(slug) {
  if (!slug) return "";
  const d = getDict();
  return (d && d.names && d.names[slug]) || WEAPON_TYPES[slug] || pretty(slug);
}

async function getSupa() {
  if (supa) return supa;
  const r = await fetch(`${cfg.WIKI_BASE}/index.php?title=Community_Builds&action=raw`);
  const t = await r.text();
  const url = t.match(/SUPA_URL\s*=\s*["']([^"']+)/)?.[1];
  const key = t.match(/SUPA_KEY\s*=\s*["']([^"']+)/)?.[1];
  if (!url || !key) throw new Error("builder backend not found on Community Builds page");
  supa = { url, key };
  return supa;
}

async function getBuilds() {
  if (Date.now() - buildsCache.ts < CACHE_MS && buildsCache.rows.length) return buildsCache.rows;
  const { url, key } = await getSupa();
  const r = await fetch(`${url}/rest/v1/builds?select=id,user_id,name,summary,code,created_at&approved=eq.true&order=created_at.desc&limit=200`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`builds fetch ${r.status}`);
  const rows = (await r.json()).map((b) => ({ ...b, decoded: decode(b.code) }));
  buildsCache = { rows, ts: Date.now() };
  return rows;
}

function decode(code) {
  const vals = String(code || "").replace(/^c=/, "").replace(/^~/, "").split(".");
  const f = {};
  FIELDS.forEach((k, i) => (f[k] = vals[i] || ""));
  const weapon = (p) => f[`${p}_item`] ? {
    name: name(f[`${p}_item`]), type: name(f[`${p}_type`]), calibration: name(f[`${p}_calibration`]), substat: name(f[`${p}_substat`]),
    attachments: [1, 2, 3, 4].map((n) => name(f[`${p}_att${n}`])).filter(Boolean),
    mod: f[`m${p === "w2" ? "2" : ""}_suffix`] ? `${name(f[`m${p === "w2" ? "2" : ""}_suffix`])}${f[`m${p === "w2" ? "2" : ""}_effect`] ? ` (${name(f[`m${p === "w2" ? "2" : ""}_effect`])})` : ""}` : "",
    modType: name(f[`m${p === "w2" ? "2" : ""}_type`]),
  } : null;
  const armor = ARMOR.map((k) => f[`ar_${k}_item`] ? { slot: ARMOR_LABEL[k], item: name(f[`ar_${k}_item`]), hide: name(f[`ar_${k}_hide`]), mod: [name(f[`ar_${k}_mod`]), name(f[`ar_${k}_suffix`])].filter(Boolean).join("/") } : null).filter(Boolean);
  const d = getDict();
  const sets = {};
  for (const k of ARMOR) { const set = d?.sets?.[f[`ar_${k}_item`]]; if (set) sets[set] = (sets[set] || 0) + 1; }
  return {
    deviation: name(f.dev_item),
    traits: [f.dev_slot1, f.dev_slot2, f.dev_slot3].map(name).filter(Boolean),
    primary: weapon("w"), secondary: weapon("w2"), armor,
    sets: Object.entries(sets).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}pc`),
    food: [f.food_dish, f.food_drink, f.food_dish2, f.food_drink2].map(name).filter(Boolean),
  };
}

// ---------- matching ----------
const STOP = new Set("i need a an the build builds loadout load out setup gear for best good with what is are any some give me show your my please pls can you have got".split(" "));
const ALIASES = { bow: "compound bow", turbow: "compound bow", crossbow: "crossbow", p90: "pdw90", pdw: "pdw90", kvd: "kvd", aws: "aws.338", sniper: "sniper", smg: "smg", tec9: "tec9", tec: "tec9", sks: "sks", kam: "kam", abyss: "abyss glance", de50: "de.50", deagle: "de.50", ebr: "ebr-14", sn700: "sn700", mps7: "mps7", mps5: "mps5", aug: "aug", "1%": "1%", hp: "1%" };

function buildText(b) {
  const d = b.decoded;
  return [b.name, b.summary, d.deviation, d.primary?.name, d.primary?.type, d.secondary?.name, d.secondary?.type, ...d.sets, ...d.traits].filter(Boolean).join(" ").toLowerCase();
}

function findBuilds(question, rows) {
  const q = question.toLowerCase().replace(/[^\w.%' -]+/g, " ");
  const words = q.split(/\s+/).filter((w) => w && !STOP.has(w));
  const terms = new Set(words.map((w) => ALIASES[w] || w));
  if (!terms.size) return [];
  return rows.map((b) => {
    const text = buildText(b);
    let score = 0;
    for (const t of terms) if (text.includes(t)) score += t.length > 3 ? 2 : 1;
    return { b, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.b.id - a.b.id).map((x) => x.b);
}

// ---------- formatting (Twitch: 500 chars per message) ----------
function format(b, others) {
  const d = b.decoded;
  const link = `${cfg.WIKI_BASE}/Community_Builds#id=${b.id}`;
  const w = (x, label) => x ? `${label}: ${x.name}${x.calibration ? ` · ${x.calibration}` : ""}${x.substat ? ` (${x.substat})` : ""}${x.mod ? ` · Mod: ${x.mod}` : ""}${x.attachments.length ? ` · ${x.attachments.join(", ")}` : ""}` : "";
  const m1 = [
    `${b.name || "Community"}'s ${d.primary?.name || "build"} build`,
    d.deviation ? `Deviation: ${d.deviation}${d.traits.length ? ` (${d.traits.join(" / ")})` : ""}` : "",
    w(d.primary, "Primary"),
    w(d.secondary, "Secondary"),
  ].filter(Boolean).join(" | ");
  const m2 = [
    d.armor.length ? `Armor: ${d.armor.map((a) => `${a.slot} ${a.item}${a.hide ? ` [${a.hide}]` : ""}${a.mod ? ` ${a.mod}` : ""}`).join("; ")}` : "",
    d.sets.length ? `Sets: ${d.sets.join(", ")}` : "",
    d.food.length ? `Food: ${d.food.join(", ")}` : "",
  ].filter(Boolean).join(" | ");
  const m3 = `Full card: ${link}${others.length ? ` · ${others.length} more ${d.primary?.type || ""} build${others.length > 1 ? "s" : ""}: ${others.slice(0, 3).map((o) => `${o.name} (#${o.id})`).join(", ")} at ${cfg.WIKI_BASE}/Community_Builds`.replace("  ", " ") : ""}`;
  const clip = (s) => (s.length > 490 ? s.slice(0, 489).replace(/\s+\S*$/, "") + "…" : s);
  return [clip(m1), clip(m2), clip(m3)].filter((s) => s.trim());
}

function isBuildQuestion(question) {
  return /\b(build|builds|loadout|load ?out|setup|set ?up|gear)\b/i.test(question);
}

async function answerBuild(question) {
  const rows = await getBuilds();
  const matches = findBuilds(question, rows);
  if (!matches.length) return null;
  const best = matches[0];
  const others = matches.slice(1).filter((m) => m.decoded.primary?.type === best.decoded.primary?.type);
  return { messages: format(best, others), source: `Community Builds #${best.id}`, url: null };
}

module.exports = { answerBuild, isBuildQuestion, decode, getBuilds, setDict, getDict, FIELDS };
