// Tenner's learning. Runs on the phone: swipes, opens, saves and reads never
// leave the device. Each action nudges scores for the story's topic, source
// and headline keywords; older actions fade by 2% a day.

export const SIGNALS = { save: 3, open: 2, readLong: 1, like: 1, skip: -1 };
export const DECAY_PER_DAY = 0.98;
export const COLD_START = 15; // swipes before personalising kicks in
const DAY = 24 * 60 * 60 * 1000;
const W = { topic: 1, source: 0.5, keyword: 0.6 };
const ADJUST = { more: 3, less: -3 };

const STOP = new Set(
  "the a an and or of to in on for with at by from as is are was were be been it its this that after over into new says say how why what who will can could than more not but about up out his her their they you your we our has have had amid set just first may might after before says said year years day days week time".split(" ")
);

export function keywords(title = "") {
  const out = new Set();
  for (const w of title.toLowerCase().replace(/[‘’']/g, "").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)) {
    if (w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return [...out].slice(0, 8);
}

const add = (map, k, v) => { if (k) map[k] = (map[k] || 0) + v; };

/**
 * Turns the action log into interest scores.
 * log entries: { id, topic, source, kind, t, kw?, ms?, depth? }
 */
export function buildProfile(log, { now = Date.now(), since = 0 } = {}) {
  const events = log.filter((e) => e.t >= since);
  // Only each story's last swipe counts, so undo and re-swipes don't double up.
  const swipe = new Map();
  const saved = new Map();
  const opened = new Set();
  const readLong = new Set();
  const meta = new Map();
  for (const e of events) {
    meta.set(e.id, e.kw ? e : meta.get(e.id) || e);
    if (e.kind === "like" || e.kind === "skip") swipe.set(e.id, e);
    else if (e.kind === "undo") swipe.delete(e.id);
    else if (e.kind === "save") saved.set(e.id, e);
    else if (e.kind === "unsave") saved.delete(e.id);
    else if (e.kind === "open") { if (!opened.has(e.id)) meta.set(e.id + ":open", e); opened.add(e.id); }
    else if (e.kind === "close" && ((e.ms || 0) >= 30000 || (e.depth || 0) >= 0.6)) { readLong.add(e.id); meta.set(e.id + ":read", e); }
  }

  const p = { topic: {}, source: {}, kw: {}, decisions: swipe.size, likes: 0, skips: 0 };
  const apply = (e, value) => {
    const m = meta.get(e.id) || e;
    const v = value * Math.pow(DECAY_PER_DAY, Math.max(0, (now - e.t) / DAY));
    add(p.topic, m.topic, v * W.topic);
    add(p.source, m.source, v * W.source);
    for (const k of m.kw || []) add(p.kw, k, v * W.keyword);
  };
  for (const e of swipe.values()) {
    apply(e, SIGNALS[e.kind]);
    e.kind === "like" ? p.likes++ : p.skips++;
  }
  for (const e of saved.values()) apply(e, SIGNALS.save);
  for (const id of opened) apply(meta.get(id + ":open"), SIGNALS.open);
  for (const id of readLong) apply(meta.get(id + ":read"), SIGNALS.readLong);
  return p;
}

export function scoreStory(story, profile, adjust = {}, now = Date.now()) {
  let s = (profile.topic[story.topic] || 0) + (ADJUST[adjust[story.topic]] || 0);
  s += (profile.source[story.source] || 0);
  const kws = story.kw || keywords(story.title);
  if (kws.length) {
    const kwSum = kws.reduce((n, k) => n + (profile.kw[k] || 0), 0);
    s += kwSum / Math.sqrt(kws.length);
  }
  // Small nudge towards fresher stories.
  if (story.published) s += Math.max(0, 0.6 - (now - story.published) / (12 * 60 * 60 * 1000) * 0.6);
  return s;
}

/**
 * Picks a personal ten from today's pool: 8 best matches (max 4 per topic,
 * 3 per source) plus 2 wildcards from the topics you engage with least.
 * Falls back to the server's even split until there are enough swipes.
 */
export function personalise({ pool, fallback = [], profile, adjust = {}, topics, exclude = new Set(), size = 10, now = Date.now() }) {
  const allowed = topics.filter((t) => adjust[t] !== "mute");
  const available = pool.filter((s) => allowed.includes(s.topic) && !exclude.has(s.id));
  if (!profile || profile.decisions < COLD_START) {
    const cards = (fallback.length ? fallback : available).filter((s) => !exclude.has(s.id) && allowed.includes(s.topic)).slice(0, size);
    return { cards, wildcards: [], personalised: false };
  }

  const scored = available.map((s) => ({ s, score: scoreStory(s, profile, adjust, now) })).sort((a, b) => b.score - a.score);
  const perTopic = {};
  const perSource = {};
  const picked = [];
  const take = (s) => {
    picked.push(s);
    perTopic[s.topic] = (perTopic[s.topic] || 0) + 1;
    perSource[s.source] = (perSource[s.source] || 0) + 1;
  };

  const wildSlots = Math.min(2, Math.max(0, size - 8));
  const mainSlots = size - wildSlots;
  const maxPerTopic = allowed.length === 1 ? size : 4;
  for (const { s } of scored) {
    if (picked.length >= mainSlots) break;
    if ((perTopic[s.topic] || 0) >= maxPerTopic || (perSource[s.source] || 0) >= 3) continue;
    take(s);
  }

  // Wildcards: freshest stories from the least-liked topics (never "less" ones first).
  const topicScore = (t) => (profile.topic[t] || 0) + (ADJUST[adjust[t]] || 0) * 10;
  const lowTopics = [...allowed].sort((a, b) => topicScore(a) - topicScore(b));
  const chosen = new Set(picked.map((s) => s.id));
  const wildcards = [];
  for (const t of [...lowTopics, ...lowTopics]) {
    if (wildcards.length >= wildSlots) break;
    const cand = available
      .filter((s) => s.topic === t && !chosen.has(s.id))
      .sort((a, b) => (b.published || 0) - (a.published || 0))[0];
    if (cand) { wildcards.push(cand); chosen.add(cand.id); }
  }

  // Top up if the pool was thin.
  for (const { s } of scored) {
    if (picked.length + wildcards.length >= size) break;
    if (!chosen.has(s.id)) { take(s); chosen.add(s.id); }
  }

  // Best matches first, with wildcards placed 4th and 8th.
  const cards = [...picked];
  wildcards.forEach((w, i) => cards.splice(Math.min(cards.length, i === 0 ? 3 : 7), 0, w));
  return { cards: cards.slice(0, size), wildcards: wildcards.map((w) => w.id), personalised: true };
}

// Top liked and avoided keywords and sources, for the dashboard.
export function highlights(profile, n = 8) {
  const sorted = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]);
  const kws = sorted(profile.kw);
  return {
    liked: kws.filter(([, v]) => v > 0.5).slice(0, n),
    avoided: kws.filter(([, v]) => v < -0.5).reverse().slice(0, Math.ceil(n / 2)),
    sources: sorted(profile.source).filter(([, v]) => v > 0.5).slice(0, 6),
  };
}
