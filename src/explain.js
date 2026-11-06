// "Explain this"
//   POST /api/terms   { url, title, text }      -> { terms: [{ term, explanation }] }
//   POST /api/explain { phrase, passage, title } -> { explanation }
// Uses the free Workers AI allowance. Answers are cached and shared, so an
// article's terms are only worked out once however many people read it.

import { MODEL } from "./why.js";
import { hashId } from "../lib/rss.js";
import { TERMS_SYSTEM, EXPLAIN_SYSTEM, parseTerms, cleanExplanation, termsPrompt, explainPrompt } from "../lib/explain.js";

const WEEK = 7 * 24 * 60 * 60;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function cached(key, ctx, make) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const req = new Request(`https://tenner.cache/${key}`);
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit.json();
  }
  const value = await make();
  if (cache && ctx && value) ctx.waitUntil(cache.put(req, new Response(JSON.stringify(value), { headers: { "cache-control": `public, max-age=${WEEK}` } })));
  return value;
}

async function ask(env, system, user, maxTokens) {
  const out = await env.AI.run(MODEL, {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: maxTokens,
    temperature: 0.2,
  });
  return typeof out?.response === "string" ? out.response : out?.choices?.[0]?.message?.content || "";
}

export async function handleTerms(request, env, ctx) {
  if (!env.AI) return json({ error: "AI is not set up" }, 503);
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "");
  if (!body.url || text.length < 200) return json({ terms: [] });
  try {
    const result = await cached(`terms/${hashId(String(body.url))}`, ctx, async () => {
      const raw = await ask(env, TERMS_SYSTEM, termsPrompt(body.title, text), 400);
      return { terms: /^\s*NONE\b/i.test(raw) ? [] : parseTerms(raw, text) };
    });
    return json(result);
  } catch (err) {
    // Out of free allowance, or the model hiccuped: the reader just shows no underlines.
    return json({ terms: [], error: String(err?.message || err) }, 200);
  }
}

export async function handleExplain(request, env, ctx) {
  if (!env.AI) return json({ error: "AI is not set up" }, 503);
  const body = await request.json().catch(() => ({}));
  const phrase = String(body.phrase || "").replace(/\s+/g, " ").trim();
  if (phrase.length < 2 || phrase.length > 80 || phrase.split(" ").length > 8) {
    return json({ error: "Highlight a word or short phrase (up to 8 words) to explain it." }, 400);
  }
  try {
    const result = await cached(`explain/${hashId(`${phrase.toLowerCase()}|${body.title || ""}`)}`, ctx, async () => {
      const explanation = cleanExplanation(await ask(env, EXPLAIN_SYSTEM, explainPrompt(phrase, body.passage, body.title), 90));
      return explanation ? { explanation } : null;
    });
    if (!result) return json({ error: "No explanation came back. Try again." }, 502);
    return json(result);
  } catch (err) {
    return json({ error: "Explanations aren't available right now. Try again later." }, 502);
  }
}
