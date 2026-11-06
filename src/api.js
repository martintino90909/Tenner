// GET /api/today          -> { date, topics, deck: [10 stories], pool: [candidates] }
// GET /api/today?debug=1  -> same, plus the status of every feed

import { SOURCES } from "../lib/sources.js";
import { parseFeed } from "../lib/rss.js";
import { buildPool, pickDeck, londonDate, DEFAULT_TOPICS } from "../lib/pick.js";

const UA = "Tenner/0.1 (personal news reader)";

async function fetchSource(src) {
  const res = await fetch(src.url, {
    headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
    cf: { cacheTtl: 900, cacheEverything: true },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(await res.text(), src);
  if (!items.length) throw new Error("No stories found in feed");
  return items;
}

// The shared pool of today's stories is cached for 30 minutes; each person's
// ten is then picked from it using their own topics.
async function loadPool(origin, now, date, debug, waitUntil) {
  const halfHour = Math.floor(now.getTime() / (30 * 60 * 1000));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`${origin}/__pool2?d=${date}&b=${halfHour}`);
  if (cache && !debug) {
    const hit = await cache.match(cacheKey);
    if (hit) return { pool: (await hit.json()).pool };
  }
  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const pool = buildPool(items, now.getTime());
  if (cache && !debug && pool.length) {
    waitUntil(cache.put(cacheKey, new Response(JSON.stringify({ pool }), { headers: { "cache-control": "public, max-age=1800" } })));
  }
  return { pool, results };
}

export async function onRequestGet({ request, waitUntil, topics = DEFAULT_TOPICS }) {
  const url = new URL(request.url);
  const debug = url.searchParams.has("debug");
  const now = new Date();
  const date = londonDate(now);

  const { pool: all, results } = await loadPool(url.origin, now, date, debug, waitUntil);
  const pool = all.filter((s) => topics.includes(s.topic));
  const deck = pickDeck(pool, date, new Set(), 10, topics);

  const body = { date, generatedAt: now.toISOString(), topics, deck, pool };
  if (debug && results) {
    body.feeds = SOURCES.map((s, i) => ({
      name: s.name,
      topic: s.topic,
      url: s.url,
      ok: results[i].status === "fulfilled",
      stories: results[i].status === "fulfilled" ? results[i].value.length : 0,
      error: results[i].status === "rejected" ? String(results[i].reason?.message || results[i].reason) : undefined,
      latest: results[i].status === "fulfilled" ? results[i].value.slice(0, 3).map((it) => ({ title: it.title, link: it.link })) : [],
    }));
  }

  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}
