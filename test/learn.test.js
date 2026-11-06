import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProfile, personalise, scoreStory, keywords, highlights, COLD_START } from "../public/learn.js";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const DAY = 86400000;
let n = 0;
const ev = (kind, topic, source, title, ago = 0, extra = {}) => ({ id: extra.id || `s${n++}`, topic, source, kind, t: NOW - ago, kw: keywords(title), ...extra });

test("keywords drop filler words and numbers", () => {
  assert.deepEqual(keywords("Verstappen wins the Mexico City Grand Prix in 2026"), ["verstappen", "wins", "mexico", "city", "grand", "prix"]);
});

test("likes, saves and opens raise scores; skips lower them; old actions fade", () => {
  const log = [
    ev("like", "cars", "Autosport", "Verstappen takes pole in Mexico"),
    ev("save", "cars", "Autosport", "Verstappen takes pole in Mexico"),
    ev("skip", "biz", "CNBC", "Bank shares slide on rate fears"),
    ev("skip", "biz", "CNBC", "Bank shares slide on rate fears", 100 * DAY),
  ];
  const p = buildProfile(log, { now: NOW });
  assert.ok(p.topic.cars > 3.9 && p.topic.cars <= 4);
  assert.ok(p.topic.biz < -1 && p.topic.biz > -1.2, "100-day-old skip counts for ~13%");
  assert.ok(p.kw.verstappen > 0 && p.kw.bank < 0);
  assert.equal(p.decisions, 3);
});

test("undo cancels a swipe; unsave cancels a save; long reads add a bonus", () => {
  const a = ev("like", "tech", "BBC", "Chip makers race ahead", 0, { id: "a" });
  const p1 = buildProfile([a, { ...a, kind: "undo" }, { ...a, kind: "skip" }], { now: NOW });
  assert.equal(p1.topic.tech, -1);
  const p2 = buildProfile([{ ...a, kind: "save" }, { ...a, kind: "unsave" }], { now: NOW });
  assert.equal(p2.topic.tech || 0, 0);
  const p3 = buildProfile([{ ...a, kind: "open" }, { ...a, kind: "close", ms: 45000 }], { now: NOW });
  assert.equal(p3.topic.tech, 3);
  const p4 = buildProfile([{ ...a, kind: "open" }, { ...a, kind: "close", ms: 4000, depth: 0.1 }], { now: NOW });
  assert.equal(p4.topic.tech, 2, "a quick open-and-close gets no read bonus");
});

function poolOf() {
  const pool = [];
  const titles = {
    cars: ["Verstappen wins in Mexico", "Ferrari reveals new hypercar", "Hamilton targets podium", "Electric hot hatch tested", "McLaren upgrade explained", "Norris on pole in Brazil"],
    tech: ["New phone chip unveiled", "Robot vacuums get smarter", "Satellite internet expands", "Laptop review roundup", "Battery breakthrough claimed", "Quantum computer milestone"],
    biz: ["Bank shares slide", "Retail sales fall", "Pound edges higher", "Mortgage deals cut", "Oil price climbs", "Startup raises funds"],
    world: ["Election called early", "Storm hits coast", "Summit ends in deal", "Rail strike planned", "Museum reopens", "Flood defences opened"],
  };
  for (const [topic, list] of Object.entries(titles)) list.forEach((title, i) => pool.push({ id: `${topic}${i}`, topic, source: `${topic}-${i % 3}`, title, published: NOW - i * 3600000 }));
  return pool;
}

test("cold start uses the server's even split", () => {
  const p = buildProfile([ev("like", "cars", "x", "a")], { now: NOW });
  const fallback = poolOf().slice(0, 10);
  const r = personalise({ pool: poolOf(), fallback, profile: p, topics: ["tech", "biz", "cars", "world"], now: NOW });
  assert.equal(r.personalised, false);
  assert.deepEqual(r.cards.map((c) => c.id), fallback.map((c) => c.id));
});

test("a car fan gets mostly cars, capped at 4, plus 2 wildcards from disliked topics", () => {
  const log = [];
  for (let i = 0; i < 12; i++) log.push(ev("like", "cars", `cars-${i % 3}`, ["Verstappen pole lap", "Ferrari hypercar", "McLaren upgrade"][i % 3]));
  for (let i = 0; i < 8; i++) log.push(ev("skip", "biz", `biz-${i % 3}`, "Bank shares slide again"));
  const p = buildProfile(log, { now: NOW });
  assert.ok(p.decisions >= COLD_START);
  const r = personalise({ pool: poolOf(), profile: p, topics: ["tech", "biz", "cars", "world"], now: NOW });
  assert.equal(r.personalised, true);
  assert.equal(r.cards.length, 10);
  assert.equal(r.cards.filter((c) => c.topic === "cars").length, 4);
  assert.equal(r.wildcards.length, 2);
  assert.ok(r.cards.slice(0, 3).every((c) => c.topic === "cars"), "best matches first");
  assert.ok(r.wildcards.some((id) => id.startsWith("biz")), "the least-liked topic still appears as a wildcard");
  assert.equal(new Set(r.cards.map((c) => c.id)).size, 10, "no repeats");
});

test("muted topics never appear; 'more' lifts a topic", () => {
  const log = Array.from({ length: 16 }, (_, i) => ev(i % 2 ? "like" : "skip", "world", "w", "Storm hits coast"));
  const p = buildProfile(log, { now: NOW });
  const r = personalise({ pool: poolOf(), profile: p, adjust: { biz: "mute" }, topics: ["tech", "biz", "cars", "world"], now: NOW });
  assert.ok(r.cards.every((c) => c.topic !== "biz"));
  const tech = poolOf().find((s) => s.topic === "tech");
  assert.ok(scoreStory(tech, p, { tech: "more" }, NOW) > scoreStory(tech, p, {}, NOW) + 2.9);
});

test("a single-topic reader still gets a full ten", () => {
  const log = Array.from({ length: 16 }, () => ev("like", "cars", "c", "Verstappen wins"));
  const p = buildProfile(log, { now: NOW });
  const r = personalise({ pool: poolOf(), profile: p, topics: ["cars"], now: NOW });
  assert.equal(r.cards.length, 6, "only six car stories exist in this pool");
  assert.ok(r.cards.every((c) => c.topic === "cars"));
});

test("highlights list liked and avoided keywords", () => {
  const log = [...Array(3)].map(() => ev("save", "cars", "Autosport", "Verstappen pole")).concat(ev("skip", "biz", "CNBC", "Bank shares"));
  const h = highlights(buildProfile(log, { now: NOW }));
  assert.equal(h.liked[0][0], "verstappen");
  assert.ok(h.avoided.some(([k]) => k === "bank"));
  assert.equal(h.sources[0][0], "Autosport");
});

test("listening to most of a story counts like a long read", () => {
  const a = { id: "z", topic: "med", source: "BBC Health", kw: ["vaccine"], t: NOW };
  assert.equal(buildProfile([{ ...a, kind: "open" }, { ...a, kind: "listen", ms: 95000, done: 0.8 }], { now: NOW }).topic.med, 3);
  assert.equal(buildProfile([{ ...a, kind: "open" }, { ...a, kind: "listen", ms: 5000, done: 0.1 }], { now: NOW }).topic.med, 2);
});

test("sending a story to a friend counts like saving it", () => {
  const a = { id: "q", topic: "bio", source: "STAT Biotech", kw: ["crispr"], t: NOW };
  assert.equal(buildProfile([{ ...a, kind: "share" }], { now: NOW }).topic.bio, 3);
});
