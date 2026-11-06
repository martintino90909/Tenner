// The Durable Object that holds Tenner's accounts and notification
// subscriptions. There is one instance ("main"); the Worker calls its
// methods directly (RPC).

import { DurableObject } from "cloudflare:workers";
import { Store } from "../lib/store.js";
import { generateVapidKeys } from "../lib/webpush.js";

export class TennerStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = (query, ...params) => ctx.storage.sql.exec(query, ...params).toArray();
    this.store = new Store(sql);
  }
  auth(token) { return this.store.auth(token); }
  activity(token, counts) { return this.store.activity(token, counts); }

  // Push keys are made on first use and never leave this database.
  async vapid() {
    let keys = this.store.getSetting("vapid");
    if (!keys) {
      keys = await generateVapidKeys();
      this.store.setSetting("vapid", keys);
    }
    return keys;
  }
  async vapidPublicKey() { return (await this.vapid()).publicKey; }

  pushSettings(token) { return this.store.pushSettings(token); }
  subscribe(token, sub, time) { return this.store.subscribe(token, sub, time); }
  unsubscribe(token, endpoint) { return this.store.unsubscribe(token, endpoint); }
  setNotifyTime(token, time) { return this.store.setNotifyTime(token, time); }
  subsFor(userId) { return this.store.subsFor(userId); }
  due(dateStr, hhmm) { return this.store.due(dateStr, hhmm); }
  markNotified(userId, dateStr) { return this.store.markNotified(userId, dateStr); }
  dropSub(endpoint) { return this.store.dropSub(endpoint); }

  list() { return this.store.list(); }
  create(input) { return this.store.create(input); }
  update(id, changes) { return this.store.update(id, changes); }
  resetLink(id) { return this.store.resetLink(id); }
  remove(id) { return this.store.remove(id); }
}

export const storeFor = (env) => env.STORE.get(env.STORE.idFromName("main"));
