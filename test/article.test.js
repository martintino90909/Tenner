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

test("drops related headlines, affiliate notes and author bios at the end", () => {
  const p = (t) => `<p>${t}</p>`;
  const body = [
    "Mercedes driver George Russell said he was searching for answers after a difficult weekend in Austin, Texas.",
    "He qualified sixth and finished fifth, well behind his team-mate, who took pole position and the race win.",
    "The team said it would study the data from the weekend before the next round in Mexico City.",
    "Russell added that the car had felt unpredictable on the bumpy surface throughout all three practice sessions.",
    "Mercedes now leads the constructors' championship by 41 points with three rounds of the season remaining.",
  ];
  const tail = [
    "When you purchase through links in our articles, we may earn a small commission.",
    "Anthony Ha is TechCrunch’s weekend editor. Previously, he worked as a tech reporter at Adweek.",
    "You can contact Anthony by emailing [email&#160;protected].",
    "Norris frustrated after qualifying: \"I did a very bad job\"",
    "Antonelli pole shows Mercedes is 'finally seeing the results' of car upgrades",
  ];
  const html = `<html><body><article>${body.map(p).join("")}${tail.map(p).join("")}<div>${"x".repeat(2000)}</div></article></body></html>`;
  const a = extractArticle(html);
  assert.equal(a.ok, true);
  assert.deepEqual(a.blocks.map((b) => b.text), body);
});

test("falls back to the whole page when the <article> region is cut short", () => {
  const paras = Array.from({ length: 8 }, (_, i) => `<div data-block="text"><p>Paragraph ${i + 1} of the story explains another part of what happened in some detail.</p></div>`).join("");
  const html = `<html><body><article><div>${"<span>x</span>".repeat(300)}</div><article><a href="/x">Card</a></article></article><main>${paras}</main></body></html>`;
  const a = extractArticle(html);
  assert.equal(a.ok, true);
  assert.equal(a.blocks.length, 8);
});

test("uses JSON-LD articleBody when the page markup has no readable paragraphs", () => {
  const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} describes the story in a full sentence.`).join(" ");
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "NewsArticle", articleBody: text }] })}</script></head><body><div id="app"></div></body></html>`;
  const a = extractArticle(html);
  assert.equal(a.ok, true);
  assert.equal(a.blocks.length, 4, "grouped into paragraphs of three sentences");
});

test("stays fast on a large page", () => {
  const filler = `<div class="x"><span>nav</span><a href="/y">link</a></div>`.repeat(6000);
  const story = Array.from({ length: 30 }, () => `<p>${"A sentence of body text that goes on for a while. ".repeat(3)}</p>`).join("");
  const html = `<html><body>${filler}<article>${story}</article>${filler}</body></html>`;
  extractArticle(html);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) extractArticle(html);
  const ms = (performance.now() - t0) / 5;
  assert.ok(html.length > 500_000);
  assert.ok(ms < 25, `took ${ms.toFixed(1)}ms`);
  console.log(`# ${Math.round(html.length / 1000)}KB page: ${ms.toFixed(1)}ms`);
});

test("drops site promos and single-name author bios at the end", () => {
  const body = Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i + 1} describes the new car and how it drives on British roads in detail.</p>`).join("");
  const tail = `<p>Did you know you can sell your car through Auto Express? We’ll help you get a great price.</p><p>Phil is Auto Express’ editor-at-large: he keeps close to car companies, finding stories.</p>`;
  const a = extractArticle(`<html><body><article>${body}${tail}<div>${"x".repeat(2000)}</div></article></body></html>`);
  assert.equal(a.blocks.length, 6);
});
