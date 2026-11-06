// Prompts and parsing for "Explain this". Kept free of Worker APIs so it can
// be tested in Node.

export const MAX_TERMS = 6;

export const TERMS_SYSTEM = `You help readers of a UK news app understand jargon.
From the article, pick up to ${MAX_TERMS} technical terms, acronyms or specialist phrases that a curious non-specialist might not know: medical, scientific, financial, legal, engineering, technology or motorsport terms.
Skip names of people, places and companies, and everyday words.
For each, write a plain-English explanation in one sentence of at most 22 words, in the sense used in the article. Explain the term itself; don't add facts about the story.
Output one per line, exactly in the form: term :: explanation
Copy each term exactly as it is written in the article. If there are no such terms, output NONE.`;

export const EXPLAIN_SYSTEM = `You explain words and phrases for readers of a UK news app.
Explain the phrase in plain British English in one sentence of at most 30 words, in the sense it's used in the passage.
If it's a name or an everyday phrase, say briefly what it refers to here.
Don't add facts about the story beyond what the passage says. No preamble, no quotation marks.`;

const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

function tidy(explanation) {
  let e = squash(explanation).replace(/^["'“‘*]+|["'”’*]+$/g, "").trim();
  if (e.length > 220) e = e.slice(0, 220).replace(/\s+\S*$/, "") + "…";
  if (e && !/[.!?…]$/.test(e)) e += ".";
  return e ? e[0].toUpperCase() + e.slice(1) : e;
}

/**
 * Parses "term :: explanation" lines. Keeps only terms that really appear in
 * the article text (so they can be underlined), at most MAX_TERMS, no repeats.
 */
export function parseTerms(raw, articleText) {
  const text = String(articleText || "").toLowerCase();
  const out = [];
  const seen = new Set();
  for (const line of String(raw || "").split(/\n+/)) {
    const m = line.match(/^\s*(?:[-*•\d.)]+\s*)?\**([^:]{2,60}?)\**\s*::\s*(.+)$/);
    if (!m) continue;
    const term = squash(m[1]).replace(/^["'“‘]|["'”’]$/g, "");
    const key = term.toLowerCase();
    if (term.length < 2 || seen.has(key) || !text.includes(key)) continue;
    const explanation = tidy(m[2]);
    if (!explanation) continue;
    seen.add(key);
    out.push({ term, explanation });
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

export function cleanExplanation(raw) {
  let s = squash(String(raw || "").split(/\n/)[0]);
  s = s.replace(/^(explanation|answer)\s*[:\-–—]\s*/i, "");
  return tidy(s);
}

export const termsPrompt = (title, text) => `Headline: ${squash(title).slice(0, 300)}\n\nArticle:\n${String(text || "").slice(0, 6000)}`;
export const explainPrompt = (phrase, passage, title) =>
  `Headline: ${squash(title).slice(0, 300)}\nPassage: ${squash(passage).slice(0, 1200)}\nPhrase to explain: ${squash(phrase).slice(0, 80)}`;
