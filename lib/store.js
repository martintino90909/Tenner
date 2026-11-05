// Accounts for Tenner. Runs inside a SQLite-backed Durable Object (see
// src/store-do.js); written against a tiny `sql(query, ...params)` interface
// so it can be tested in Node with node:sqlite.
//
// Only account details and usage counts live here. Each person's saved
// stories and swipes stay on their own phone.

import { TOPIC_KEYS } from "./pick.js";

const SEEN_EVERY_MS = 5 * 60 * 1000; // update "last used" at most every 5 minutes
const STATUSES = ["active", "paused"];

export function newToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function cleanTopics(topics) {
  const list = Array.isArray(topics) ? topics.filter((t) => TOPIC_KEYS.includes(t)) : [];
  return list.length ? [...new Set(list)] : [...TOPIC_KEYS];
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

  /* ---------- admin ---------- */

  list() {
    return this.sql("SELECT * FROM users ORDER BY created ASC").map((r) => toUser(r, { withToken: true }));
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
    this.sql("DELETE FROM users WHERE id = ?", id);
    return true;
  }
}
