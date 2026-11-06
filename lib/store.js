// Accounts for Tenner. Runs inside a SQLite-backed Durable Object (see
// src/store-do.js); written against a tiny `sql(query, ...params)` interface
// so it can be tested in Node with node:sqlite.
//
// Account details, usage counts, notification subscriptions, stories sent
// between friends, and (for people who allow it) which stories they liked,
// used only for anonymous "Liked by N friends" counts. Saved stories, skips
// and everything learning uses stay on each person's phone.

import { TOPIC_KEYS, DEFAULT_TOPICS } from "./pick.js";
import { ARTICLE_SITES } from "./sources.js";
import { isAllowed } from "./article.js";

const SEEN_EVERY_MS = 5 * 60 * 1000; // update "last used" at most every 5 minutes
const STATUSES = ["active", "paused"];

export function newToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function cleanTopics(topics) {
  const list = Array.isArray(topics) ? topics.filter((t) => TOPIC_KEYS.includes(t)) : [];
  return list.length ? [...new Set(list)] : [...DEFAULT_TOPICS];
}

export const DEFAULT_TIME = "07:30";
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const cleanTime = (t) => (TIME_RE.test(String(t)) ? String(t) : DEFAULT_TIME);
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// A notification is only sent within this window after the chosen time, so
// turning it on in the evening doesn't fire that morning's message late.
const SEND_WINDOW_MIN = 90;

const DAY = 24 * 60 * 60 * 1000;
const SHARES_PER_DAY = 20;
const LIKE_DAYS = 7;

// A shared story is shown on a friend's phone, so only keep known fields,
// trim them, and only allow links to Tenner's own news sites.
export function cleanSharedStory(s = {}) {
  const str = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  const link = str(s.link, 600);
  if (!isAllowed(link, ARTICLE_SITES)) throw new Error("Only stories from Tenner's news sources can be sent");
  const image = str(s.image, 600);
  return {
    id: str(s.id, 40) || newToken().slice(0, 10),
    title: str(s.title, 300),
    link,
    summary: str(s.summary, 400),
    image: /^https:\/\//.test(image) ? image : "",
    topic: TOPIC_KEYS.includes(s.topic) ? s.topic : "world",
    source: str(s.source, 60),
    published: Number(s.published) || null,
    why: str(s.why, 260) || undefined,
  };
}

const cleanName = (name) => String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);

function toUser(row, { withToken = false } = {}) {
  if (!row) return null;
  const u = {
    id: row.id,
    name: row.name,
    status: row.status,
    topics: cleanTopics(JSON.parse(row.topics || "[]")),
    created: row.created,
    lastSeen: row.last_seen || null,
    swipes: row.swipes || 0,
    opens: row.opens || 0,
    reads: row.reads || 0,
    notifyTime: row.notify_time || DEFAULT_TIME,
  };
  if (withToken) u.token = row.token;
  return u;
}

export class Store {
  constructor(sql, now = () => Date.now()) {
    this.sql = sql;
    this.now = now;
    sql(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      topics TEXT NOT NULL DEFAULT '[]',
      created INTEGER NOT NULL,
      last_seen INTEGER,
      swipes INTEGER NOT NULL DEFAULT 0,
      opens INTEGER NOT NULL DEFAULT 0,
      reads INTEGER NOT NULL DEFAULT 0
    )`);
    // Added for notifications (older databases get the columns on first run).
    const cols = sql("PRAGMA table_info(users)").map((c) => c.name);
    if (!cols.includes("notify_time")) sql(`ALTER TABLE users ADD COLUMN notify_time TEXT NOT NULL DEFAULT '${DEFAULT_TIME}'`);
    if (!cols.includes("last_notified")) sql("ALTER TABLE users ADD COLUMN last_notified TEXT");
    sql(`CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created INTEGER NOT NULL
    )`);
    sql("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    sql(`CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      story TEXT NOT NULL,
      note TEXT,
      created INTEGER NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0
    )`);
    sql(`CREATE TABLE IF NOT EXISTS likes (
      story_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created INTEGER NOT NULL,
      PRIMARY KEY (story_id, user_id)
    )`);
  }

  getSetting(key) {
    const r = this.row("SELECT value FROM settings WHERE key = ?", key);
    return r ? JSON.parse(r.value) : null;
  }

  setSetting(key, value) {
    this.sql("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
  }

  row(query, ...params) {
    return this.sql(query, ...params)[0] || null;
  }

  // Called on every app request. Returns the person, or null if the link is unknown.
  auth(token) {
    if (!token || typeof token !== "string" || token.length > 64) return null;
    const row = this.row("SELECT * FROM users WHERE token = ?", token);
    if (!row) return null;
    const now = this.now();
    if (row.status === "active" && (!row.last_seen || now - row.last_seen > SEEN_EVERY_MS)) {
      this.sql("UPDATE users SET last_seen = ? WHERE id = ?", now, row.id);
      row.last_seen = now;
    }
    return toUser(row);
  }

  activity(token, counts = {}) {
    const user = this.auth(token);
    if (!user || user.status !== "active") return false;
    const n = (v) => Math.max(0, Math.min(200, Math.floor(Number(v) || 0)));
    this.sql(
      "UPDATE users SET swipes = swipes + ?, opens = opens + ?, reads = reads + ?, last_seen = ? WHERE id = ?",
      n(counts.swipes), n(counts.opens), n(counts.reads), this.now(), user.id
    );
    return true;
  }

  /* ---------- notifications ---------- */

  activeUser(token) {
    const u = this.auth(token);
    if (!u || u.status !== "active") throw new Error("Not signed in");
    return u;
  }

  pushSettings(token) {
    const u = this.activeUser(token);
    const n = this.row("SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?", u.id).n;
    return { devices: n, time: u.notifyTime };
  }

  subscribe(token, sub, time) {
    const u = this.activeUser(token);
    const endpoint = String(sub?.endpoint || "");
    const p256dh = String(sub?.keys?.p256dh || "");
    const auth = String(sub?.keys?.auth || "");
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) throw new Error("That isn't a valid push subscription");
    this.sql(
      `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      endpoint, u.id, p256dh, auth, this.now()
    );
    if (time !== undefined) this.sql("UPDATE users SET notify_time = ? WHERE id = ?", cleanTime(time), u.id);
    return this.pushSettings(token);
  }

  unsubscribe(token, endpoint) {
    const u = this.activeUser(token);
    this.sql("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?", String(endpoint || ""), u.id);
    return this.pushSettings(token);
  }

  setNotifyTime(token, time) {
    const u = this.activeUser(token);
    this.sql("UPDATE users SET notify_time = ? WHERE id = ?", cleanTime(time), u.id);
    return this.pushSettings(token);
  }

  subsFor(userId) {
    return this.sql("SELECT * FROM push_subs WHERE user_id = ?", userId).map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
  }

  // People whose morning notification is due now (London date and time).
  due(dateStr, hhmm) {
    const nowMin = minutes(hhmm);
    return this.sql(
      `SELECT * FROM users WHERE status = 'active' AND (last_notified IS NULL OR last_notified <> ?)
       AND EXISTS (SELECT 1 FROM push_subs WHERE push_subs.user_id = users.id)`,
      dateStr
    )
      .map((r) => toUser(r))
      .filter((u) => {
        const diff = nowMin - minutes(u.notifyTime);
        return diff >= 0 && diff <= SEND_WINDOW_MIN;
      })
      .map((u) => ({ ...u, subs: this.subsFor(u.id) }));
  }

  markNotified(userId, dateStr) {
    this.sql("UPDATE users SET last_notified = ? WHERE id = ?", dateStr, userId);
  }

  dropSub(endpoint) {
    this.sql("DELETE FROM push_subs WHERE endpoint = ?", endpoint);
  }

  /* ---------- friends ---------- */

  // Everyone else who's active, for the "Send to" list.
  friends(token) {
    const me = this.activeUser(token);
    return this.sql("SELECT id, name FROM users WHERE status = 'active' AND id <> ? ORDER BY name COLLATE NOCASE", me.id);
  }

  setMyTopics(token, topics) {
    const me = this.activeUser(token);
    this.sql("UPDATE users SET topics = ? WHERE id = ?", JSON.stringify(cleanTopics(topics)), me.id);
    return cleanTopics(topics);
  }

  share(token, toIds, story, note) {
    const me = this.activeUser(token);
    const ids = [...new Set((Array.isArray(toIds) ? toIds : []).map(String))].slice(0, 20);
    if (!ids.length) throw new Error("Pick at least one friend");
    const sentToday = this.row("SELECT COUNT(*) AS n FROM shares WHERE from_id = ? AND created > ?", me.id, this.now() - DAY).n;
    if (sentToday + ids.length > SHARES_PER_DAY) throw new Error(`You can send up to ${SHARES_PER_DAY} stories a day`);
    const clean = cleanSharedStory(story);
    const n = String(note || "").replace(/\s+/g, " ").trim().slice(0, 140) || null;
    const recipients = [];
    for (const to of ids) {
      const friend = this.row("SELECT id, name FROM users WHERE id = ? AND status = 'active' AND id <> ?", to, me.id);
      if (!friend) continue;
      this.sql(
        "INSERT INTO shares (id, from_id, to_id, story, note, created) VALUES (?, ?, ?, ?, ?, ?)",
        newToken().slice(0, 12), me.id, friend.id, JSON.stringify(clean), n, this.now()
      );
      recipients.push(friend);
    }
    if (!recipients.length) throw new Error("Those friends aren't on Tenner any more");
    return { from: me.name, recipients, story: clean, note: n };
  }

  // Stories friends have sent that this phone hasn't picked up yet.
  inbox(token) {
    const me = this.activeUser(token);
    return this.sql(
      `SELECT shares.id, shares.story, shares.note, shares.created, users.name AS from_name
       FROM shares JOIN users ON users.id = shares.from_id
       WHERE shares.to_id = ? AND shares.delivered = 0 ORDER BY shares.created ASC LIMIT 20`,
      me.id
    ).map((r) => ({ id: r.id, from: r.from_name, note: r.note, sent: r.created, story: JSON.parse(r.story) }));
  }

  ack(token, ids) {
    const me = this.activeUser(token);
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 50)) {
      this.sql("UPDATE shares SET delivered = 1 WHERE id = ? AND to_id = ?", String(id), me.id);
    }
    // Keep the table small: delivered shares older than a month aren't needed.
    this.sql("DELETE FROM shares WHERE delivered = 1 AND created < ?", this.now() - 30 * DAY);
    return true;
  }

  like(token, storyId, on) {
    const me = this.activeUser(token);
    const id = String(storyId || "").slice(0, 40);
    if (!id) return false;
    if (on) this.sql("INSERT INTO likes (story_id, user_id, created) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", id, me.id, this.now());
    else this.sql("DELETE FROM likes WHERE story_id = ? AND user_id = ?", id, me.id);
    this.sql("DELETE FROM likes WHERE created < ?", this.now() - LIKE_DAYS * DAY);
    return true;
  }

  clearLikes(token) {
    const me = this.activeUser(token);
    this.sql("DELETE FROM likes WHERE user_id = ?", me.id);
    return true;
  }

  // How many *other* people liked each story. Never says who.
  likeCounts(token, storyIds) {
    const me = this.activeUser(token);
    const out = {};
    for (const id of (Array.isArray(storyIds) ? storyIds : []).slice(0, 60)) {
      const n = this.row("SELECT COUNT(*) AS n FROM likes WHERE story_id = ? AND user_id <> ? AND created > ?", String(id), me.id, this.now() - LIKE_DAYS * DAY).n;
      if (n) out[id] = n;
    }
    return out;
  }

  /* ---------- admin ---------- */

  list() {
    const devices = {};
    for (const r of this.sql("SELECT user_id, COUNT(*) AS n FROM push_subs GROUP BY user_id")) devices[r.user_id] = r.n;
    return this.sql("SELECT * FROM users ORDER BY created ASC").map((r) => ({ ...toUser(r, { withToken: true }), pushDevices: devices[r.id] || 0 }));
  }

  create({ name, topics } = {}) {
    const n = cleanName(name);
    if (!n) throw new Error("Give the person a name");
    const id = newToken().slice(0, 10);
    const token = newToken();
    this.sql(
      "INSERT INTO users (id, name, token, status, topics, created) VALUES (?, ?, ?, 'active', ?, ?)",
      id, n, token, JSON.stringify(cleanTopics(topics)), this.now()
    );
    return toUser(this.row("SELECT * FROM users WHERE id = ?", id), { withToken: true });
  }

  update(id, changes = {}) {
    const row = this.row("SELECT * FROM users WHERE id = ?", id);
    if (!row) throw new Error("That person no longer exists");
    const name = changes.name !== undefined ? cleanName(changes.name) || row.name : row.name;
    const status = STATUSES.includes(changes.status) ? changes.status : row.status;
    const topics = changes.topics !== undefined ? JSON.stringify(cleanTopics(changes.topics)) : row.topics;
    this.sql("UPDATE users SET name = ?, status = ?, topics = ? WHERE id = ?", name, status, topics, id);
    return toUser(this.row("SELECT * FROM users WHERE id = ?", id), { withToken: true });
  }

  // Makes a new invite link; the old one stops working straight away.
  resetLink(id) {
    if (!this.row("SELECT id FROM users WHERE id = ?", id)) throw new Error("That person no longer exists");
    this.sql("UPDATE users SET token = ? WHERE id = ?", newToken(), id);
    return toUser(this.row("SELECT * FROM users WHERE id = ?", id), { withToken: true });
  }

  remove(id) {
    this.sql("DELETE FROM push_subs WHERE user_id = ?", id);
    this.sql("DELETE FROM users WHERE id = ?", id);
    return true;
  }
}
