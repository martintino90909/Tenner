// Cloudflare Worker entry point.
// Files in public/ are served as static assets automatically; anything that
// isn't a file (invite links and the /api routes) reaches this handler.
//
// Every /api call needs the person's invite key (header "x-tenner-key").
// Admin calls need Martin's admin key (header "x-tenner-admin"), whose
// SHA-256 hash is in wrangler.jsonc as ADMIN_KEY_SHA256.

import { onRequestGet as today, feedStatus } from "./api.js";
import { handleWhy } from "./why.js";
import { handleArticle } from "./article.js";
import { TennerStore, storeFor } from "./store-do.js";

export { TennerStore };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isAdmin(request, env) {
  const key = request.headers.get("x-tenner-admin") || "";
  if (!key || !env.ADMIN_KEY_SHA256) return false;
  return (await sha256(key)) === env.ADMIN_KEY_SHA256;
}

// Returns the signed-in person, or a Response explaining why not.
async function requireUser(request, env) {
  const key = request.headers.get("x-tenner-key") || "";
  const user = key ? await storeFor(env).auth(key) : null;
  if (!user) return json({ error: "signed-out", message: "This invite link isn't valid any more." }, 401);
  if (user.status !== "active") return json({ error: "paused", message: "Your access to Tenner is paused." }, 403);
  return user;
}

function manifestFor(token) {
  return {
    name: "Tenner",
    short_name: "Tenner",
    description: "Ten news stories a day, as swipeable cards.",
    start_url: `/u/${token}`,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#E9ECE8",
    theme_color: "#0E5A54",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

async function adminRoutes(request, env, path) {
  if (!(await isAdmin(request, env))) return json({ error: "not-admin", message: "That admin key isn't right." }, 401);
  const store = storeFor(env);
  const body = request.method === "GET" || request.method === "DELETE" ? {} : await request.json().catch(() => ({}));
  try {
    if (path === "/api/admin/users" && request.method === "GET") return json({ users: await store.list() });
    if (path === "/api/admin/feeds" && request.method === "GET") return json({ feeds: await feedStatus() });
    if (path === "/api/admin/users" && request.method === "POST") return json({ user: await store.create(body) });
    const m = path.match(/^\/api\/admin\/users\/([\w-]+)(\/reset)?$/);
    if (m && m[2] && request.method === "POST") return json({ user: await store.resetLink(m[1]) });
    if (m && request.method === "PATCH") return json({ user: await store.update(m[1], body) });
    if (m && request.method === "DELETE") return json({ ok: await store.remove(m[1]) });
  } catch (err) {
    return json({ error: "bad-request", message: String(err?.message || err) }, 400);
  }
  return json({ error: "not-found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const waitUntil = (p) => ctx.waitUntil(p);

    // Invite links: /u/<key> opens the app; its manifest keeps the key when added to the Home Screen.
    const invite = path.match(/^\/u\/([\w-]{8,64})(\/manifest\.webmanifest)?\/?$/);
    if (invite && request.method === "GET") {
      if (invite[2]) return new Response(JSON.stringify(manifestFor(invite[1])), { headers: { "content-type": "application/manifest+json" } });
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }

    if (path.startsWith("/api/admin/")) return adminRoutes(request, env, path);

    if (path === "/api/activity" && request.method === "POST") {
      // Sent with navigator.sendBeacon, so the key comes in the body.
      const body = await request.json().catch(() => ({}));
      const ok = await storeFor(env).activity(String(body.key || ""), body);
      return json({ ok }, ok ? 200 : 401);
    }

    if (path.startsWith("/api/")) {
      const user = await requireUser(request, env);
      if (user instanceof Response) return user;

      if (path === "/api/me" && request.method === "GET") return json({ name: user.name, topics: user.topics });
      if (path === "/api/today" && request.method === "GET") return today({ request, waitUntil, topics: user.topics });
      if (path === "/api/article" && request.method === "GET") return handleArticle(request, ctx);
      if (path === "/api/why" && request.method === "POST") return handleWhy(request, env, ctx);
      return json({ error: "not-found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
