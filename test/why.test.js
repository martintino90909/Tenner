import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWhy, cleanWhy, MODEL } from "../src/why.js";

const req = (body) => new Request("https://tenner.test/api/why", { method: "POST", body: JSON.stringify(body) });

test("returns a cleaned one-line answer from the model", async () => {
  let seen;
  const env = { AI: { run: async (model, input) => { seen = { model, input }; return { response: '"Why it matters: Cheaper cells could cut EV prices.\nExtra line"' }; } } };
  const res = await handleWhy(req({ title: "Battery breakthrough", summary: "A cell lasted 1,000 charges.", source: "BBC" }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { why: "Cheaper cells could cut EV prices." });
  assert.equal(seen.model, MODEL);
  assert.match(seen.input.messages[1].content, /Headline: Battery breakthrough/);
});

test("reports errors instead of throwing", async () => {
  const env = { AI: { run: async () => { throw new Error("daily limit reached"); } } };
  const res = await handleWhy(req({ title: "x" }), env);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /daily limit/);
  assert.equal((await handleWhy(req({}), env)).status, 400);
  assert.equal((await handleWhy(req({ title: "x" }), {})).status, 503);
});

test("cleanWhy trims long answers", () => {
  assert.ok(cleanWhy("word ".repeat(80)).length <= 241);
});
