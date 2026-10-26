// Cloudflare Worker entry point.
// Files in public/ are served as static assets automatically; anything that
// isn't a file (the /api routes) reaches this handler.

import { onRequestGet as today } from "./api.js";
import { handleWhy } from "./why.js";
import { handleArticle } from "./article.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/today" && request.method === "GET") {
      return today({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    if (url.pathname === "/api/article" && request.method === "GET") {
      return handleArticle(request, ctx);
    }
    if (url.pathname === "/api/why" && request.method === "POST") {
      return handleWhy(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
