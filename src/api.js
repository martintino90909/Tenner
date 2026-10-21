// GET /api/today          -> { date, deck: [10 stories], pool: [candidates] }
// GET /api/today?debug=1  -> same, plus the status of every feed

import { SOURCES } from "../lib/sources.js";
import { parseFeed } from "../lib/rss.js";
import { buildPool, pickDeck, londonDate } from "../lib/pick.js";

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

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url);
  const debug = url.searchParams.has("debug");
  const now = new Date();
  const date = londonDate(now);
  const halfHour = Math.floor(now.getTime() / (30 * 60 * 1000));

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`${url.origin}/__pool?d=${date}&b=${halfHour}`);
  if (cache && !debug) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const pool = buildPool(items, now.getTime());
  const deck = pickDeck(pool, date);

  const body = { date, generatedAt: now.toISOString(), deck, pool };
  if (debug) {
    body.feeds = SOURCES.map((s, i) => ({
      name: s.name,
      topic: s.topic,
      url: s.url,
      ok: results[i].status === "fulfilled",
      stories: results[i].status === "fulfilled" ? results[i].value.length : 0,
      error: results[i].status === "rejected" ? String(results[i].reason?.message || results[i].reason) : undefined,
    }));
  }

  const res = new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": debug ? "no-store" : "public, max-age=1800",
    },
  });
  if (cache && !debug && deck.length) waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
