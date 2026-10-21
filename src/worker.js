// Cloudflare Worker entry point.
// Files in public/ are served as static assets automatically; anything that
// isn't a file (like /api/today) reaches this handler.

import { onRequestGet as today } from "./api.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/today" && request.method === "GET") {
      return today({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    return env.ASSETS.fetch(request);
  },
};
