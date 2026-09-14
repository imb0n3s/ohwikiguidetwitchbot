// gardener.js — "how long does rubber take to farm/grow?" / "how much fiber does gardener glass give?"
// Reads the Gardener Glass wiki table: Item | Grow Time | Harvest Amount.
const wiki = require("./wiki");

const CACHE_MS = 10 * 60 * 1000;
let cache = { ts: 0, rows: [] };

const strip = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => s.toLowerCase().replace(/'s\b/g, "").split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 ? w.replace(/(?<!s)s$/, "") : w));
const STOP = new Set("how long does do doe take takes to farm grow growing in the a an is are it my gardener glass gardening much many get you i from harvest yield and of what per".split(" "));

async function load() {
  if (Date.now() - cache.ts < CACHE_MS && cache.rows.length) return cache.rows;
  const raw = await (await fetch(`${wiki.WIKI_BASE}/index.php?title=Gardener_Glass&action=raw`)).text();
  const rows = [];
  for (const block of raw.split(/\n\|-\s*\n/)) {
    const cells = block.split("\n").filter((l) => l.startsWith("| ")).map((l) => strip(l.replace(/^\|\s*/, "").replace(/^[^|]*\|\s*(?=[^|]*$)/, "")));
    if (cells.length >= 3 && !/^!/.test(block)) rows.push({ item: cells[0], time: cells[1], amount: cells[2] });
  }
  cache = { ts: Date.now(), rows };
  return rows;
}

function isGardenerQuestion(question) {
  return /\b(gardener|gardener glass|grow|grows|growing|farm time|how long .* (farm|grow)|harvest)\b/i.test(question)
    || /\bhow long\b.*\b(take|takes)\b/i.test(question);
}

async function answerGardener(question) {
  const rows = await load();
  if (!rows.length) return null;
  const url = wiki.pageUrl("Gardener Glass");
  const qw = words(question).filter((w) => !STOP.has(w));
  if (!qw.length) return null;
  let hit = null;
  for (const r of rows) {
    const iw = words(r.item);
    if (qw.every((w) => iw.includes(w) || (w.length >= 4 && iw.some((x) => x.startsWith(w))))) { if (!hit || iw.length < words(hit.item).length) hit = r; }
  }
  if (!hit) return null;
  const wantsAmount = /\b(how much|how many|amount|yield|harvest)\b/i.test(question) && !/\bhow long\b/i.test(question);
  const text = wantsAmount
    ? `${hit.item} — Gardener Glass harvest: ${hit.amount} (grow time ${hit.time})`
    : `${hit.item} — Gardener Glass grow time: ${hit.time} (harvest ${hit.amount})`;
  return { text, source: "Gardener Glass", url };
}

module.exports = { answerGardener, isGardenerQuestion, load };
