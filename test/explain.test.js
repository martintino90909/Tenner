import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTerms, cleanExplanation, MAX_TERMS } from "../lib/explain.js";

const article = `Researchers used CRISPR base editing to correct the mutation in mice. The treatment, an antisense oligonucleotide,
was given by lumbar puncture. NICE will appraise the drug next year. The FTSE 100 rose 1%.`;

test("parses term :: explanation lines and keeps only terms in the article", () => {
  const raw = `Here are the terms:
1. CRISPR base editing :: a precise gene-editing method that changes single DNA letters without cutting both strands
- **antisense oligonucleotide** :: a short synthetic strand of genetic material that blocks a faulty gene's message.
lumbar puncture :: "a procedure that draws fluid from the lower spine with a needle"
Quantum tunnelling :: not in the article so it must be dropped
NICE :: the body that decides which treatments the NHS in England should fund
CRISPR base editing :: duplicate should be ignored`;
  const terms = parseTerms(raw, article);
  assert.deepEqual(terms.map((t) => t.term), ["CRISPR base editing", "antisense oligonucleotide", "lumbar puncture", "NICE"]);
  assert.equal(terms[0].explanation, "A precise gene-editing method that changes single DNA letters without cutting both strands.");
  assert.equal(terms[2].explanation, "A procedure that draws fluid from the lower spine with a needle.");
});

test("caps the number of terms and trims long explanations", () => {
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
  const text = words.join(" ");
  const raw = words.map((w) => `${w} :: ${"very long explanation ".repeat(20)}`).join("\n");
  const terms = parseTerms(raw, text);
  assert.equal(terms.length, MAX_TERMS);
  assert.ok(terms.every((t) => t.explanation.length <= 222));
});

test("NONE or junk gives no terms", () => {
  assert.deepEqual(parseTerms("NONE", article), []);
  assert.deepEqual(parseTerms("Sorry, I can't help with that.", article), []);
});

test("explanations are one tidy sentence", () => {
  assert.equal(cleanExplanation('Explanation: "the main UK share index of the 100 biggest listed companies"\nExtra line'), "The main UK share index of the 100 biggest listed companies.");
  assert.equal(cleanExplanation(""), "");
});
