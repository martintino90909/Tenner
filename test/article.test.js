import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractArticle, isAllowed } from "../lib/article.js";
import { ARTICLE_SITES } from "../lib/sources.js";

const read = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

test("extracts body paragraphs and subheadings, in order, without page furniture", () => {
  const a = extractArticle(read("bbc-article.html"));
  assert.equal(a.ok, true);
  const texts = a.blocks.map((b) => b.text);
  assert.equal(a.blocks.length, 6);
  assert.match(texts[0], /^The Bank of England has held/);
  assert.deepEqual(a.blocks[2], { type: "h", text: "What it means for mortgages" });
  assert.match(texts[1], /“more evidence”/, "entities decoded");
  for (const junk of [/Faisal Islam/, /Getty/, /Image caption/, /Seven things/, /Mortgage rates fall/, /Copyright/, /not this/, /Home/]) {
    assert.ok(!texts.some((t) => junk.test(t)), `should drop ${junk}`);
  }
  assert.ok(a.minutes >= 1 && a.words > 80);
});

test("paywalled teasers are reported as not readable", () => {
  assert.equal(extractArticle(read("paywall.html")).ok, false);
});

test("running twice gives the same result (no leftover regex state)", () => {
  const html = read("bbc-article.html");
  assert.deepEqual(extractArticle(html), extractArticle(html));
});

test("only Tenner's news sites are allowed", () => {
  assert.ok(isAllowed("https://www.bbc.co.uk/news/articles/abc", ARTICLE_SITES));
  assert.ok(isAllowed("https://www.theguardian.com/world/2026/oct/26/x", ARTICLE_SITES));
  assert.ok(!isAllowed("https://evil-bbc.co.uk/x", ARTICLE_SITES));
  assert.ok(!isAllowed("https://bbc.co.uk.evil.com/x", ARTICLE_SITES));
  assert.ok(!isAllowed("file:///etc/passwd", ARTICLE_SITES));
  assert.ok(!isAllowed("not a url", ARTICLE_SITES));
});
