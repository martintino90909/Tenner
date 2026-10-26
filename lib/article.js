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

function region(html) {
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, "");
  for (const re of REGION_PATTERNS) {
    const m = body.match(re);
    if (m && m[0].length > 2000) return m[0];
  }
  return body;
}

export function extractArticle(html) {
  const area = region(String(html || "")).replace(DROP_BLOCKS, " ").replace(DROP_BY_ATTR, " ");
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

  // Trim trailing headings with nothing after them (e.g. "More on this story").
  while (blocks.length && blocks[blocks.length - 1].type === "h") blocks.pop();

  const chars = blocks.reduce((n, b) => (b.type === "h" ? n : n + b.text.length), 0);
  const words = blocks.reduce((n, b) => n + b.text.split(" ").length, 0);
  return { ok: chars >= MIN_CHARS, blocks, words, minutes: Math.max(1, Math.round(words / 230)) };
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
