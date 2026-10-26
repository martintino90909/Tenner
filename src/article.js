// GET /api/article?url=<article link>
//   -> { ok: true, blocks: [{type, text}], words, minutes }
//   -> { ok: false, reason }  when the site blocks it or it's paywalled
// Results are cached for 6 hours so reopening a story is instant.

import { ARTICLE_SITES } from "../lib/sources.js";
import { extractArticle, isAllowed } from "../lib/article.js";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const json = (body, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });

export async function handleArticle(request, ctx) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url") || "";
  const debug = params.has("debug");
  if (!isAllowed(url, ARTICLE_SITES)) return json({ ok: false, reason: "This site isn't supported in the reader" }, 400);

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`https://tenner.cache/article?u=${encodeURIComponent(url)}`);
  if (cache && !debug) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  let res;
  try {
    res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-GB,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
    });
  } catch (err) {
    return json({ ok: false, reason: "Couldn't reach the site" }, 502);
  }
  if (!res.ok) return json({ ok: false, reason: `The site returned an error (${res.status})` }, 502);
  if (!isAllowed(res.url || url, ARTICLE_SITES)) return json({ ok: false, reason: "The story redirected to another site" }, 502);

  const article = extractArticle(await res.text(), { debug });
  if (debug) return json(article);
  const body = article.ok
    ? article
    : { ok: false, reason: "This story is paywalled or in a format the reader can't show" };
  const out = json(body, 200, article.ok ? 21600 : 3600);
  if (cache) ctx.waitUntil(cache.put(key, out.clone()));
  return out;
}
