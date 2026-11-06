# Tenner

Ten news stories a day, as swipeable cards on your phone. Swipe right for interesting, left for not, tap to open, bookmark to save.

## What's in Phase 1

- Live stories from free RSS feeds across six topics: tech & engineering, business & markets, cars & motorsport, UK & world, plus opt-in Biomedical and Medicine & health
- A daily ten, split evenly across topics, with duplicates from different outlets merged
- Swipe, open, save for later, and "deal 10 more" from the rest of the day's stories
- Full articles readable inside the app (falls back to the original site when a story is paywalled)
- Installable to the iPhone home screen
- Every swipe, open and save is logged on the phone, ready for the learning algorithm in Phase 3

## How it's built

| Part | Where |
| --- | --- |
| Phone app (HTML, CSS, JS, no build step) | `public/` |
| Worker entry (serves the app, routes `/api/today`) | `src/worker.js` |
| News API: fetches feeds, picks the ten | `src/api.js` |
| Reader API: loads an article's full text (`/api/article`) | `src/article.js`, `lib/article.js` |
| AI "why it matters" (`/api/why`), shared cache | `src/why.js` |
| Accounts (Durable Object with SQLite) | `src/store-do.js`, `lib/store.js` |
| Admin page | `public/admin.html` |
| Cloudflare config | `wrangler.jsonc` |
| Feed list | `lib/sources.js` |
| RSS/Atom parser | `lib/rss.js` |
| Dedupe and daily selection | `lib/pick.js` |
| Tests | `test/` (run `npm test`) |

Hosted on Cloudflare Workers (free tier), with `public/` served as static assets.

## Deploying

The `tenner` Worker in Cloudflare is connected to this repo. Every push to `main` builds and deploys it automatically with `npx wrangler deploy`.

Live at https://tenner.martintino90909.workers.dev

## Accounts

Tenner is invite-only. Each person gets a personal link (`/u/<key>`); opening it signs them in on that phone, and adding it to the Home Screen keeps them signed in. Saved stories, skips and learning stay on each person's phone; the server keeps their name, topics, status, usage counts, notification subscriptions, stories sent between friends, and (if they allow it) which stories they liked.

Manage people at `/admin`: add someone (pick their topics), copy their invite message, pause or resume them, make a new link (the old one stops working), or remove them. The admin key is not in this repo; only its SHA-256 hash is (`ADMIN_KEY_SHA256` in `wrangler.jsonc`). To change the key, put the hash of a new random key there and redeploy.

## Morning notification

Each person can turn on a daily notification (You tab) and pick a time. A schedule runs every 15 minutes and sends their top headline once a day, within 90 minutes of their chosen time (London time). It uses standard Web Push with encryption built on WebCrypto (`lib/webpush.js`, tested against the RFC 8291 example); the signing keys are generated on first use and kept in the Durable Object. On iPhone, Tenner must be added to the Home Screen first.

## Learning

Runs on each phone (`public/learn.js`); nothing leaves the device. Saves +3, opens +2, long reads +1, swipe right +1, swipe left −1, on the story's topic, source and headline keywords, fading 2% a day. After 15 swipes, each day's ten are the 8 best-scoring stories (max 4 per topic, 3 per source) plus 2 wildcards from the least-liked topics. The You tab shows the scores and lets each person nudge a topic (Less / Auto / More) or mute it.

## Listen mode

The reader has a Listen button that reads the headline, intro, "why it matters" and the article aloud with the phone's built-in voice (best British voice available). It speaks a paragraph at a time, highlights it, and has back/next, pause, speed (1×, 1.25×, 1.5×, 0.85×) and stop; tap a paragraph to jump there. It keeps the screen awake while playing. Listening to most of a story counts as a long read for learning. Code: `public/listen.js`.

## Offline

The service worker (`public/sw.js`) keeps a copy of the app, network first, so Tenner opens with no signal and updates still arrive straight away online. Saving a story downloads its full text (and photo) into the phone's cache; the Saved list shows "Offline ready". Stories saved before this, or while offline, download next time the app is online. Unsaving removes the download.

## Explain this

When an article opens, `/api/terms` asks Workers AI for up to 6 jargon terms with one-line plain-English explanations; the reader underlines the first use of each, and tapping one shows the explanation. Highlighting any words (up to 8) shows an Explain button that calls `/api/explain` with the surrounding paragraph. Both are cached and shared for a week, so an article's terms are generated once for everyone. Saved stories keep their terms for offline reading. Prompts and parsing: `lib/explain.js`.

## Friends

- **Send a story:** the paper-plane button in the reader opens a list of everyone else on Tenner; pick friends and add an optional note (up to 140 characters, 20 sends a day). The story becomes their next card, marked "From <name>", and they get a notification if they have them on. Only links to Tenner's own news sources can be sent.
- **Liked by friends:** if someone allows it (switch on the You tab, on by default), the ids of stories they swipe right on or save are stored for 7 days. Cards show "Liked by N friends" when two or more *other* people liked them. Never names, never skips. Turning the switch off deletes that person's stored likes.
- **Your topics:** everyone can add or remove topics on the You tab; changes from the admin page still apply and win if made later.

## Checking the feeds

Open `https://tenner.martintino90909.workers.dev/api/today?debug=1` to see every feed, whether it loaded, and how many stories it gave. To add or drop a source, edit `lib/sources.js`.

## Putting it on your iPhone

Open the site in Safari, tap **Share**, then **Add to Home Screen**.

## Roadmap

1. **Phase 1:** working feed (this)
2. **Phase 2:** 7:30am push notification
3. **Phase 3:** learning from your swipes, interests dashboard
4. **Phase 4:** AI summaries
