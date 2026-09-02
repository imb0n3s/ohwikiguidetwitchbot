# OH Wiki Bot

A hosted Twitch bot, in the style of Pokemon Community Game: **any streamer can add it
to their channel** from a web page (or by typing `!join` in the bot's own chat), and
their viewers can ask Once Human questions that get answered from
[ohwikiguide.com](https://ohwikiguide.com).

```
viewer42:   !ohwikiguide where does Butterfly's Emissary drop?
ohwikibot:  @viewer42 Butterfly's Emissary — Drops From: Manibus: Securement Units;
            Way of Winter: Securement Units; Monolith: N/A | Notes: No specific Silo
            but can drop from anyone  https://ohwikiguide.com/Butterfly's_Emissary
```

One server runs for everyone. It listens to every joined channel over Twitch EventSub
(the modern replacement for IRC), looks the answer up on the wiki, and replies via the
Twitch chat API.

**Two answer modes** (`ANSWER_MODE` in the env vars):

- `free` (default) — no AI, nothing per question. The bot finds the best wiki page, works
  out which part the question is about ("where does X drop" → the *Drops From* field,
  "X skill" → *Attacks*, "recipe" → *Ingredients*) and replies with those lines + link.
- `claude` — an AI writes a natural one-sentence answer from the page text. About half a
  cent per question; needs `ANTHROPIC_API_KEY`. Switch any time by changing the variable
  and redeploying.

---

## Part 1 — Create the bot's Twitch account

1. Log out of Twitch (or use a private window) and create a new account, e.g. **ohwikibot**.
   This is the name that will show up in people's chats.
2. Turn on 2FA for it (Settings → Security). Twitch requires 2FA before you can create a developer app.

## Part 2 — Create the Twitch developer app

1. While logged in as the **bot account**, go to https://dev.twitch.tv/console/apps and click **Register Your Application**.
2. Fill in:
   - **Name:** OH Wiki Bot (must be unique on Twitch; add a suffix if taken)
   - **OAuth Redirect URLs:** `https://YOUR-DOMAIN/auth/callback`
     (you'll know the domain after Part 3 — you can come back and edit this)
   - **Category:** Chat Bot
   - **Client Type:** Confidential
3. Click **Create**, then **Manage** → copy the **Client ID** and click **New Secret** → copy the **Client Secret**.

## Part 3 — Deploy to Railway

1. Push this folder to a GitHub repo (private is fine).
2. https://railway.app → **New Project → Deploy from GitHub repo** → pick the repo.
   Railway detects the `Dockerfile` and builds it.
3. In the service, open **Settings → Networking → Generate Domain**. You get something like
   `ohwiki-bot-production.up.railway.app`. That's your domain — put
   `https://<that>/auth/callback` into the Twitch app's Redirect URLs (Part 2).
4. **Settings → Volumes → Add Volume**, mount path `/data`. This is where the SQLite
   database (joined channels, bot tokens) lives so it survives redeploys.
5. **Variables** tab → add these (see `.env.example`):

   | Variable | Value |
   |---|---|
   | `TWITCH_CLIENT_ID` | from Part 2 |
   | `TWITCH_CLIENT_SECRET` | from Part 2 |
   | `BASE_URL` | `https://<your railway domain>` (no trailing slash) |
   | `ANSWER_MODE` | `free` (or `claude` — then also set `ANTHROPIC_API_KEY`) |
   | `ADMIN_KEY` | any long random string (unlocks `/setup` and `/admin`) |
   | `SESSION_SECRET` | another long random string |
   | `DATA_DIR` | `/data` |

   Optional: `BOT_NAME`, `DISCORD_URL`, `CLAUDE_MODEL`, `COMMANDS`, cooldowns — all listed in `.env.example`.
6. Redeploy. Open `https://<domain>/health` — you should see `{"ok":true,...}`.

(Render works the same way: `render.yaml` is included. A cheap VPS works too:
`docker build -t ohwiki . && docker run -d --restart=always -p 3000:3000 -v ohdata:/data --env-file .env ohwiki`.)

## Part 4 — Connect the bot account (one time)

1. In a browser where you're logged in to Twitch **as the bot account**, open
   `https://<domain>/setup?key=<your ADMIN_KEY>`.
2. Click **Log in as the bot account** and approve. The page will confirm
   "Bot is running as ohwikibot". Its tokens are now stored and auto-refreshed.

That's it. The bot is live and listening in its own channel.

## Part 5 — Tell streamers how to add it

Send them `https://<domain>` — they click **Add to my Twitch channel**, approve once, done.
Or they can go to `twitch.tv/ohwikibot` and type `!join` (`!leave` to remove).

Suggest they `/mod ohwikibot` in their channel: Twitch rate-limits normal users to
20 messages / 30 s per channel; mods get 100.

---

## Commands (in any joined channel)

| Command | Who | What |
|---|---|---|
| `!ohwikiguide <question>` / `!ask <question>` | anyone | Answer from the wiki + link |
| `!ohwiki` | anyone | Short help |
| `!ohwiki cooldown <seconds>` | mods / broadcaster | Per-viewer cooldown for that channel (default 20s) |
| `!ohwiki leave` | mods / broadcaster | Remove the bot from the channel |

In the bot's own channel: `!join`, `!leave`.

## Pages

| URL | What |
|---|---|
| `/` | Landing page with the Add / Remove buttons and live stats |
| `/setup?key=ADMIN_KEY` | Connect (or re-connect) the bot account |
| `/admin?key=ADMIN_KEY` | List of joined channels, question counts, subscription status |
| `/health`, `/api/stats` | JSON for monitoring / embedding a counter on the wiki |

## How it answers

`wiki.js` keeps a cached list of every wiki page title. For each question it first
matches titles that appear in the question ("Atomic Snail", "P90 1% build"), then falls
back to the wiki's full-text search. It fetches the rendered page text **and** the data
inside the interactive pages' `<script>` blocks (Deviation Main Page, loadout builders),
so items that only exist in those dropdowns are still answerable. For huge pages only the
sections matching the question are sent. Pages are cached 10 minutes, so edits show up fast.

`answer-free.js` (free mode) parses the page into labelled fields and picks the ones the
question is about. `answer.js` (claude mode) sends the excerpts to Claude with a strict
"only answer from this, under 380 characters, no URLs" prompt. `answerer.js` picks one
based on `ANSWER_MODE`.

Test the pipeline from your machine without Twitch:
```
npm install
npm run ask -- "how do I raise deviation mood"
```

## Cost

Free mode: just the hosting (Railway hobby plan ~$5/month). Claude mode adds roughly
$0.005–0.01 per question — a stream night with 200 questions ≈ $1–2.

## Scaling notes

One bot account can hold 900 channel subscriptions (3 EventSub sockets × 300). If the
bot ever gets that popular, switch `eventsub.js` to EventSub **Conduits** (same
subscription type, no per-socket cap) and apply for Twitch's verified-bot status, which
lifts the send rate limits. Until then, nothing to do.

## Files

```
index.js     start web + chat listener
web.js       landing page, Twitch OAuth (streamer add/remove, bot setup), /admin
eventsub.js  EventSub WebSocket pool (reconnects, resubscribes, 3×300 channels)
commands.js  !ask / !join / !leave / !ohwiki handling, cooldowns
twitch.js    OAuth, token refresh, Helix calls, send chat message
wiki.js      MediaWiki API client, text extraction, page ranking
answerer.js  picks free or claude engine
answer-free.js  field-aware wiki extraction (no AI)
answer.js    Claude prompt + answer formatting
db.js        SQLite (channels, bot tokens, question log)
ask.js       terminal tester
```
