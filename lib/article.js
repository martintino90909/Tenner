// Pulls the readable body text out of a news article page.
// Workers have no DOM, and the free plan allows ~10ms of CPU per request,
// so this uses a cheap regex pass instead of a full HTML parser:
//   1. narrow the page to the article region
//   2. drop blocks that are never body text (scripts, figures, asides, nav...)
//   3. keep paragraphs, subheadings, quotes and list items, in order
//   4. filter out boilerplate lines

import { decodeEntities } from "./rss.js";

const MIN_CHARS = 500;

// Regions most news sites wrap their body text in, best first.
const REGION_PATTERNS = [
  /<div[^>]+data-component=["']text-block["'][\s\S]*/i, // BBC: start of first text block
  /<div[^>]+data-block=["']text["'][\s\S]*/i, // BBC (newer layout)
  /<div[^>]+(?:id|class)=["'][^"']*(?:article-body|articleBody|ArticleBody|article__body|post-content|entry-content|story-body|article-content|c-entry-content|duet--article--article-body)[^"']*["'][\s\S]*/i,
  /<article[\s>][\s\S]*?<\/article>/i,
  /<main[\s>][\s\S]*?<\/main>/i,
];

const DROP_BLOCKS = /<(script|style|noscript|svg|figure|figcaption|aside|nav|footer|header|form|button|select|template|iframe|video|audio|picture)\b[\s\S]*?<\/\1>/gi;
const DROP_BY_ATTR = /<(div|section|ul|ol|span|p)\b[^>]*(?:class|id|data-component|aria-label)=["'][^"']*(?:related|newsletter|promo|share|social|byline|caption|advert|ad-slot|subscribe|signup|sign-up|most-read|recommend|links-block|tags|comments|author-bio|inline-image|image-block|media-block|video-block)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK = /<(p|h2|h3|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;

const JUNK = [
  /^(image|video|media) (source|caption)/i,
  /^(getty images|reuters|pa media|ap|afp|shutterstock|epa)$/i,
  /^(follow|sign up|subscribe|download|get the|listen to|watch|read more|related|share this|advertisement|copyright|©)/i,
  /\b(cookies?|newsletter|privacy policy|terms of (use|service)|all rights reserved)\b/i,
  /^(skip to|jump to|back to top)/i,
  /^when you (purchase|buy) (something )?through (links|our links)/i,
  /\[email(&#160;|\s)protected\]|email protected\]/i,
  // Author bios, e.g. "Jane Smith is TechCrunch's weekend editor."
  /^[A-Z][\w'’-]+(?: [A-Z][\w'’-]+){1,3} is (?:a|an|the|[\w]+['’]s)\b[^.]{0,80}\b(?:reporter|editor|correspondent|writer|journalist|columnist)\b/,
];

// Headings that mark the end of the story and the start of page furniture.
const STOP_HEADING = /^(related|more on this|more from|most (read|popular|viewed)|top stories|you (may|might) also|recommended|latest|read next|trending|explore more|elsewhere on|comments?|about (the|this) author|share this)/i;

// A block that is nothing but a link is a headline list, not body text.
const LINK_ONLY = /^\s*<a\b[^>]*>[\s\S]*<\/a>\s*$/i;

function textOf(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function regions(html) {
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, "");
  const out = [];
  for (let i = 0; i < REGION_PATTERNS.length; i++) {
    const m = body.match(REGION_PATTERNS[i]);
    if (m && m[0].length > 2000) out.push({ html: m[0], pattern: i });
  }
  out.push({ html: body, pattern: -1 });
  return out;
}

// Lines that only show up at the end of a story: author bios and site promos.
const TAIL_JUNK = [
  /^[A-Z][\w'’-]+(?: [A-Z][\w'’-]+){0,3} is (?:a |an |the |[\w ]+['’]s? )?[^.]{0,60}\b(?:reporter|editor|editor-at-large|correspondent|writer|journalist|columnist|presenter)\b/,
  /^did you know you can\b/i,
  /\b(sell your car|sign up to our|subscribe to our|follow us on|download the app)\b/i,
];
const isTailJunk = (b) => TAIL_JUNK.some((re) => re.test(b.text));

const isHeadlineLike = (b) => b.type === "h" || (b.text.length < 160 && !/[.!?…]["”’']?\)?$/.test(b.text));
const countChars = (blocks) => blocks.reduce((n, b) => (b.type === "h" ? n : n + b.text.length), 0);

function blocksFrom(regionHtml) {
  const area = regionHtml.replace(DROP_BLOCKS, " ").replace(DROP_BY_ATTR, " ");
  const blocks = [];
  const seen = new Set();
  let m;
  BLOCK.lastIndex = 0;
  while ((m = BLOCK.exec(area))) {
    const tag = m[1].toLowerCase();
    const text = textOf(m[2]);
    if (!text || seen.has(text)) continue;
    if ((tag === "h2" || tag === "h3") && STOP_HEADING.test(text) && blocks.length > 2) break;
    if ((tag === "li" || tag === "p") && LINK_ONLY.test(m[2]) && !/<\/a>[^<]*\S/.test(m[2])) continue;
    if (JUNK.some((re) => re.test(text))) continue;
    const isHeading = tag === "h2" || tag === "h3";
    if (isHeading && (text.length > 120 || text.length < 3)) continue;
    // Short lines without sentence punctuation are usually labels, not prose.
    if (!isHeading && text.length < 40 && !/[.!?:"”]$/.test(text)) continue;
    if (tag === "li" && text.length < 25) continue;
    seen.add(text);
    blocks.push({ type: isHeading ? "h" : tag === "blockquote" ? "q" : tag === "li" ? "li" : "p", text });
  }
  // Trim the tail: headings with nothing after them, and runs of short lines
  // without sentence punctuation (related-story headlines that slipped through).
  while (blocks.length > 3 && (isHeadlineLike(blocks[blocks.length - 1]) || isTailJunk(blocks[blocks.length - 1]))) blocks.pop();
  return { blocks, chars: countChars(blocks), area };
}

// Many sites embed the article text for search engines as JSON-LD "articleBody".
function ldBlocks(html) {
  const scripts = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
  let best = "";
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.articleBody === "string" && node.articleBody.length > best.length) best = node.articleBody;
    if (node["@graph"]) visit(node["@graph"]);
  };
  for (const sc of scripts) {
    try { visit(JSON.parse(sc.replace(/^<script[^>]*>|<\/script>$/gi, ""))); } catch {}
  }
  if (!best) return { blocks: [], chars: 0 };
  let text = decodeEntities(best.replace(/<[^>]+>/g, " ")).replace(/\r/g, "");
  let paras = text.split(/\n+/).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (paras.length === 1 && paras[0].length > 600) {
    // No line breaks: group sentences into readable paragraphs of about three.
    const sentences = paras[0].split(/(?<=[.!?]["”’]?)\s+(?=[A-Z“"‘'])/);
    paras = [];
    for (let i = 0; i < sentences.length; i += 3) paras.push(sentences.slice(i, i + 3).join(" "));
  }
  const blocks = paras.filter((t) => !JUNK.some((re) => re.test(t))).map((text) => ({ type: "p", text }));
  return { blocks, chars: countChars(blocks) };
}

export function extractArticle(html, { debug = false } = {}) {
  const src = String(html || "");
  const tried = [];
  let best = { blocks: [], chars: 0, pattern: null };
  for (const r of regions(src)) {
    const res = blocksFrom(r.html);
    tried.push({ pattern: r.pattern, chars: res.chars, blocks: res.blocks.length });
    if (res.chars > best.chars) best = { ...res, pattern: r.pattern };
    if (res.chars >= MIN_CHARS) break;
  }
  const ld = ldBlocks(src);
  const useLd = ld.chars >= MIN_CHARS && (best.chars < MIN_CHARS || ld.chars > best.chars * 1.3);
  const blocks = useLd ? ld.blocks : best.blocks;
  const chars = useLd ? ld.chars : best.chars;

  const words = blocks.reduce((n, b) => n + b.text.split(" ").length, 0);
  const result = { ok: chars >= MIN_CHARS, blocks, words, minutes: Math.max(1, Math.round(words / 230)) };
  if (debug) {
    result.debug = {
      htmlLength: src.length,
      used: useLd ? "ld+json" : `region ${best.pattern}`,
      tried,
      ldChars: ld.chars,
      pTagsInPage: (src.match(/<p[\s>]/gi) || []).length,
    };
  }
  return result;
}

// Only fetch pages from the outlets Tenner already uses, so the endpoint
// can't be used to load arbitrary websites.
export function isAllowed(url, sites) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return sites.some((s) => host === s || host.endsWith("." + s));
}
