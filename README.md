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

Tenner is invite-only. Each person gets a personal link (`/u/<key>`); opening it signs them in on that phone, and adding it to the Home Screen keeps them signed in. Saved stories and swipes stay on each person's phone; the server only keeps their name, topics, status and usage counts.

Manage people at `/admin`: add someone (pick their topics), copy their invite message, pause or resume them, make a new link (the old one stops working), or remove them. The admin key is not in this repo; only its SHA-256 hash is (`ADMIN_KEY_SHA256` in `wrangler.jsonc`). To change the key, put the hash of a new random key there and redeploy.

## Morning notification

Each person can turn on a daily notification (You tab) and pick a time. A schedule runs every 15 minutes and sends their top headline once a day, within 90 minutes of their chosen time (London time). It uses standard Web Push with encryption built on WebCrypto (`lib/webpush.js`, tested against the RFC 8291 example); the signing keys are generated on first use and kept in the Durable Object. On iPhone, Tenner must be added to the Home Screen first.

## Learning

Runs on each phone (`public/learn.js`); nothing leaves the device. Saves +3, opens +2, long reads +1, swipe right +1, swipe left −1, on the story's topic, source and headline keywords, fading 2% a day. After 15 swipes, each day's ten are the 8 best-scoring stories (max 4 per topic, 3 per source) plus 2 wildcards from the least-liked topics. The You tab shows the scores and lets each person nudge a topic (Less / Auto / More) or mute it.

## Checking the feeds

Open `https://tenner.martintino90909.workers.dev/api/today?debug=1` to see every feed, whether it loaded, and how many stories it gave. To add or drop a source, edit `lib/sources.js`.

## Putting it on your iPhone

Open the site in Safari, tap **Share**, then **Add to Home Screen**.

## Roadmap

1. **Phase 1:** working feed (this)
2. **Phase 2:** 7:30am push notification
3. **Phase 3:** learning from your swipes, interests dashboard
4. **Phase 4:** AI summaries
