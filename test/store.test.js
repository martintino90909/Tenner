import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Store, cleanTopics } from "../lib/store.js";
import { quotas, pickDeck, TOPIC_KEYS } from "../lib/pick.js";

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
  assert.deepEqual(a.topics, TOPIC_KEYS);
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

test("topics are cleaned and default to all four", () => {
  assert.deepEqual(cleanTopics(["cars", "nonsense", "cars"]), ["cars"]);
  assert.deepEqual(cleanTopics([]), TOPIC_KEYS);
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
