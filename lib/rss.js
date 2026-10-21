// Small RSS 2.0 / Atom parser. Workers have no DOMParser, so this reads the
// handful of fields Tenner needs with regular expressions.

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", pound: "£",
  euro: "€", eacute: "é", trade: "™", copy: "©",
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const unCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

export function stripHtml(s) {
  let html = unCdata(s);
  // Some feeds (Atom especially) escape their HTML, so unescape it before stripping tags.
  if (/&lt;[a-z\/!]/i.test(html)) html = decodeEntities(html);
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  return m ? unCdata(m[1]).trim() : "";
}

function attr(block, tagName, attrName, filter) {
  const re = new RegExp(`<${tagName}\\b([^>]*)>`, "gi");
  let m;
  while ((m = re.exec(block))) {
    const attrs = m[1];
    if (filter && !filter(attrs)) continue;
    const a = attrs.match(new RegExp(`\\b${attrName}\\s*=\\s*["']([^"']+)["']`, "i"));
    if (a) return decodeEntities(a[1]);
  }
  return "";
}

export function truncate(s, max = 260) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return cut.slice(0, at > max * 0.6 ? at : max).replace(/[,;:.\s]+$/, "") + "…";
}

// FNV-1a hash, used for stable story ids.
export function hashId(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function findImage(block, rawContent) {
  const isImage = (a) => !/\btype\s*=/i.test(a) || /type\s*=\s*["']image\//i.test(a) || /medium\s*=\s*["']image/i.test(a);
  return (
    attr(block, "media:thumbnail", "url") ||
    attr(block, "media:content", "url", isImage) ||
    attr(block, "enclosure", "url", (a) => /type\s*=\s*["']image\//i.test(a)) ||
    (rawContent.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i) || [])[1] ||
    ""
  );
}

export function parseFeed(xml, source) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];

  return blocks
    .map((b) => {
      const title = stripHtml(tag(b, "title"));
      let link = isAtom
        ? attr(b, "link", "href", (a) => !/rel\s*=/i.test(a) || /rel\s*=\s*["']alternate["']/i.test(a))
        : decodeEntities(tag(b, "link"));
      if (!link) link = decodeEntities(tag(b, "guid"));
      const rawContent = tag(b, "content:encoded") || tag(b, "content");
      const rawSummary = tag(b, "description") || tag(b, "summary") || rawContent;
      const summary = truncate(stripHtml(rawSummary));
      const dateStr = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
      const published = Date.parse(dateStr) || null;
      const image = findImage(b, decodeEntities(rawContent + rawSummary));
      return {
        id: hashId(link || title),
        title,
        link: link.trim(),
        summary,
        image: /^https?:\/\//.test(image) ? image : "",
        published,
        source: source.name,
        topic: source.topic,
      };
    })
    .filter((it) => it.title && /^https?:\/\//.test(it.link));
}
