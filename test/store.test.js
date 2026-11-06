import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Store, cleanTopics } from "../lib/store.js";
import { quotas, pickDeck, buildPool, TOPIC_KEYS, DEFAULT_TOPICS } from "../lib/pick.js";

function makeStore() {
  const db = new DatabaseSync(":memory:");
  let now = 1_000_000;
  const sql = (q, ...p) => {
    const st = db.prepare(q);
    return /^\s*(select|pragma)/i.test(q) ? st.all(...p) : (st.run(...p), []);
  };
  const store = new Store(sql, () => now);
  return { store, tick: (ms) => (now += ms) };
}

test("create gives each person a unique private link", () => {
  const { store } = makeStore();
  const a = store.create({ name: "  Alex  " });
  const b = store.create({ name: "Liem" });
  assert.equal(a.name, "Alex");
  assert.ok(a.token.length >= 20 && a.token !== b.token);
  assert.deepEqual(a.topics, DEFAULT_TOPICS, "Biomedical and Medicine are opt-in");
  assert.throws(() => store.create({ name: " " }), /name/);
});

test("auth: valid, paused, removed and reset links", () => {
  const { store } = makeStore();
  const a = store.create({ name: "Alex" });
  assert.equal(store.auth(a.token).name, "Alex");
  assert.equal(store.auth("nope"), null);
  assert.equal(store.auth(undefined), null);

  store.update(a.id, { status: "paused" });
  assert.equal(store.auth(a.token).status, "paused");
  store.update(a.id, { status: "active" });

  const fresh = store.resetLink(a.id);
  assert.equal(store.auth(a.token), null, "old link stops working");
  assert.equal(store.auth(fresh.token).name, "Alex");

  store.remove(a.id);
  assert.equal(store.auth(fresh.token), null);
});

test("last used updates at most every 5 minutes; activity adds up", () => {
  const { store, tick } = makeStore();
  const a = store.create({ name: "Alex" });
  const first = store.auth(a.token).lastSeen;
  tick(60_000);
  assert.equal(store.auth(a.token).lastSeen, first);
  tick(5 * 60_000);
  assert.ok(store.auth(a.token).lastSeen > first);

  store.activity(a.token, { swipes: 7, opens: 2, reads: 1 });
  store.activity(a.token, { swipes: 3, opens: -5, reads: "x" });
  const row = store.list()[0];
  assert.deepEqual([row.swipes, row.opens, row.reads], [10, 2, 1]);

  store.update(a.id, { status: "paused" });
  assert.equal(store.activity(a.token, { swipes: 5 }), false);
});

test("topics are cleaned and default to the four general ones", () => {
  assert.deepEqual(cleanTopics(["cars", "nonsense", "cars"]), ["cars"]);
  assert.deepEqual(cleanTopics([]), DEFAULT_TOPICS);
  assert.deepEqual(cleanTopics(["bio", "med"]), ["bio", "med"]);
  const { store } = makeStore();
  const a = store.create({ name: "Alex", topics: ["tech", "world"] });
  assert.deepEqual(a.topics, ["tech", "world"]);
  assert.deepEqual(store.update(a.id, { topics: ["biz"] }).topics, ["biz"]);
});

test("the daily ten only uses a person's topics", () => {
  for (const topics of [["tech", "world"], ["cars"], ["tech", "biz", "world"]]) {
    const q = quotas("2026-11-05", topics);
    assert.equal(Object.values(q).reduce((a, b) => a + b, 0), 10);
    assert.deepEqual(Object.keys(q).sort(), [...topics].sort());
  }
  const pool = [];
  for (const t of TOPIC_KEYS) for (let i = 0; i < 12; i++) pool.push({ id: `${t}${i}`, topic: t, source: `${t}-${i % 4}`, title: `${t} ${i}` });
  const deck = pickDeck(pool, "2026-11-05", new Set(), 10, ["tech", "world"]);
  assert.equal(deck.length, 10);
  assert.ok(deck.every((s) => s.topic === "tech" || s.topic === "world"));
});

test("biomedical and medicine stories stay eligible for longer than general news", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const titles = { a: "Prime minister visits Leeds flood defences", b: "Gene therapy restores hearing in mice", c: "Enzyme discovery explains bacterial resistance", d: "NHS waiting lists fall for third month", e: "Junior doctors vote on new contract offer" };
  const mk = (id, topic, ageDays) => ({ id, topic, source: `${topic} src`, title: titles[id], link: `https://x.test/${id}`, summary: "", image: "", published: now - ageDays * day });
  const pool = buildPool([mk("a", "world", 2), mk("b", "bio", 5), mk("c", "bio", 7), mk("d", "med", 3), mk("e", "med", 5)], now);
  assert.deepEqual(pool.map((p) => p.id).sort(), ["b", "d"]);
});

test("a medicine-only person gets ten medicine stories", () => {
  const pool = Array.from({ length: 14 }, (_, i) => ({ id: `m${i}`, topic: "med", source: `med-${i % 5}`, title: `m ${i}` }));
  const deck = pickDeck(pool, "2026-11-06", new Set(), 10, ["med"]);
  assert.equal(deck.length, 10);
});

test("notifications: subscribe, choose a time, and only send once in the window", () => {
  const { store } = makeStore();
  const a = store.create({ name: "Alex" });
  const b = store.create({ name: "Liem" });
  const sub = (n) => ({ endpoint: `https://web.push.apple.com/x${n}`, keys: { p256dh: "pk" + n, auth: "au" + n } });

  assert.deepEqual(store.subscribe(a.token, sub(1), "07:30"), { devices: 1, time: "07:30" });
  store.subscribe(a.token, sub(1), "07:30"); // same phone again: no duplicate
  assert.equal(store.pushSettings(a.token).devices, 1);
  store.subscribe(b.token, sub(2), "08:15");
  assert.throws(() => store.subscribe(a.token, { endpoint: "http://bad" }), /valid/);
  assert.equal(store.setNotifyTime(a.token, "25:99").time, "07:30", "bad times fall back to 07:30");

  assert.deepEqual(store.due("2026-11-07", "07:15").map((u) => u.name), []);
  const due = store.due("2026-11-07", "07:30");
  assert.deepEqual(due.map((u) => u.name), ["Alex"]);
  assert.equal(due[0].subs[0].endpoint, "https://web.push.apple.com/x1");
  store.markNotified(due[0].id, "2026-11-07");
  assert.deepEqual(store.due("2026-11-07", "07:45").map((u) => u.name), [], "once a day");
  assert.deepEqual(store.due("2026-11-07", "09:30").map((u) => u.name), ["Liem"]);
  assert.deepEqual(store.due("2026-11-07", "10:00").map((u) => u.name), [], "too late after the window");

  store.update(b.id, { status: "paused" });
  assert.deepEqual(store.due("2026-11-08", "08:30").map((u) => u.name), ["Alex"], "paused people get nothing");

  assert.equal(store.list().find((u) => u.name === "Alex").pushDevices, 1);
  store.unsubscribe(a.token, sub(1).endpoint);
  assert.equal(store.pushSettings(a.token).devices, 0);
  store.dropSub(sub(2).endpoint);
  assert.equal(store.list().find((u) => u.name === "Liem").pushDevices, 0);
});

test("settings are stored as JSON", () => {
  const { store } = makeStore();
  assert.equal(store.getSetting("vapid"), null);
  store.setSetting("vapid", { publicKey: "abc" });
  store.setSetting("vapid", { publicKey: "def" });
  assert.deepEqual(store.getSetting("vapid"), { publicKey: "def" });
});

const story = (n = 1) => ({ id: `st${n}`, title: `Story ${n}`, link: `https://www.bbc.co.uk/news/articles/x${n}`, summary: "Intro", topic: "cars", source: "BBC Sport F1", image: "javascript:alert(1)", extra: "dropped" });

test("friends: list, send with a note, inbox once, and limits", () => {
  const { store } = makeStore();
  const m = store.create({ name: "Martin" });
  const a = store.create({ name: "Alex" });
  const l = store.create({ name: "Liem" });
  store.update(l.id, { status: "paused" });
  assert.deepEqual(store.friends(m.token).map((f) => f.name), ["Alex"], "paused people and yourself aren't listed");

  const sent = store.share(m.token, [a.id, l.id, m.id], story(), "  Thought you'd like this   ");
  assert.deepEqual(sent.recipients.map((r) => r.name), ["Alex"]);
  assert.equal(sent.story.image, "", "unsafe image links are dropped");
  assert.equal(sent.story.extra, undefined);
  assert.equal(sent.note, "Thought you'd like this");

  const box = store.inbox(a.token);
  assert.equal(box.length, 1);
  assert.equal(box[0].from, "Martin");
  assert.equal(box[0].story.title, "Story 1");
  store.ack(a.token, [box[0].id]);
  assert.equal(store.inbox(a.token).length, 0, "delivered once");

  assert.throws(() => store.share(m.token, [a.id], { ...story(), link: "https://evil.example/x" }), /news sources/);
  assert.throws(() => store.share(m.token, [], story()), /at least one/);
  for (let i = 0; i < 19; i++) store.share(m.token, [a.id], story(i + 2));
  assert.throws(() => store.share(m.token, [a.id], story(99)), /20 stories a day/);
});

test("likes: counts are others-only and anonymous; clear and unlike work", () => {
  const { store, tick } = makeStore();
  const [m, a, b] = ["Martin", "Alex", "Bea"].map((name) => store.create({ name }));
  store.like(a.token, "st1", true);
  store.like(b.token, "st1", true);
  store.like(b.token, "st1", true); // no double count
  store.like(m.token, "st1", true);
  store.like(a.token, "st2", true);
  assert.deepEqual(store.likeCounts(m.token, ["st1", "st2", "st3"]), { st1: 2, st2: 1 });
  assert.deepEqual(store.likeCounts(a.token, ["st1"]), { st1: 2 }, "your own like isn't counted");
  store.like(b.token, "st1", false);
  store.clearLikes(a.token);
  assert.deepEqual(store.likeCounts(m.token, ["st1", "st2"]), {});
  store.like(a.token, "st4", true);
  tick(8 * 24 * 60 * 60 * 1000);
  assert.deepEqual(store.likeCounts(m.token, ["st4"]), {}, "likes older than a week don't count");
});

test("people can set their own topics", () => {
  const { store } = makeStore();
  const a = store.create({ name: "Sophia" });
  assert.deepEqual(store.setMyTopics(a.token, ["bio", "med", "nope"]), ["bio", "med"]);
  assert.deepEqual(store.auth(a.token).topics, ["bio", "med"]);
});
