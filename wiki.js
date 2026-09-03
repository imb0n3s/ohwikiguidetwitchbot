// wiki.js — talks to the ohwikiguide.com MediaWiki API
// Search for pages, pull their text (including data hidden inside the
// interactive pages' <script> blocks), and cache results.

const WIKI_BASE = process.env.WIKI_BASE || "https://ohwikiguide.com";
const API = `${WIKI_BASE}/api.php`;
const UA = "OHWikiTwitchBot/1.0 (+https://ohwikiguide.com)";

const PAGE_TTL_MS = 10 * 60 * 1000; // re-fetch page text every 10 min
const TITLES_TTL_MS = 30 * 60 * 1000; // re-fetch page list every 30 min
const MAX_PAGE_CHARS = 14000; // cap per page fed to Claude

// Pages that are never useful as answers
const IGNORE_TITLES = new Set([
  "Main Page", "Quick Links", "Test Page", "Gear Hides Test", "Thank You",
  "Privacy Policy", "OH Wiki Bot Terms of Service",
]);

const pageCache = new Map(); // title -> { text, ts }
let titleCache = { titles: [], ts: 0 };

async function apiGet(params) {
  const url = new URL(API);
  url.search = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Wiki API ${res.status} for ${url}`);
  return res.json();
}

// ---------- text cleaning ----------

function htmlToText(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// The builder pages (Deviation Main Page, Loadout pages, etc.) keep their real
// content inside JS objects like  { title: "Butterfly Emissary", lines: ["<b>Function:</b> ..."] }.
// Pull every string literal out of <script> blocks so that data is searchable.
function scriptStringsToText(wikitext) {
  const out = [];
  const scripts = wikitext.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of scripts) {
    // title: "..."  -> section header
    // "..." string literals -> lines
    const re = /(?:title\s*:\s*)?(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;
    let m;
    while ((m = re.exec(block))) {
      // a header is either `title: "X"` or an object key like `"Crumbly Bread": {`
      const isTitle = m[0].startsWith("title") || /^\s*:\s*\{/.test(block.slice(m.index + m[0].length));
      let s = m[2].replace(/\\(["'\\/])/g, "$1");
      if (/^https?:\/\//.test(s) || /^[#.][\w-]+$/.test(s)) continue; // urls, css selectors
      s = htmlToText(s);
      if (!s || s.length < 3) continue;
      out.push(isTitle ? `\n## ${s}` : s);
    }
  }
  return out.join("\n");
}

// ---------- public API ----------

async function getAllTitles() {
  if (Date.now() - titleCache.ts < TITLES_TTL_MS && titleCache.titles.length) return titleCache.titles;
  const titles = [];
  let apcontinue;
  do {
    const data = await apiGet({ action: "query", list: "allpages", aplimit: "500", apnamespace: "0", ...(apcontinue ? { apcontinue } : {}) });
    for (const p of data.query.allpages) if (!IGNORE_TITLES.has(p.title)) titles.push(p.title);
    apcontinue = data.continue?.apcontinue;
  } while (apcontinue);
  titleCache = { titles, ts: Date.now() };
  return titles;
}

// Big data pages (Deviation Main Page, builders) hold dozens of "## Section" entries that
// the wiki's own search can't see. Index those section names so questions like
// "where do I find the soul summoner" resolve to the right page + section.
let sectionIndex = { entries: [], ts: 0 }; // [{ page, section }]
async function getSectionIndex() {
  if (Date.now() - sectionIndex.ts < TITLES_TTL_MS && sectionIndex.entries.length) return sectionIndex.entries;
  const entries = [];
  try {
    let gapcontinue;
    const big = [];
    do {
      const data = await apiGet({ action: "query", generator: "allpages", gaplimit: "500", gapnamespace: "0", prop: "info", ...(gapcontinue ? { gapcontinue } : {}) });
      for (const p of Object.values(data.query?.pages || {})) if (p.length > 15000 && !IGNORE_TITLES.has(p.title)) big.push(p.title);
      gapcontinue = data.continue?.gapcontinue;
    } while (gapcontinue);
    for (const title of big) {
      const text = await getPageText(title);
      for (const m of text.matchAll(/^## (.+)$/gm)) {
        const section = m[1].trim();
        if (section.length > 2) entries.push({ page: title, section });
      }
    }
    sectionIndex = { entries, ts: Date.now() };
    console.log(`[wiki] indexed ${entries.length} sections across ${big.length} large pages`);
  } catch (e) { console.error("[wiki] section index failed:", e.message); }
  return sectionIndex.entries;
}

async function searchTitles(query, limit = 5) {
  const data = await apiGet({ action: "query", list: "search", srsearch: query, srlimit: String(limit), srwhat: "text" });
  return data.query.search.map((r) => r.title).filter((t) => !IGNORE_TITLES.has(t));
}

async function getPageText(title) {
  const cached = pageCache.get(title);
  if (cached && Date.now() - cached.ts < PAGE_TTL_MS) return cached.text;

  const [parsed, raw] = await Promise.all([
    apiGet({ action: "parse", page: title, prop: "text", disabletoc: "1", disableeditsection: "1" }),
    apiGet({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: title }),
  ]);
  const html = parsed.parse?.text || "";
  const wikitext = raw.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content || "";

  let text = htmlToText(html);
  if (/<script/i.test(wikitext)) text += "\n" + scriptStringsToText(wikitext);
  const desc = wikitext.match(/\|\s*description\s*=\s*([^\n|}]+)/);
  if (desc) text = `Summary: ${desc[1].trim()}\n` + text;
  text = text.replace(/\n{2,}/g, "\n");

  pageCache.set(title, { text, ts: Date.now() });
  return text;
}

// Big data pages (e.g. Deviation Main Page has every deviation) don't fit in one
// prompt. Keep the intro plus the "## Section" blocks that match the question.
function trimForQuestion(text, question) {
  if (text.length <= MAX_PAGE_CHARS) return text;
  const q = question.toLowerCase();
  const parts = text.split(/\n(?=## )/);
  const intro = parts[0].slice(0, 2000);
  const hits = parts.slice(1).filter((sec) => {
    const header = sec.split("\n")[0].replace(/^## /, "").toLowerCase();
    const words = header.split(/[^a-z0-9']+/).filter((w) => w.length > 2);
    return words.length && words.some((w) => q.includes(w));
  });
  let out = [intro, ...hits].join("\n");
  if (hits.length === 0) out = text; // nothing matched: fall back to the start of the page
  return out.slice(0, MAX_PAGE_CHARS);
}

function pageUrl(title) {
  return `${WIKI_BASE}/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

// Chat nicknames -> what the wiki calls it. Matched as whole phrases, longest first.
// Add to this list whenever viewers use a name the wiki doesn't.
const NICKNAMES = {
  "lunar wolf": "lonewolf whisper lunar oracle",
  "lunar lonewolf": "lonewolf whisper lunar oracle",
  "lone wolf": "lonewolf whisper",
  "lonewolf": "lonewolf whisper",
  "wolf": "lonewolf whisper",
  "butterfly": "butterfly emissary",
  "snail": "atomic snail",
  "turbow": "compound bow",
  "bow": "compound bow",
};
function expandNicknames(question) {
  let q = ` ${question.toLowerCase()} `;
  for (const [nick, real] of Object.entries(NICKNAMES).sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`(^|[^a-z0-9])${nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    if (re.test(q) && !q.includes(` ${real} `)) q = q.replace(re, `$1${real}$2`);
  }
  return q.trim();
}

// words in a title/section name that are worth matching on (drops generic ones)
const GENERIC = new Set(["deviation", "deviations", "page", "main", "guide", "build", "builds", "loadout", "loadouts", "the", "and", "of", "list", "all", "trait", "traits", "combat", "crafting", "territory", "recipe", "recipes", "food", "drinks", "gear", "weapon", "armor", "mods", "mod", "specific", "community", "creator", "creators", "content", "test", "hides", "hide"]);
// whole-word containment: "butter" must not match inside "butterfly"
function includesName(q, nameLower) {
  const esc = nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(q);
}
function nameWords(nameLower) {
  return nameLower.replace(/'s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
}

// Pick the best pages for a question: exact/partial title matches first,
// then full-text search results.
async function findRelevantPages(question, max = 3) {
  const q = expandNicknames(question);
  const titles = await getAllTitles();
  const ranked = [];

  const looksLikeDate = (t) => /^\d{1,2} \w+ \d{4}$|^\w+ \d{1,2} \d{4}$/.test(t);
  const qWords = new Set(q.replace(/'s\b/g, "").split(/[^a-z0-9]+/).filter(Boolean));
  const add = (t, score) => { const r = ranked.find((x) => x.t === t); if (r) r.score = Math.max(r.score, score); else ranked.push({ t, score }); };
  for (const t of titles) {
    const tl = t.toLowerCase();
    if (tl.length < 3 || looksLikeDate(t)) continue;
    if (includesName(q, tl)) { add(t, 100 + tl.length); continue; }
    const words = nameWords(tl);
    if (!words.length) continue;
    const hit = words.filter((w) => qWords.has(w));
    if (hit.length === words.length) add(t, 50 + words.length);
    else if (hit.some((w) => w.length >= 6)) add(t, 30 + (10 * hit.length) / words.length); // "lonewolf" -> Lonewolf's Whisper
  }
  // sections inside big pages count like titles ("soul summoner" -> Deviation Main Page)
  for (const { page, section } of await getSectionIndex()) {
    const sl = section.toLowerCase();
    if (includesName(q, sl)) { add(page, 90 + sl.length); continue; }
    const words = nameWords(sl);
    const hit = words.filter((w) => qWords.has(w));
    if (words.length && hit.length === words.length) add(page, 45 + words.length);
    else if (hit.some((w) => w.length >= 6)) add(page, 28 + (10 * hit.length) / words.length);
  }
  ranked.sort((a, b) => b.score - a.score);
  const picks = ranked.map((r) => r.t);

  // strip the useless words before full-text search
  const cleaned = question.replace(/\b(how|do|does|i|you|the|a|an|what|where|is|are|get|can|to|in|of|for|my|it|this|that|any|best|good)\b/gi, " ").replace(/\s+/g, " ").trim();
  for (const t of await searchTitles(cleaned || question, 5)) if (!picks.includes(t) && !looksLikeDate(t)) picks.push(t);

  return picks.slice(0, max);
}

module.exports = { findRelevantPages, getPageText, trimForQuestion, getSectionIndex, nameWords, includesName, expandNicknames, pageUrl, getAllTitles, searchTitles, WIKI_BASE };
