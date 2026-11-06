// Friends features.
//   GET  /api/friends             -> { friends: [{ id, name }] }
//   POST /api/share               { to: [ids], story, note } -> { sent: ["Alex"] }
//   GET  /api/inbox               -> { items: [{ id, from, note, sent, story }] }
//   POST /api/inbox/ack           { ids }
//   POST /api/likes               { id, on }       (only from people who allow it)
//   POST /api/likes/clear
//   POST /api/likes/counts        { ids } -> { counts: { id: n } }  (others only)
//   POST /api/me/topics           { topics } -> { topics }

import { storeFor } from "./store-do.js";
import { deliver } from "./push.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });

export async function handleFriends(request, env, ctx, path, key) {
  const store = storeFor(env);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  try {
    if (path === "/api/friends" && request.method === "GET") return json({ friends: await store.friends(key) });
    if (path === "/api/me/topics" && request.method === "POST") return json({ topics: await store.setMyTopics(key, body.topics) });
    if (path === "/api/inbox" && request.method === "GET") return json({ items: await store.inbox(key) });
    if (path === "/api/inbox/ack" && request.method === "POST") return json({ ok: await store.ack(key, body.ids) });
    if (path === "/api/likes" && request.method === "POST") return json({ ok: await store.like(key, body.id, !!body.on) });
    if (path === "/api/likes/clear" && request.method === "POST") return json({ ok: await store.clearLikes(key) });
    if (path === "/api/likes/counts" && request.method === "POST") return json({ counts: await store.likeCounts(key, body.ids) });

    if (path === "/api/share" && request.method === "POST") {
      const result = await store.share(key, body.to, body.story, body.note);
      // Let them know straight away if they have notifications on.
      ctx.waitUntil(
        (async () => {
          for (const r of result.recipients) {
            const subs = await store.subsFor(r.id);
            if (!subs.length) continue;
            await deliver(env, store, subs, {
              title: `${result.from} sent you a story`,
              body: result.note ? `${result.story.title} · “${result.note}”` : result.story.title,
              url: "/",
              tag: "tenner-share",
            }, "tenner-share");
          }
        })().catch((err) => console.warn("share push failed", err))
      );
      return json({ sent: result.recipients.map((r) => r.name) });
    }
  } catch (err) {
    return json({ error: "bad-request", message: String(err?.message || err) }, 400);
  }
  return json({ error: "not-found" }, 404);
}
