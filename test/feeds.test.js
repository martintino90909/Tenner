import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFeed, truncate } from "../lib/rss.js";
import { buildPool, pickDeck, quotas, londonDate } from "../lib/pick.js";

const read = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-21T15:00:00Z");

test("parses RSS items with CDATA, entities and media thumbnails", () => {
  const items = parseFeed(read("bbc.xml"), { name: "BBC Technology", topic: "tech" });
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "Battery start-up says cell lasts 1,000 charges");
  assert.equal(items[0].summary, "A UK firm says its solid-state cell kept 90% of its capacity & more.");
  assert.equal(items[0].image, "https://ichef.bbci.co.uk/img1.jpg");
  assert.equal(items[0].link, "https://www.bbc.co.uk/news/articles/abc123");
  assert.ok(items[0].published);
});

test("parses Atom entries, HTML summaries and inline images", () => {
  const items = parseFeed(read("verge.xml"), { name: "The Verge", topic: "tech" });
  assert.equal(items.length, 2);
  assert.equal(items[0].link, "https://www.theverge.com/2026/10/21/battery");
  assert.equal(items[0].summary, "Solid-state batteries are getting closer — maybe.");
  assert.equal(items[1].image, "https://cdn.vox.com/chip.jpg");
});

test("pool drops videos, stale stories and cross-outlet duplicates", () => {
  const items = [
    ...parseFeed(read("bbc.xml"), { name: "BBC Technology", topic: "tech" }),
    ...parseFeed(read("verge.xml"), { name: "The Verge", topic: "tech" }),
  ];
  const pool = buildPool(items, NOW);
  const titles = pool.map((p) => p.title);
  assert.ok(!titles.some((t) => t.startsWith("Watch")), "video removed");
  assert.ok(!titles.includes("Old story from last week"), "stale removed");
  assert.equal(titles.filter((t) => /battery/i.test(t)).length, 1, "duplicate merged");
  assert.equal(pool.find((p) => /battery/i.test(p.title)).image, "https://ichef.bbci.co.uk/img1.jpg", "kept the version with an image");
});

test("daily quotas add up to 10 and rotate", () => {
  for (const d of ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]) {
    const q = quotas(d);
    assert.equal(Object.values(q).reduce((a, b) => a + b, 0), 10);
  }
  assert.notDeepEqual(quotas("2026-10-21"), quotas("2026-10-22"));
});

test("deck is 10 balanced, interleaved stories with at most 3 per source", () => {
  const pool = [];
  const topics = ["tech", "biz", "cars", "world"];
  for (const t of topics) for (let i = 0; i < 8; i++) {
    pool.push({ id: `${t}${i}`, topic: t, source: `${t}-src-${i % 2}`, title: `${t} ${i}`, published: NOW - i * 1000 });
  }
  const deck = pickDeck(pool, "2026-10-21");
  assert.equal(deck.length, 10);
  const q = quotas("2026-10-21");
  for (const t of topics) assert.equal(deck.filter((d) => d.topic === t).length, q[t]);
  for (let i = 1; i < deck.length; i++) assert.ok(deck[i].topic !== deck[i - 1].topic || i >= 8);
  const perSource = {};
  deck.forEach((d) => (perSource[d.source] = (perSource[d.source] || 0) + 1));
  assert.ok(Math.max(...Object.values(perSource)) <= 3);
});

test("deck fills from other topics when a feed is down", () => {
  const pool = [];
  for (const t of ["tech", "biz"]) for (let i = 0; i < 8; i++) {
    pool.push({ id: `${t}${i}`, topic: t, source: `${t}-src-${i % 4}`, title: `${t} ${i}`, published: NOW });
  }
  assert.equal(pickDeck(pool, "2026-10-21").length, 10);
});

test("helpers", () => {
  assert.equal(londonDate(new Date("2026-10-21T23:30:00Z")), "2026-10-22");
  assert.ok(truncate("word ".repeat(100), 50).length <= 51);
});

test("letters and opinion pieces are skipped", () => {
  const base = { topic: "biz", source: "Guardian Business", summary: "", image: "", published: NOW };
  const pool = buildPool([
    { ...base, id: "a", title: "A plan to ensure energy is affordable for all | Letters", link: "https://www.theguardian.com/business/2026/oct/21/letters" },
    { ...base, id: "b", title: "Why the budget gets it wrong", link: "https://www.theguardian.com/commentisfree/2026/oct/21/budget" },
    { ...base, id: "c", title: "Energy firms cut prices for winter", link: "https://www.theguardian.com/business/2026/oct/21/energy" },
  ], NOW);
  assert.deepEqual(pool.map((p) => p.id), ["c"]);
});
