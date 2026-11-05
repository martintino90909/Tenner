// The Durable Object that holds Tenner's accounts. There is one instance
// ("main"); the Worker calls its methods directly (RPC).

import { DurableObject } from "cloudflare:workers";
import { Store } from "../lib/store.js";

export class TennerStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = (query, ...params) => ctx.storage.sql.exec(query, ...params).toArray();
    this.store = new Store(sql);
  }
  auth(token) { return this.store.auth(token); }
  activity(token, counts) { return this.store.activity(token, counts); }
  list() { return this.store.list(); }
  create(input) { return this.store.create(input); }
  update(id, changes) { return this.store.update(id, changes); }
  resetLink(id) { return this.store.resetLink(id); }
  remove(id) { return this.store.remove(id); }
}

export const storeFor = (env) => env.STORE.get(env.STORE.idFromName("main"));
