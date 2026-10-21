// POST /api/why  { title, summary, source }  ->  { why: "one sentence" }
// Uses Cloudflare Workers AI, which has a free daily allowance (no API key).
// One call is roughly 20-40 "neurons"; the free allowance is 10,000 a day.

export const MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

const SYSTEM = `You write the "Why it matters" line for a UK news app.
You get a headline and the outlet's short intro. Write ONE sentence, at most 25 words, explaining why the story matters: its consequence, who it affects, or the bigger trend it is part of.
Rules:
- Use only the facts given plus widely known background. Never invent numbers, names, dates or quotes.
- Don't repeat the headline. Add something the reader doesn't already know from it.
- If the intro is too thin to say anything useful, describe the general significance of this kind of news.
- Plain British English. No preamble, no label, no quotation marks, no emoji.`;

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function cleanWhy(text) {
  const quotes = /^["'“‘*]+|["'”’*]+$/g;
  let s = String(text || "").trim().replace(quotes, "").trim();
  s = s.replace(/^(why it matters|why this matters)\s*[:\-–—]\s*/i, "");
  s = s.split(/\n/)[0].trim().replace(quotes, "").trim();
  if (s.length > 240) s = s.slice(0, 240).replace(/\s+\S*$/, "") + "…";
  return s;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function handleWhy(request, env) {
  if (!env.AI) return json({ error: "AI is not set up for this Worker" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON" }, 400); }
  const title = clip(body.title, 300);
  const summary = clip(body.summary, 600);
  const source = clip(body.source, 60);
  if (!title) return json({ error: "Missing title" }, 400);

  try {
    const out = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Outlet: ${source}\nHeadline: ${title}\nIntro: ${summary || "(none)"}` },
      ],
      max_tokens: 90,
      temperature: 0.3,
    });
    const raw = typeof out?.response === "string" ? out.response : out?.choices?.[0]?.message?.content || "";
    const why = cleanWhy(raw);
    if (!why) return json({ error: "Empty answer from the model" }, 502);
    return json({ why });
  } catch (err) {
    // On the free plan this is what happens if the daily allowance runs out.
    return json({ error: String(err?.message || err) }, 502);
  }
}
