import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk, pickVoice } from "../public/listen.js";

test("short paragraphs stay whole; long ones split on sentence ends", () => {
  assert.deepEqual(chunk("One short paragraph."), ["One short paragraph."]);
  assert.deepEqual(chunk("   "), []);
  const long = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} tells a bit more of the story here.`).join(" ");
  const parts = chunk(long, 120);
  assert.ok(parts.length >= 4);
  assert.ok(parts.every((p) => p.length <= 120 && /\.$/.test(p)), "every chunk ends at a full stop");
  assert.equal(parts.join(" "), long, "nothing lost");
});

test("prefers an enhanced British voice and avoids novelty voices", () => {
  const voices = [
    { name: "Samantha", lang: "en-US", localService: true },
    { name: "Bubbles", lang: "en-GB", localService: true },
    { name: "Daniel", lang: "en-GB", localService: true },
    { name: "Daniel (Enhanced)", lang: "en-GB", localService: true },
    { name: "Thomas", lang: "fr-FR", localService: true },
  ];
  assert.equal(pickVoice(voices).name, "Daniel (Enhanced)");
  assert.equal(pickVoice(voices.slice(0, 3)).name, "Daniel");
  assert.equal(pickVoice([]), null);
});
