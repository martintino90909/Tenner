// Runs the /api/today handler with fake feeds, so it can be tested without the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOURCES } from "../lib/sources.js";

const bbc = readFileSync(new URL("./fixtures/bbc.xml", import.meta.url), "utf8");
const verge = readFileSync(new URL("./fixtures/verge.xml", import.meta.url), "utf8");

test("handler returns a deck and reports failing feeds in debug mode", async () => {
  // Make the fixture dates count as fresh.
  const now = new Date().toUTCString();
  const iso = new Date().toISOString();
  const fresh = bbc.replace(/Wed, 21 Oct 2026 0\d:00:00 GMT/g, now);
  const freshAtom = verge.replace(/2026-10-21T0\d:00:00(-04:00|Z)/g, iso);

  globalThis.fetch = async (url) => {
    if (url.includes("theverge")) return new Response(freshAtom);
    if (url.includes("bbci")) return new Response(fresh.replaceAll("abc123", "abc" + url.length));
    return new Response("nope", { status: 404 });
  };
  const { onRequestGet } = await import("../functions/api/today.js");
  const res = await onRequestGet({ request: new Request("https://tenner.test/api/today?debug=1"), waitUntil: () => {} });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.deck.length >= 1);
  assert.equal(body.feeds.length, SOURCES.length);
  assert.ok(body.feeds.some((f) => !f.ok && f.error === "HTTP 404"));
  assert.ok(body.feeds.find((f) => f.name === "The Verge").ok);
  for (const s of body.deck) {
    assert.ok(s.id && s.title && s.link && s.topic && s.source);
  }
});
