// answer.js — turn a chat question + wiki pages into a short Twitch-sized answer
const Anthropic = require("@anthropic-ai/sdk");
const wiki = require("./wiki");

let _client;
const client = () => (_client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const MAX_ANSWER_CHARS = Number(process.env.MAX_ANSWER_CHARS || 380); // Twitch hard limit is 500

const SYSTEM = `You are the chat helper bot for ohwikiguide.com, a community wiki for the game Once Human.
You answer Twitch chat questions using ONLY the wiki page excerpts you are given.

Rules:
- Reply in plain text, one short paragraph, under ${MAX_ANSWER_CHARS} characters. No markdown, no bullet points, no line breaks.
- Be direct: lead with the answer. Twitch chat is fast; nobody wants a preamble.
- If the excerpts don't contain the answer, say so in one sentence and point to the closest wiki page. Never make up game facts.
- Don't mention "excerpts", "context", or that you were given text. Just answer like a knowledgeable mod.
- Do not include URLs; the bot appends the page link itself.`;

async function answerQuestion(question) {
  const titles = await wiki.findRelevantPages(question, 3);
  if (!titles.length) {
    return { text: `I couldn't find anything on the wiki for that. Try browsing ${wiki.WIKI_BASE}`, source: null };
  }

  const pages = await Promise.all(titles.map(async (t) => ({ title: t, text: wiki.trimForQuestion(await wiki.getPageText(t), question) })));
  const context = pages.map((p) => `=== PAGE: ${p.title} ===\n${p.text}`).join("\n\n");

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Wiki excerpts:\n\n${context}\n\n---\nTwitch chat question: ${question}\n\nAlso, on the very last line, write "SOURCE: <page title>" with the single page title (from the list above) that best answers the question.`,
      },
    ],
  });

  let out = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();

  // pull the SOURCE line off the end
  let source = titles[0];
  const m = out.match(/\n?\s*SOURCE:\s*(.+)\s*$/i);
  if (m) {
    const guess = m[1].trim();
    source = titles.find((t) => t.toLowerCase() === guess.toLowerCase()) || source;
    out = out.slice(0, m.index).trim();
  }

  out = out.replace(/\s+/g, " ");
  if (out.length > MAX_ANSWER_CHARS) out = out.slice(0, MAX_ANSWER_CHARS - 1).replace(/\s+\S*$/, "") + "…";

  return { text: out, source, url: wiki.pageUrl(source) };
}

module.exports = { answerQuestion };
