// outposts.js — "which outpost in Way of Winter sells the Versatile Screwdriver Set?" /
// "what does Camp Igloo sell?" / "where is Meyer's Market?"
// Reads the Outpost wiki page (merchant cards per scenario: Location, Securement Unit,
// Wild Deviation, and For Sale / Deviation / Formulas / Parts / Recipe lists with prices).
const wiki = require("./wiki");

const CACHE_MS = 10 * 60 * 1000;
let cache = { ts: 0, outposts: [] };

const SCEN = [
  { re: /\bendless\s*dreams?\b/i, keep: ["Manibus", "Way of Winter"], label: "Endless Dream" },
  { re: /\b(manibus|mani)\b/i, keep: ["Manibus"], label: "Manibus" },
  { re: /\b(way of winter|wow|winter)\b/i, keep: ["Way of Winter"], label: "Way of Winter" },
  { re: /\b(isles? of abyss|isles|abyss|ioa)\b/i, keep: ["Isles of Abyss"], label: "Isles of Abyss" },
];
const STOP = new Set("which what where who can i do you buy purchase get find sell sells selling sold from at in on the a an is are outpost outposts merchant merchants vendor vendors shop store trade trader for it to of and with my me any some map maps scenario".split(" "));

const strip = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function load() {
  if (Date.now() - cache.ts < CACHE_MS && cache.outposts.length) return cache.outposts;
  const raw = await (await fetch(`${wiki.WIKI_BASE}/index.php?title=Outpost&action=raw`)).text();

  // scenario headings -> which merchant ids sit under each
  const scenarioOf = {};
  const firstCard = raw.search(/<div id="mw-customcollapsible-/);
  const top = firstCard > 0 ? raw.slice(0, firstCard) : raw;
  const heads = [...top.matchAll(/<div style="[^"]*">(Manibus|Way of Winter|Isles of Abyss)<\/div>/g)];
  heads.forEach((h, i) => {
    const body = top.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : undefined);
    for (const m of body.matchAll(/mw-customtoggle-(merch[\w-]+)/g)) scenarioOf[m[1]] = h[1];
  });

  const outposts = [];
  const cardRx = /<div id="mw-customcollapsible-(merch[\w-]+)"[\s\S]*?Tap anywhere to close\./g;
  let c;
  while ((c = cardRx.exec(raw))) {
    const id = c[1];
    const divs = [...c[0].matchAll(/<div style="[^"]*">([\s\S]*?)<\/div>/g)].map((d) => strip(d[1])).filter((t) => t && !/^\[\[File:/.test(t) && !/^Tap anywhere/i.test(t));
    const o = { id, name: divs[0], scenario: scenarioOf[id] || "", location: "", fields: [], sections: [] };
    let cur = null;
    for (const t of divs.slice(1)) {
      if (/^[A-Za-z ]+:$/.test(t)) { cur = { label: t.slice(0, -1), items: [] }; o.sections.push(cur); continue; }
      const kv = t.match(/^([^:]{2,40}):\s*(.+)$/);
      if (cur && kv) { cur.items.push({ name: kv[1].trim(), price: kv[2].trim() }); continue; }
      if (kv) { o.fields.push({ label: kv[1].trim(), value: kv[2].trim() }); if (/^location$/i.test(kv[1])) o.location = kv[2].trim(); }
    }
    outposts.push(o);
  }
  cache = { ts: Date.now(), outposts };
  return outposts;
}

async function isOutpostQuestion(question) {
  if (/\b(outpost|outposts|merchant|merchants|vendor|vendors|purchase|buy|sell|sells|selling|sold|old currency|trader)\b/i.test(question)) return true;
  const outposts = await load();
  const qs = new Set(words(question));
  return outposts.some((o) => { const n = words(o.name); return n.length && n.every((w) => qs.has(w)); });
}

// "Bear's Den" / "bears den" / "bear den" all compare equal
const words = (s) => s.toLowerCase().replace(/'s\b/g, "").split(/[^a-z0-9&]+/).filter(Boolean).map((w) => (w.length > 3 ? w.replace(/(?<!s)s$/, "") : w));

async function answerOutpost(question) {
  const outposts = await load();
  if (!outposts.length) return null;
  const url = wiki.pageUrl("Outpost");
  const scen = SCEN.find((x) => x.re.test(question));
  let q = question.toLowerCase();
  for (const s of SCEN) q = q.replace(s.re, " ");
  const qw = words(q).filter((w) => !STOP.has(w));
  const qset = new Set(qw);

  // 1) question names an outpost -> what it sells / where it is
  const named = outposts.find((o) => { const n = words(o.name); return n.length && n.every((w) => qset.has(w)); });
  if (named) {
    const o = named;
    if (/\b(where|location|coords?|coordinates)\b/i.test(question)) {
      return { text: `${o.name} (${o.scenario}) — Location: ${o.location || "not listed"}${o.fields.filter((f) => !/^location$/i.test(f.label)).map((f) => ` · ${f.label}: ${f.value}`).join("")}`, source: "Outpost", url };
    }
    const wantSec = o.sections.find((s) => new RegExp(`\\b${s.label.toLowerCase().replace(/s$/, "")}s?\\b`, "i").test(question));
    const secs = wantSec ? [wantSec] : o.sections;
    let text = `${o.name} (${o.scenario}, ${o.location}) — ` + secs.map((s) => `${s.label}: ${s.items.map((i) => `${i.name} ${i.price}`).join(", ")}`).join(" | ");
    if (text.length > 440) text = text.slice(0, 439).replace(/\s+\S*$/, "") + "…";
    return { text, source: "Outpost", url };
  }

  // 2) question names an item -> which outposts sell it (all question words must be in the item name)
  const SECTION_WORDS = /^(recipe|recipes|formula|formulas|part|parts|deviation|deviations|sale|item|items)$/;
  const iq = qw.filter((w) => !SECTION_WORDS.test(w));
  if (!iq.length) return null;
  const hits = [];
  for (const o of outposts) for (const s of o.sections) for (const it of s.items) {
    const iw = words(it.name);
    if (iq.every((w) => iw.includes(w) || (w.length >= 4 && iw.some((x) => x.startsWith(w))))) hits.push({ o, s, it, extra: iw.length - iq.length });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.extra - b.extra);
  const best = hits[0].it.name.toLowerCase();
  let list = hits.filter((h) => h.it.name.toLowerCase() === best);
  let prefix = "";
  if (scen) {
    const inScen = list.filter((h) => scen.keep.includes(h.o.scenario));
    if (inScen.length) { list = inScen; }
    else prefix = `No ${scen.label} outpost sells that yet. Other scenarios — `;
  }
  const item = list[0].it.name;
  let text = `${prefix}${item} — ${list.map((h) => `${h.o.name}${scen && scen.keep.length === 1 ? "" : ` (${h.o.scenario})`} at ${h.o.location} for ${h.it.price}`).join("; ")}`;
  if (text.length > 440) text = text.slice(0, 439).replace(/\s+\S*$/, "") + "…";
  return { text, source: "Outpost", url };
}

module.exports = { answerOutpost, isOutpostQuestion, load };
