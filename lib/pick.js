// Turns raw feed items into a clean pool and a balanced daily ten.
// Phase 1 has no learning: the ten are split evenly across topics.

export const TOPIC_KEYS = ["tech", "biz", "cars", "world"];
const MAX_AGE_MS = 36 * 60 * 60 * 1000;
const POOL_PER_TOPIC = 15;
const MAX_PER_SOURCE_IN_DECK = 3;

const STOP = new Set(
  "the a an and or of to in on for with at by from as is are was were be been it its this that after over into new says say how why what who will can could than more not but about up out his her their they you your we our".split(" ")
);

export function words(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[‘’']/g, "")
      .replace(/[^a-z0-9£$%\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

// Skip things that don't work as a news card: live blogs, videos, galleries, quizzes.
// Opinion pieces and readers' letters are skipped too: Tenner is for news.
const JUNK_LINK = /\/(live|videos?|av|sounds|iplayer|gallery|galleries|picture|pictures|quiz|podcasts?|commentisfree)\//i;
const JUNK_TITLE = /^(watch|listen|live|in pictures|quiz|podcast)\b[:\s-]|\|\s*(letters?|letter of the day|editorial|opinion)\s*$/i;

export function buildPool(items, now = Date.now()) {
  const fresh = items.filter((it) => {
    if (JUNK_LINK.test(it.link) || JUNK_TITLE.test(it.title)) return false;
    if (it.published && (now - it.published > MAX_AGE_MS || it.published - now > 60 * 60 * 1000)) return false;
    return true;
  });

  // Prefer newer stories, then ones with an image and a real summary.
  const quality = (it) => (it.image ? 1 : 0) + (it.summary.length > 60 ? 1 : 0);
  fresh.sort((a, b) => (b.published || 0) - (a.published || 0) || quality(b) - quality(a));

  const kept = [];
  const seenIds = new Set();
  for (const it of fresh) {
    if (seenIds.has(it.id)) continue;
    const w = words(it.title);
    const dupe = kept.find((k) => similarity(k._w, w) >= 0.6);
    if (dupe) {
      // Same story from two outlets: keep whichever has more to show.
      if (quality(it) > quality(dupe)) Object.assign(dupe, it, { _w: w });
      continue;
    }
    seenIds.add(it.id);
    kept.push({ ...it, _w: w });
  }

  const pool = [];
  for (const t of TOPIC_KEYS) {
    pool.push(...kept.filter((k) => k.topic === t).slice(0, POOL_PER_TOPIC));
  }
  return pool.map(({ _w, ...rest }) => rest);
}

// 10 cards over 4 topics: two topics get 3, two get 2, rotating daily so it's fair.
export function quotas(dateStr) {
  const day = Math.floor(Date.parse(dateStr + "T12:00:00Z") / 86400000);
  const q = { tech: 2, biz: 2, cars: 2, world: 2 };
  q[TOPIC_KEYS[day % 4]]++;
  q[TOPIC_KEYS[(day + 2) % 4]]++;
  return q;
}

export function pickDeck(pool, dateStr, exclude = new Set(), size = 10) {
  const q = quotas(dateStr);
  const perSource = {};
  const byTopic = {};
  for (const t of TOPIC_KEYS) byTopic[t] = [];

  const take = (it) => {
    perSource[it.source] = (perSource[it.source] || 0) + 1;
    byTopic[it.topic].push(it);
  };
  const available = pool.filter((it) => !exclude.has(it.id));

  for (const t of TOPIC_KEYS) {
    for (const it of available.filter((x) => x.topic === t)) {
      if (byTopic[t].length >= q[t]) break;
      if ((perSource[it.source] || 0) >= MAX_PER_SOURCE_IN_DECK) continue;
      take(it);
    }
  }

  // If a topic ran short (a feed was down), fill from whatever is left.
  let count = TOPIC_KEYS.reduce((n, t) => n + byTopic[t].length, 0);
  const chosen = new Set(TOPIC_KEYS.flatMap((t) => byTopic[t].map((x) => x.id)));
  for (const it of available) {
    if (count >= size) break;
    if (chosen.has(it.id)) continue;
    take(it);
    chosen.add(it.id);
    count++;
  }

  // Interleave topics so the same topic doesn't appear twice in a row where avoidable.
  const order = [...TOPIC_KEYS].sort((a, b) => byTopic[b].length - byTopic[a].length);
  const deck = [];
  while (deck.length < count) {
    for (const t of order) {
      const next = byTopic[t].shift();
      if (next) deck.push(next);
    }
  }
  return deck.slice(0, size);
}

export function londonDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
