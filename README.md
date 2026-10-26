# Tenner

Ten news stories a day, as swipeable cards on your phone. Swipe right for interesting, left for not, tap to open, bookmark to save.

## What's in Phase 1

- Live stories from free RSS feeds across four topics: tech & engineering, business & markets, cars & motorsport, UK & world
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
| AI "why it matters" (`/api/why`) | `src/why.js` |
| Cloudflare config | `wrangler.jsonc` |
| Feed list | `lib/sources.js` |
| RSS/Atom parser | `lib/rss.js` |
| Dedupe and daily selection | `lib/pick.js` |
| Tests | `test/` (run `npm test`) |

Hosted on Cloudflare Workers (free tier), with `public/` served as static assets.

## Deploying

The `tenner` Worker in Cloudflare is connected to this repo. Every push to `main` builds and deploys it automatically with `npx wrangler deploy`.

Live at https://tenner.martintino90909.workers.dev

## Checking the feeds

Open `https://tenner.martintino90909.workers.dev/api/today?debug=1` to see every feed, whether it loaded, and how many stories it gave. To add or drop a source, edit `lib/sources.js`.

## Putting it on your iPhone

Open the site in Safari, tap **Share**, then **Add to Home Screen**.

## Roadmap

1. **Phase 1:** working feed (this)
2. **Phase 2:** 7:30am push notification
3. **Phase 3:** learning from your swipes, interests dashboard
4. **Phase 4:** AI summaries
