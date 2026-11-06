// Morning notifications.
//   GET  /api/push            -> { devices, time, publicKey }
//   POST /api/push/subscribe   { subscription, time }
//   POST /api/push/unsubscribe { endpoint }
//   POST /api/push/time        { time }
//   POST /api/push/test        sends "Notifications are on" to this person's phones
// A schedule runs every 15 minutes and sends each person their top headline
// once a day, at the time they chose (London time).

import { storeFor } from "./store-do.js";
import { loadPool } from "./api.js";
import { sendPush } from "../lib/webpush.js";
import { pickDeck, londonDate } from "../lib/pick.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });

const site = (env) => env.SITE_URL || "https://tenner.martintino90909.workers.dev";

function londonTime(d = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export async function deliver(env, store, subs, payload, topic = "tenner-daily") {
  const vapid = await store.vapid();
  let sent = 0;
  for (const sub of subs) {
    const r = await sendPush(sub, payload, vapid, { subject: site(env), topic });
    if (r.ok) sent++;
    else if (r.gone) await store.dropSub(sub.endpoint); // phone unsubscribed or app removed
    else console.warn("push failed", r.status, new URL(sub.endpoint).host, r.error || "");
  }
  return sent;
}

export async function handlePush(request, env, path, key) {
  const store = storeFor(env);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  try {
    if (path === "/api/push" && request.method === "GET") {
      return json({ ...(await store.pushSettings(key)), publicKey: await store.vapidPublicKey() });
    }
    if (path === "/api/push/subscribe" && request.method === "POST") return json(await store.subscribe(key, body.subscription, body.time));
    if (path === "/api/push/unsubscribe" && request.method === "POST") return json(await store.unsubscribe(key, body.endpoint));
    if (path === "/api/push/time" && request.method === "POST") return json(await store.setNotifyTime(key, body.time));
    if (path === "/api/push/test" && request.method === "POST") {
      const me = await store.auth(key);
      const subs = await store.subsFor(me.id);
      const sent = await deliver(env, store, subs, {
        title: "Tenner notifications are on",
        body: `You'll get your ten at ${(await store.pushSettings(key)).time} each morning.`,
        url: "/",
      });
      return json({ sent, devices: subs.length });
    }
  } catch (err) {
    return json({ error: "bad-request", message: String(err?.message || err) }, 400);
  }
  return json({ error: "not-found" }, 404);
}

export async function runScheduled(env, ctx) {
  const now = new Date();
  const date = londonDate(now);
  const store = storeFor(env);
  const due = await store.due(date, londonTime(now));
  if (!due.length) return;

  const { pool } = await loadPool(site(env), now, date, false, (p) => ctx.waitUntil(p));
  for (const person of due) {
    const mine = pool.filter((s) => person.topics.includes(s.topic));
    const deck = pickDeck(mine, date, new Set(), 10, person.topics);
    if (!deck.length) continue;
    const top = deck[0];
    await deliver(env, store, person.subs, {
      title: top.title,
      body: `${top.source} · plus ${deck.length - 1} more in today's ten`,
      url: "/",
    });
    await store.markNotified(person.id, date);
  }
}
