// Tenner: ten news stories a day as swipeable cards.
// Phase 1: real feeds, swipe, open, save. Every action is logged on this phone
// so Phase 3 can learn from it.

import { buildProfile, personalise, keywords, highlights, COLD_START } from "/learn.js";
import { canSpeak, createPlayer, chunk } from "/listen.js";

const TOPICS = {
  tech: { name: "Tech & engineering", short: "Tech", c: "var(--t-tech)" },
  biz: { name: "Business & markets", short: "Business", c: "var(--t-biz)" },
  cars: { name: "Cars & motorsport", short: "Cars", c: "var(--t-cars)" },
  world: { name: "UK & world", short: "UK & world", c: "var(--t-world)" },
  bio: { name: "Biomedical", short: "Biomed", c: "var(--t-bio)" },
  med: { name: "Medicine & health", short: "Medicine", c: "var(--t-med)" },
};
const TOPIC_KEYS = Object.keys(TOPICS);
const myTopics = () => (me?.topics?.length ? me.topics.filter((t) => TOPICS[t]) : deck?.topics?.length ? deck.topics : ["tech", "biz", "cars", "world"]);
const K = { deck: "tenner.deck", saved: "tenner.saved", log: "tenner.log", install: "tenner.installDismissed", key: "tenner.key", pending: "tenner.pendingActivity", adjust: "tenner.adjust", since: "tenner.learnSince", termHint: "tenner.termHintSeen", shareLikes: "tenner.shareLikes" };
const LOG_LIMIT = 2000;

/* ---------- storage ---------- */
const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let deck = load(K.deck, null);
let saved = load(K.saved, []);
let log = load(K.log, []);

/* ---------- sign-in (personal invite links) ---------- */
// An invite link looks like /u/<key>. The key is remembered on this phone and
// sent with every request. The manifest link carries it too, so an app added
// to the Home Screen opens already signed in.
const KEY_RE = /^[\w-]{8,64}$/;
const fromPath = location.pathname.match(/^\/u\/([\w-]{8,64})\/?$/);
if (fromPath) store(K.key, fromPath[1]);
let key = load(K.key, null);
if (key && !KEY_RE.test(key)) key = null;
if (key) document.querySelector('link[rel="manifest"]')?.setAttribute("href", `/u/${key}/manifest.webmanifest`);
let me = null; // { name, topics } once the server confirms the link

class SignInError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function api(path, opts = {}) {
  if (!key) throw new SignInError("signed-out", "Open your invite link to start using Tenner.");
  const res = await fetch(path, { cache: "no-store", ...opts, headers: { ...(opts.headers || {}), "x-tenner-key": key } });
  if (res.status === 401 || res.status === 403) {
    const data = await res.json().catch(() => ({}));
    if (data.error === "signed-out" || data.error === "paused") {
      const err = new SignInError(data.error, data.message);
      showGate(err);
      throw err;
    }
  }
  return res;
}

// Usage counts (numbers only) so Martin can see who's using Tenner.
// Saved stories and swipes themselves never leave the phone.
let pending = load(K.pending, { swipes: 0, opens: 0, reads: 0 });
function flushActivity() {
  if (!key || !navigator.onLine || !(pending.swipes || pending.opens || pending.reads)) return;
  const body = JSON.stringify({ key, ...pending });
  const sent = navigator.sendBeacon?.("/api/activity", new Blob([body], { type: "application/json" }));
  if (!sent) fetch("/api/activity", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  pending = { swipes: 0, opens: 0, reads: 0 };
  store(K.pending, pending);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushActivity(); });

function record(story, kind, extra = {}) {
  log.push({ id: story.id, topic: story.topic, source: story.source, kind, t: Date.now(), kw: keywords(story.title), ...extra });
  if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT);
  store(K.log, log);
  const counter = { like: "swipes", skip: "swipes", open: "opens", read: "reads" }[kind];
  if (counter) {
    pending[counter]++;
    store(K.pending, pending);
    if (pending.swipes + pending.opens + pending.reads >= 10) flushActivity();
  }
}

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const londonDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function ago(ts) {
  if (!ts) return "";
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

$("date").textContent = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });

/* ---------- learning (all on this phone) ---------- */
let adjust = load(K.adjust, {});   // { topic: "more" | "less" | "mute" }
let learnSince = load(K.since, 0); // "Reset learning" ignores actions before this
const profileNow = () => buildProfile(log, { since: learnSince });

function pickTen(pool, fallback, exclude = new Set()) {
  return personalise({ pool, fallback, profile: profileNow(), adjust, topics: myTopics(), exclude });
}

/* ---------- loading today's ten ---------- */
async function fetchToday() {
  const res = await api("/api/today");
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data = await res.json();
  if (!data.deck?.length) throw new Error("No stories came back from the feeds");
  return data;
}

async function ensureDeck(force = false) {
  const today = londonDate();
  const sameTopics = !me || (deck?.topics || []).join() === me.topics.join();
  if (!force && deck && deck.date === today && deck.cards?.length && sameTopics) return renderAll();
  renderLoading();
  try {
    const data = await fetchToday();
    const pool = data.pool || [];
    const ten = pickTen(pool, data.deck);
    // Stories friends sent today that haven't been swiped yet stay at the front.
    const carry = deck?.date === data.date ? deck.cards.slice(deck.index).filter((c) => c.from) : [];
    const cards = [...carry, ...ten.cards.filter((c) => !carry.some((x) => x.id === c.id))];
    deck = {
      date: data.date, topics: data.topics, cards, wildcards: ten.wildcards, personalised: ten.personalised,
      pool, index: 0, results: {}, shown: cards.map((c) => c.id), round: 1, friendLikes: deck?.friendLikes || {},
    };
    store(K.deck, deck);
    renderAll();
  } catch (err) {
    if (!(err instanceof SignInError)) renderError(err);
  }
}

// "10 more": next batch from today's pool, balanced and interleaved by topic.
function dealMore() {
  const shown = new Set(deck.shown);
  const ten = pickTen(deck.pool, [], shown);
  if (ten.personalised) {
    if (!ten.cards.length) return toast("That's every story from today's feeds");
    Object.assign(deck, { cards: ten.cards, wildcards: ten.wildcards, index: 0, results: {}, round: (deck.round || 1) + 1 });
    deck.shown.push(...ten.cards.map((s) => s.id));
    store(K.deck, deck);
    refreshFriendLikes();
    return renderAll();
  }
  const byTopic = {};
  myTopics().forEach((t) => (byTopic[t] = deck.pool.filter((s) => s.topic === t && !shown.has(s.id))));
  const next = [];
  while (next.length < 10 && myTopics().some((t) => byTopic[t].length)) {
    for (const t of myTopics()) {
      const s = byTopic[t].shift();
      if (s && next.length < 10) next.push(s);
    }
  }
  if (!next.length) return toast("That's every story from today's feeds");
  deck.cards = next;
  deck.wildcards = [];
  deck.index = 0;
  deck.results = {};
  deck.shown.push(...next.map((s) => s.id));
  deck.round = (deck.round || 1) + 1;
  store(K.deck, deck);
  renderAll();
}

/* ---------- AI "why it matters" ---------- */
const whyPending = new Set();
const whyFailed = new Set();

function whyHTML(s) {
  if (whyFailed.has(s.id) && !s.why) return "";
  const body = s.why ? `<p>${esc(s.why)}</p>` : `<p class="why-loading"><span class="bar"></span></p>`;
  return `<span class="why-label">Why it matters</span>${body}`;
}

function paintWhy(story) {
  document.querySelectorAll(`.why[data-why="${story.id}"]`).forEach((el) => {
    el.innerHTML = whyHTML(story);
    el.hidden = !el.innerHTML;
  });
}

async function ensureWhy(story) {
  if (!story || story.why || whyPending.has(story.id) || whyFailed.has(story.id)) return;
  whyPending.add(story.id);
  try {
    const res = await api("/api/why", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: story.title, summary: story.summary, source: story.source }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.why) throw new Error(data.error || `HTTP ${res.status}`);
    // Keep it with the story everywhere it's stored, so it's only generated once.
    for (const list of [deck?.cards, deck?.pool, saved]) {
      list?.forEach((x) => { if (x.id === story.id) x.why = data.why; });
    }
    story.why = data.why;
    store(K.deck, deck);
    store(K.saved, saved);
  } catch (err) {
    whyFailed.add(story.id);
    console.warn("Why it matters unavailable:", err.message);
  } finally {
    whyPending.delete(story.id);
    paintWhy(story);
  }
}

/* ---------- Today ---------- */
function cardHTML(s, i) {
  const tp = TOPICS[s.topic] || TOPICS.world;
  return `
    <div class="art${s.image ? " has-img" : ""}" style="--c:${tp.c}">
      ${s.image ? `<img src="${esc(s.image)}" alt="" referrerpolicy="no-referrer" decoding="async">` : ""}
      <span class="chip">${tp.short}</span>
      <span class="denom">${pad(i + 1)}</span>
      <span class="stamp yes">Interesting</span>
      <span class="stamp no">Not for me</span>
    </div>
    <div class="body">
      <div class="meta"><span>${esc(s.source)}</span>${s.published ? `<span>·</span><span>${ago(s.published)}</span>` : ""}${deck?.wildcards?.includes(s.id) ? `<span class="wild-tag" title="Something outside your usual picks">Wildcard</span>` : ""}${friendBadge(s)}</div>
      ${s.from ? `<p class="from-note"><b>From ${esc(s.from)}</b>${s.note ? ` · \u201C${esc(s.note)}\u201D` : ""}</p>` : ""}
      <h2 class="headline">${esc(s.title)}</h2>
      ${s.summary ? `<p class="summary">${esc(s.summary)}</p>` : ""}
      <div class="why" data-why="${esc(s.id)}">${whyHTML(s)}</div>
      <div class="hint">Tap to open · swipe to sort</div>
    </div>`;
}

function fixBrokenImages(el) {
  el.querySelectorAll(".art img").forEach((img) =>
    img.addEventListener("error", () => { img.parentElement.classList.remove("has-img"); img.remove(); })
  );
}

function renderPips() {
  if (!deck) { $("pips").innerHTML = ""; return; }
  $("pips").innerHTML = deck.cards
    .map((s, i) => `<span class="pip ${deck.results[s.id] || (i === deck.index ? "now" : "")}"></span>`)
    .join("");
  const total = deck.cards.length;
  const left = Math.max(0, total - deck.index);
  const round = deck.round > 1 ? ` · round ${deck.round}` : "";
  $("serial").textContent = deck.index < total ? `Nº ${pad(deck.index + 1)} / ${pad(total)}${round}` : `Done${round}`;
  $("tab-left").textContent = left ? `${left} left` : "done";
}

function setButtons(enabled) {
  ["btn-skip", "btn-like", "btn-save"].forEach((id) => ($(id).disabled = !enabled));
  $("btn-back").disabled = !deck || !deck.index;
}

function renderLoading() {
  setButtons(false);
  $("serial").textContent = "Fetching today's news";
  $("stack").innerHTML = `
    <div class="card skeleton" aria-busy="true">
      <div class="art"></div>
      <div class="body"><div class="bar" style="width:40%"></div><div class="bar" style="width:92%;height:20px"></div><div class="bar" style="width:75%;height:20px"></div><div class="bar" style="width:85%"></div></div>
    </div>`;
}

function renderError(err) {
  setButtons(false);
  $("serial").textContent = "";
  $("stack").innerHTML = `
    <div class="card message">
      <h2>${navigator.onLine ? "Couldn't load today's news." : "You're offline."}</h2>
      <p>${navigator.onLine ? `${esc(err.message)}. Try again in a moment.` : "Today's ten will load when you have signal. Your saved stories are ready to read now."}</p>
      <div class="btn-row"><button class="btn primary" id="retry">Try again</button>${saved.length ? `<button class="btn" id="err-saved">Open saved</button>` : ""}</div>
    </div>`;
  $("retry").onclick = () => ensureDeck(true);
  $("err-saved") && ($("err-saved").onclick = () => show("saved"));
}

let shownAt = Date.now();

function renderStack() {
  const stack = $("stack");
  stack.innerHTML = "";
  if (!deck) return;
  const done = deck.index >= deck.cards.length;
  setButtons(!done);

  if (done) {
    const r = Object.values(deck.results);
    const likes = r.filter((x) => x === "like").length;
    const skips = r.filter((x) => x === "skip").length;
    const savedToday = deck.cards.filter((c) => saved.some((s) => s.id === c.id)).length;
    const remaining = deck.pool.filter((s) => !deck.shown.includes(s.id)).length;
    const el = document.createElement("div");
    el.className = "card message";
    el.innerHTML = `
      <h2>That's your ten.</h2>
      <p>New stories tomorrow morning. Here's how this round went:</p>
      <div class="tally">
        <div><b>${likes}</b><span>interesting</span></div>
        <div><b>${skips}</b><span>not for me</span></div>
        <div><b>${savedToday}</b><span>saved</span></div>
      </div>
      <div class="btn-row">
        ${remaining ? `<button class="btn primary" id="more">Deal ${Math.min(10, remaining)} more</button>` : ""}
        <button class="btn" id="go-saved">Open saved</button>
      </div>`;
    stack.appendChild(el);
    $("more") && ($("more").onclick = dealMore);
    $("go-saved").onclick = () => show("saved");
    $("btn-save").setAttribute("aria-pressed", "false");
    return;
  }

  for (let k = Math.min(deck.index + 2, deck.cards.length - 1); k >= deck.index; k--) {
    const s = deck.cards[k];
    const el = document.createElement("div");
    el.className = "card" + (k === deck.index ? "" : ` behind-${k - deck.index}`);
    el.innerHTML = cardHTML(s, k);
    fixBrokenImages(el);
    if (k === deck.index) {
      el.tabIndex = 0;
      el.setAttribute("aria-label", s.title);
      attachDrag(el, s);
    }
    stack.appendChild(el);
  }
  shownAt = Date.now();
  // Fetch "why it matters" for this card and the next two, so it's ready when they arrive.
  deck.cards.slice(deck.index, deck.index + 3).forEach(ensureWhy);
  $("btn-save").setAttribute("aria-pressed", String(saved.some((x) => x.id === deck.cards[deck.index].id)));
}

function attachDrag(card, story) {
  let start = null, dx = 0, dy = 0;
  const yes = card.querySelector(".stamp.yes"), no = card.querySelector(".stamp.no");
  card.addEventListener("pointerdown", (e) => {
    start = { x: e.clientX, y: e.clientY };
    dx = dy = 0;
    card.setPointerCapture(e.pointerId);
    card.style.transition = "none";
  });
  card.addEventListener("pointermove", (e) => {
    if (!start) return;
    dx = e.clientX - start.x;
    dy = e.clientY - start.y;
    card.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 20}deg)`;
    yes.style.opacity = Math.max(0, Math.min(1, dx / 90));
    no.style.opacity = Math.max(0, Math.min(1, -dx / 90));
  });
  const end = () => {
    if (!start) return;
    start = null;
    card.style.transition = "";
    if (Math.abs(dx) > 90) decide(dx > 0 ? "like" : "skip", card);
    else {
      card.style.transform = "";
      yes.style.opacity = no.style.opacity = 0;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) openSheet(story);
    }
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", () => { dx = 0; end(); });
  card.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") decide("like", card);
    else if (e.key === "ArrowLeft") decide("skip", card);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(story); }
  });
}

let busy = false;
function decide(kind, card) {
  if (busy || !deck || deck.index >= deck.cards.length) return;
  card = card || $("stack").querySelector(".card:last-child");
  const story = deck.cards[deck.index];
  busy = true;
  const stamp = card.querySelector(kind === "like" ? ".stamp.yes" : ".stamp.no");
  if (stamp) stamp.style.opacity = 1;
  const dir = kind === "like" ? 1 : -1;
  card.style.transition = "transform .3s ease-in, opacity .3s";
  card.style.transform = `translate(${dir * 130}vw, 40px) rotate(${dir * 24}deg)`;
  card.style.opacity = "0";
  record(story, kind, { ms: Date.now() - shownAt });
  deck.results[story.id] = kind;
  reportLike(story);
  deck.index++;
  store(K.deck, deck);
  setTimeout(() => { busy = false; renderStack(); renderPips(); renderInterests(); }, 260);
}

// Bring the previous card back and undo how it was swiped.
function goBack() {
  if (busy || !deck || !deck.index) return;
  deck.index--;
  const story = deck.cards[deck.index];
  const prev = deck.results[story.id];
  delete deck.results[story.id];
  record(story, "undo");
  reportLike(story);
  store(K.deck, deck);
  renderStack();
  renderPips();
  renderInterests();
  const top = $("stack").querySelector(".card:last-child");
  if (top && prev) {
    const dir = prev === "like" ? 1 : -1;
    top.style.transition = "none";
    top.style.transform = `translate(${dir * 120}vw, 40px) rotate(${dir * 24}deg)`;
    top.getBoundingClientRect();
    top.style.transition = "";
    top.style.transform = "";
  }
}
$("btn-back").onclick = goBack;
$("btn-like").onclick = () => decide("like");
$("btn-skip").onclick = () => decide("skip");
$("btn-save").onclick = () => {
  const story = deck?.cards[deck.index];
  if (!story) return;
  toggleSave(story);
  $("btn-save").setAttribute("aria-pressed", String(saved.some((x) => x.id === story.id)));
};

/* ---------- offline saves ---------- */
// Saving a story also downloads its full text and photo into the phone's
// cache, so it opens with no signal. The service worker serves the photo.
const OFFLINE_CACHE = "tenner-saved-v1";
const hasCache = "caches" in window;
const offlineKey = (link) => `/offline/article?u=${encodeURIComponent(link)}`;
const downloading = new Set();

async function offlineArticle(link) {
  if (!hasCache) return null;
  try {
    const hit = await (await caches.open(OFFLINE_CACHE)).match(offlineKey(link));
    return hit ? await hit.json() : null;
  } catch { return null; }
}

function markOffline(id, value) {
  const s = saved.find((x) => x.id === id);
  if (!s) return;
  s.offline = value;
  store(K.saved, saved);
  renderSaved();
}

async function downloadForOffline(story) {
  if (!hasCache || downloading.has(story.id) || !navigator.onLine) return;
  downloading.add(story.id);
  renderSaved();
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    let a = articleCache.get(story.link);
    if (!a) {
      const res = await api(`/api/article?url=${encodeURIComponent(story.link)}`);
      a = await res.json().catch(() => ({ ok: false }));
    }
    if (a.ok && !a.terms) { try { a.terms = await fetchTerms(story, a); } catch {} }
    // Paywalled stories can't be downloaded; keep the headline and intro instead.
    const body = a.ok ? a : { ok: false, reason: "Only the headline and intro could be saved for this story" };
    await cache.put(offlineKey(story.link), new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
    if (story.image) {
      try {
        const img = await fetch(story.image, { mode: "no-cors", referrerPolicy: "no-referrer" });
        await cache.put(story.image, img);
      } catch {}
    }
    markOffline(story.id, a.ok ? "full" : "intro");
  } catch {
    // Try again next time the app opens.
  } finally {
    downloading.delete(story.id);
    renderSaved();
  }
}

async function removeOffline(story) {
  if (!hasCache) return;
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.delete(offlineKey(story.link));
    if (story.image) await cache.delete(story.image);
  } catch {}
}

// Saved stories from before this feature, or saved while offline.
async function backfillOffline() {
  if (!navigator.onLine) return;
  for (const s of saved.filter((x) => !x.offline).slice(0, 15)) await downloadForOffline(s);
}

function renderOnline() {
  $("offline-pill").hidden = navigator.onLine;
}
window.addEventListener("online", () => { renderOnline(); backfillOffline(); flushActivity(); });
window.addEventListener("offline", renderOnline);

function toggleSave(story) {
  const i = saved.findIndex((x) => x.id === story.id);
  if (i === -1) {
    saved.unshift({ ...story, savedAt: Date.now() });
    record(story, "save");
    toast(navigator.onLine ? "Saved. Downloading for offline reading." : "Saved. It'll download when you're back online.");
    downloadForOffline(saved[0]);
  } else {
    const [gone] = saved.splice(i, 1);
    removeOffline(gone);
    record(story, "unsave");
    toast("Removed from saved");
  }
  store(K.saved, saved);
  reportLike(story);
  renderSaved();
  renderInterests();
}

/* ---------- reader ---------- */
const articleCache = new Map();
let reading = null; // { story, openedAt, depth }

const BOOKMARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3.5h12v17l-6-4.2-6 4.2z"/></svg>`;
const CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

const norm = (t = "") => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function articleHTML(a) {
  let html = "";
  let list = false;
  for (const b of a.blocks) {
    if (b.type === "li" && !list) { html += "<ul>"; list = true; }
    if (b.type !== "li" && list) { html += "</ul>"; list = false; }
    if (b.type === "h") html += `<h3>${esc(b.text)}</h3>`;
    else if (b.type === "q") html += `<blockquote>${esc(b.text)}</blockquote>`;
    else if (b.type === "li") html += `<li>${esc(b.text)}</li>`;
    else html += `<p>${esc(b.text)}</p>`;
  }
  return html + (list ? "</ul>" : "");
}

async function loadArticle(story) {
  const box = $("article");
  const done = (html) => {
    if (reading?.story.id !== story.id) return;
    box.innerHTML = html;
    box.removeAttribute("aria-busy");
    readyToListen(story);
  };
  try {
    let a = articleCache.get(story.link);
    if (!a && saved.some((x) => x.id === story.id && x.offline === "full")) a = await offlineArticle(story.link);
    if (!a) {
      if (!navigator.onLine) {
        const cached = await offlineArticle(story.link);
        if (cached) a = cached;
        else throw new Error("You're offline, and this story isn't saved. Save stories while you have signal to read them on the go");
      } else {
        const res = await api(`/api/article?url=${encodeURIComponent(story.link)}`);
        a = await res.json().catch(() => ({ ok: false, reason: `Server returned ${res.status}` }));
      }
      if (a.ok) articleCache.set(story.link, a);
    }
    if (reading?.story.id !== story.id) return;
    if (!a.ok) throw new Error(a.reason || "The full story couldn't be loaded");
    // The outlet's intro usually repeats the first paragraph, so drop it when it does.
    const lede = $("reader-lede");
    if (lede && a.blocks[0] && norm(a.blocks[0].text).startsWith(norm(story.summary).slice(0, 40))) lede.remove();
    $("reader-time").textContent = `${a.minutes} min read`;
    done(articleHTML(a));
    record(story, "read", { words: a.words });
    loadTerms(story, a);
  } catch (err) {
    done(`<div class="reader-fail"><p><b>Couldn't show the full story here.</b> ${esc(err.message)}.</p>
      <a class="btn primary" href="${esc(story.link)}" target="_blank" rel="noopener">Read on ${esc(story.source)}</a></div>`);
  }
}

function setReaderSave() {
  const b = $("reader-save");
  if (b && reading) b.setAttribute("aria-pressed", String(saved.some((x) => x.id === reading.story.id)));
}

/* ---------- explain this ---------- */
let explainState = null; // { story, terms, phrase, passage }

async function fetchTerms(story, a) {
  if (a.terms) return a.terms;
  const res = await api("/api/terms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: story.link, title: story.title, text: a.blocks.map((b) => b.text).join("\n").slice(0, 6000) }),
  });
  const data = await res.json().catch(() => ({ terms: [] }));
  return Array.isArray(data.terms) ? data.terms : [];
}

async function loadTerms(story, a) {
  try {
    const terms = a.terms || (navigator.onLine ? await fetchTerms(story, a) : []);
    a.terms = terms;
    if (reading?.story.id !== story.id || !terms.length) return;
    explainState = { ...(explainState || {}), story, terms };
    underlineTerms(terms);
    if (!load(K.termHint, false) && $("article").querySelector(".term")) {
      $("article").insertAdjacentHTML("afterbegin", `<p class="terms-hint">Tap an underlined term for a quick explanation, or highlight any words and tap Explain.</p>`);
    }
  } catch {
    // No underlines this time; the article still reads fine.
  }
}

// Wraps the first use of each term in a tappable button.
function underlineTerms(terms) {
  const box = $("article");
  terms.forEach((t, i) => {
    const needle = t.term.toLowerCase();
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest("p, li, blockquote") && !n.parentElement.closest(".term, .terms-hint") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue;
      let at = text.toLowerCase().indexOf(needle);
      while (at >= 0) {
        const before = text[at - 1], after = text[at + needle.length];
        if (!(before && /[\p{L}\p{N}]/u.test(before)) && !(after && /[\p{L}\p{N}]/u.test(after))) break;
        at = text.toLowerCase().indexOf(needle, at + 1);
      }
      if (at < 0) continue;
      const match = node.splitText(at);
      match.splitText(needle.length);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "term";
      btn.dataset.i = String(i);
      btn.textContent = match.nodeValue;
      match.replaceWith(btn);
      return;
    }
  });
}

function showExplain(term, text, loading = false) {
  $("explain-chip").hidden = true;
  $("ex-term").textContent = term;
  $("ex-text").textContent = text;
  $("ex-text").classList.toggle("loading", loading);
  $("explain-card").hidden = false;
}

function hideExplain() {
  const card = $("explain-card");
  if (card) card.hidden = true;
}

async function explainPhrase(story, phrase, passage) {
  showExplain(phrase, "Explaining…", true);
  record(story, "explain");
  try {
    const res = await api("/api/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phrase, passage, title: story.title }),
    });
    const data = await res.json().catch(() => ({}));
    if ($("ex-term").textContent !== phrase) return; // they've moved on
    showExplain(phrase, data.explanation || data.error || "No explanation came back. Try again.");
  } catch (err) {
    if (!(err instanceof SignInError)) showExplain(phrase, navigator.onLine ? "Explanations aren't available right now." : "You're offline. Explanations need a connection.");
  }
}

function wireExplain(story) {
  explainState = { story, terms: [] };
  $("ex-close").onclick = hideExplain;
  $("article").addEventListener("click", (e) => {
    const t = e.target.closest(".term");
    if (!t || !explainState?.terms) return;
    e.stopPropagation();
    const term = explainState.terms[Number(t.dataset.i)];
    if (!term) return;
    showExplain(t.textContent, term.explanation);
    record(story, "explain");
    if (!load(K.termHint, false)) { store(K.termHint, true); document.querySelector(".terms-hint")?.remove(); }
  });
  $("explain-chip").onclick = () => {
    if (explainState?.phrase) explainPhrase(story, explainState.phrase, explainState.passage);
    window.getSelection()?.removeAllRanges();
  };
}

// Highlight any words in the article to get an Explain button.
let selTimer;
document.addEventListener("selectionchange", () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    const chip = $("explain-chip");
    if (!chip || !reading || !explainState) return;
    const sel = window.getSelection();
    const phrase = (sel?.toString() || "").replace(/\s+/g, " ").trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const anchor = sel?.anchorNode?.parentElement;
    const block = anchor?.closest("#article p, #article li, #article blockquote, #article h3");
    const ok = block && phrase.length >= 2 && phrase.length <= 80 && phrase.split(" ").length <= 8;
    if (!ok) { chip.hidden = true; return; }
    explainState.phrase = phrase;
    explainState.passage = block.textContent;
    chip.textContent = `Explain \u201C${phrase.length > 32 ? phrase.slice(0, 30) + "…" : phrase}\u201D`;
    chip.hidden = false;
  }, 250);
});

/* ---------- listen mode ---------- */
const PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`;
const PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>`;
const PREV = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>`;
const NEXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

let listening = null; // { story, player }

function listenParts(story) {
  const parts = [];
  const add = (el, text) => chunk(text).forEach((t) => parts.push({ text: t, el }));
  add($("sheet-h"), `${story.title}. From ${story.source}.`);
  const lede = $("reader-lede");
  if (lede) add(lede, lede.textContent);
  const why = document.querySelector(`#sheet .why p:not(.why-loading)`);
  if (why) add(why, `Why it matters. ${why.textContent}`);
  if (!$("article").querySelector(".reader-fail")) {
    $("article").querySelectorAll("p:not(.terms-hint), h3, blockquote, li").forEach((el) => add(el, el.textContent));
  }
  return parts;
}

function readyToListen(story) {
  const btn = $("listen-btn");
  if (!btn || reading?.story.id !== story.id) return;
  btn.disabled = false;
  const words = listenParts(story).reduce((n, p) => n + p.text.split(" ").length, 0);
  $("listen-len").textContent = `${Math.max(1, Math.round(words / 165))} min`;
}

function renderPlayer(st) {
  const bar = $("player");
  if (!bar) return;
  const active = st.playing || st.index > 0;
  bar.hidden = !active;
  $("pl-toggle").innerHTML = st.playing ? PAUSE : PLAY;
  $("pl-toggle").setAttribute("aria-label", st.playing ? "Pause" : "Play");
  $("pl-rate").textContent = `${st.rate}×`;
  $("pl-pos").textContent = st.total ? `${Math.min(st.index + 1, st.total)} / ${st.total}` : "";
  const btn = $("listen-btn");
  if (btn) btn.hidden = active;
  document.querySelectorAll("#sheet .speaking").forEach((el) => el.classList.remove("speaking"));
  const el = st.current?.el;
  if (active && el) {
    el.classList.add("speaking");
    const box = $("reader-scroll").getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.top < box.top + 40 || r.bottom > box.bottom - 80) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}

function wireListen(story) {
  if (!canSpeak) return;
  const player = createPlayer({
    onChange: renderPlayer,
    onFinish: (st) => { record(story, "listen", { ms: st.listenedMs, done: 1 }); listening = null; renderPlayer({ playing: false, index: 0, total: 0, rate: st.rate }); },
  });
  listening = { story, player };
  $("listen-btn").onclick = () => { player.load(listenParts(story)); player.play(); };
  $("pl-toggle").onclick = () => player.toggle();
  $("pl-back").onclick = () => player.skip(-1);
  $("pl-next").onclick = () => player.skip(1);
  $("pl-rate").onclick = () => player.cycleRate();
  $("pl-stop").onclick = () => stopListening();
  // While listening, tap a paragraph to jump to it.
  $("article").addEventListener("click", (e) => {
    if (e.target.closest(".term")) return;
    const el = e.target.closest("p, h3, blockquote, li");
    if (!el || $("player").hidden) return;
    const st = player.state;
    if (!st.total) return;
    const parts = listenParts(story);
    const at = parts.findIndex((p) => p.el === el);
    if (at >= 0) { player.load(parts); player.jumpTo(at); }
  });
}

function stopListening() {
  if (!listening) return;
  const { story, player } = listening;
  const st = player.stop();
  if (st && st.listenedMs > 3000) record(story, "listen", { ms: st.listenedMs, done: st.total ? Math.round((st.index / st.total) * 100) / 100 : 0 });
  listening = null;
}

function openSheet(story) {
  const tp = TOPICS[story.topic] || TOPICS.world;
  record(story, "open");
  reading = { story, openedAt: Date.now(), depth: 0 };
  const sheet = $("sheet");
  sheet.className = "sheet reader";
  sheet.innerHTML = `
    <div class="reader-bar">
      <button class="icon-btn" id="reader-close" aria-label="Back to cards">${CLOSE}</button>
      <div class="reader-src"><span style="color:${tp.c}">${esc(tp.short)}</span> · ${esc(story.source)} · <span id="reader-time">${story.published ? ago(story.published) : ""}</span></div>
      <button class="icon-btn" id="reader-send" aria-label="Send to a friend">${SEND}</button>
      <button class="icon-btn save-toggle" id="reader-save" aria-label="Save for later" aria-pressed="false">${BOOKMARK}</button>
    </div>
    <div class="reader-scroll" id="reader-scroll">
      <div class="reader-inner">
        ${story.image ? `<img class="reader-img" src="${esc(story.image)}" alt="" referrerpolicy="no-referrer">` : ""}
        <h2 class="reader-title" id="sheet-h">${esc(story.title)}</h2>
        ${story.summary ? `<p class="reader-lede" id="reader-lede">${esc(story.summary)}</p>` : ""}
        <div class="why" data-why="${esc(story.id)}">${whyHTML(story)}</div>
        ${canSpeak ? `<button class="listen-btn" id="listen-btn" disabled>${PLAY}<span>Listen</span><small id="listen-len"></small></button>` : ""}
        <div class="article" id="article" aria-busy="true">
          <div class="bar" style="width:96%"></div><div class="bar" style="width:90%"></div><div class="bar" style="width:93%"></div><div class="bar" style="width:60%"></div>
          <div class="bar" style="width:94%;margin-top:14px"></div><div class="bar" style="width:88%"></div><div class="bar" style="width:72%"></div>
        </div>
        <div class="reader-foot">
          <a class="btn" href="${esc(story.link)}" target="_blank" rel="noopener" id="reader-orig">Open on ${esc(story.source)}</a>
        </div>
      </div>
    </div>
    <div class="explain-card" id="explain-card" role="dialog" aria-live="polite" hidden>
      <div class="ex-head"><b id="ex-term"></b><button class="icon-btn" id="ex-close" aria-label="Close explanation">${CLOSE}</button></div>
      <p id="ex-text"></p>
      <small>AI explanation. It can be wrong; check anything important.</small>
    </div>
    <button class="explain-chip" id="explain-chip" hidden></button>
    <div class="player" id="player" hidden>
      <button class="icon-btn" id="pl-back" aria-label="Previous paragraph">${PREV}</button>
      <button class="icon-btn pl-main" id="pl-toggle" aria-label="Pause">${PAUSE}</button>
      <button class="icon-btn" id="pl-next" aria-label="Next paragraph">${NEXT}</button>
      <button class="pl-rate" id="pl-rate" aria-label="Reading speed">1×</button>
      <span class="pl-pos" id="pl-pos"></span>
      <button class="icon-btn" id="pl-stop" aria-label="Stop listening">${CLOSE}</button>
    </div>`;
  sheet.querySelector(".reader-img")?.addEventListener("error", (e) => e.target.remove());
  $("scrim").hidden = false;
  sheet.hidden = false;
  $("reader-close").onclick = closeSheet;
  $("reader-save").onclick = () => { toggleSave(story); setReaderSave(); if (deck) renderStack(); };
  $("reader-orig").onclick = () => record(story, "original");
  const scroller = $("reader-scroll");
  scroller.addEventListener("scroll", () => {
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (max > 0 && reading) reading.depth = Math.max(reading.depth, Math.min(1, scroller.scrollTop / max));
  }, { passive: true });
  setReaderSave();
  ensureWhy(story);
  loadArticle(story);
  wireListen(story);
  wireExplain(story);
  $("reader-send").onclick = () => openSend(story);
  $("reader-close").focus();
}

function closeSheet() {
  stopListening();
  explainState = null;
  if (reading) {
    record(reading.story, "close", { ms: Date.now() - reading.openedAt, depth: Math.round(reading.depth * 100) / 100 });
    reading = null;
  }
  $("scrim").hidden = true;
  $("sheet").hidden = true;
}
$("scrim").onclick = closeSheet;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
  if (e.key === "Backspace" && $("sheet").hidden && !$("view-today").hidden) goBack();
});

/* ---------- Saved ---------- */
function offlineLabel(s) {
  if (!hasCache) return "";
  if (downloading.has(s.id)) return ` · <span class="off-tag busy">Downloading</span>`;
  if (s.offline === "full") return ` · <span class="off-tag">Offline ready</span>`;
  if (s.offline === "intro") return ` · <span class="off-tag part">Intro only</span>`;
  return "";
}

function renderSaved() {
  $("tab-saved").textContent = saved.length;
  const list = $("saved-list");
  if (!saved.length) {
    list.innerHTML = `<div class="empty">Nothing saved yet. Tap the bookmark under a card to keep it for later.</div>`;
    return;
  }
  list.innerHTML = saved
    .map((s) => {
      const tp = TOPICS[s.topic] || TOPICS.world;
      return `<div class="saved-item" style="--c:${tp.c}"><span class="stripe"></span>
        <button class="saved-open" data-open="${esc(s.id)}"><h3>${esc(s.title)}</h3><small>${tp.short} · ${esc(s.source)}${offlineLabel(s)}</small></button>
        <button data-id="${esc(s.id)}" aria-label="Remove from saved">Remove</button></div>`;
    })
    .join("");
  list.querySelectorAll("button[data-open]").forEach((b) => (b.onclick = () => {
    const s = saved.find((x) => x.id === b.dataset.open);
    if (s) openSheet(s);
  }));
  list.querySelectorAll("button[data-id]").forEach((b) => (b.onclick = () => {
    const s = saved.find((x) => x.id === b.dataset.id);
    if (s) toggleSave(s);
    if (deck) renderStack();
  }));
}

/* ---------- friends ---------- */
const SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5 21 3z"/></svg>`;
const shareLikes = () => load(K.shareLikes, true) !== false;
let friendsList = null;

function friendBadge(s) {
  const n = deck?.friendLikes?.[s.id] || 0;
  return n >= 2 ? `<span class="friends-tag">Liked by ${n} friends</span>` : "";
}

// Tells the server whether you currently like a story (swiped right or saved).
function reportLike(story) {
  if (!key || !shareLikes() || !navigator.onLine) return;
  const on = deck?.results?.[story.id] === "like" || saved.some((x) => x.id === story.id);
  api("/api/likes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: story.id, on }) }).catch(() => {});
}

async function refreshFriendLikes() {
  if (!deck?.cards?.length || !navigator.onLine) return;
  try {
    const res = await api("/api/likes/counts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: deck.cards.map((c) => c.id) }) });
    if (!res.ok) return;
    deck.friendLikes = (await res.json()).counts || {};
    store(K.deck, deck);
    renderStack();
  } catch {}
}

// Stories friends sent: they become your very next cards.
async function checkInbox() {
  if (!key || !deck || !navigator.onLine) return;
  try {
    const res = await api("/api/inbox");
    if (!res.ok) return;
    const { items = [] } = await res.json();
    if (!items.length) return;
    const at = Math.min(deck.index, deck.cards.length);
    const incoming = [];
    for (const it of items) {
      const story = { ...it.story, from: it.from, note: it.note || "" };
      const existing = deck.cards.findIndex((c, i) => c.id === story.id && i >= deck.index);
      if (existing >= 0) deck.cards.splice(existing, 1);
      incoming.push(story);
      if (!deck.shown.includes(story.id)) deck.shown.push(story.id);
    }
    deck.cards.splice(at, 0, ...incoming);
    store(K.deck, deck);
    await api("/api/inbox/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: items.map((i) => i.id) }) });
    renderAll();
    const names = [...new Set(items.map((i) => i.from))];
    toast(items.length === 1 ? `${names[0]} sent you a story. It's up next.` : `${items.length} stories from ${names.join(" and ")} are up next.`);
  } catch {}
}

/* send sheet */
let sending = null;
async function openSend(story) {
  sending = { story, to: new Set() };
  $("send-story").textContent = story.title;
  $("send-note").value = "";
  $("send-error").hidden = true;
  $("send-go").disabled = true;
  $("send-go").textContent = "Send";
  $("send").hidden = false;
  const box = $("send-friends");
  if (!navigator.onLine) { box.innerHTML = `<p class="note">You're offline. Sending needs a connection.</p>`; return; }
  box.innerHTML = `<p class="note">Loading your friends…</p>`;
  try {
    if (!friendsList) friendsList = (await (await api("/api/friends")).json()).friends || [];
    box.innerHTML = friendsList.length
      ? friendsList.map((f) => `<button type="button" class="friend" data-id="${esc(f.id)}" aria-pressed="false"><span class="avatar">${esc(f.name.slice(0, 1).toUpperCase())}</span>${esc(f.name)}</button>`).join("")
      : `<p class="note">No one else is on Tenner yet.</p>`;
  } catch (err) {
    if (!(err instanceof SignInError)) box.innerHTML = `<p class="note">Couldn't load your friends. Try again in a moment.</p>`;
  }
}
function closeSend() { $("send").hidden = true; sending = null; }
$("send-close").onclick = closeSend;
$("send").addEventListener("click", (e) => { if (e.target === $("send")) closeSend(); });
$("send-friends").addEventListener("click", (e) => {
  const b = e.target.closest(".friend");
  if (!b || !sending) return;
  const on = b.getAttribute("aria-pressed") !== "true";
  b.setAttribute("aria-pressed", String(on));
  on ? sending.to.add(b.dataset.id) : sending.to.delete(b.dataset.id);
  $("send-go").disabled = !sending.to.size;
  $("send-go").textContent = sending.to.size > 1 ? `Send to ${sending.to.size} friends` : "Send";
});
$("send-go").onclick = async () => {
  if (!sending?.to.size) return;
  const btn = $("send-go");
  btn.disabled = true;
  try {
    const res = await api("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: [...sending.to], story: sending.story, note: $("send-note").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Couldn't send it");
    record(sending.story, "share");
    closeSend();
    toast(`Sent to ${data.sent.join(" and ")}`);
  } catch (err) {
    if (err instanceof SignInError) return;
    $("send-error").textContent = err.message;
    $("send-error").hidden = false;
    btn.disabled = false;
  }
};

/* your topics + likes switch (You tab) */
function renderMyTopics() {
  const mine = myTopics();
  $("my-topics").innerHTML = TOPIC_KEYS.map((t) =>
    `<button type="button" class="chip-toggle" style="--c:${TOPICS[t].c}" data-t="${t}" aria-pressed="${mine.includes(t)}"><i></i>${TOPICS[t].name}</button>`).join("");
  $("share-likes").checked = shareLikes();
}
$("my-topics").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-t]");
  if (!b) return;
  const t = b.dataset.t;
  const mine = myTopics();
  const next = mine.includes(t) ? mine.filter((x) => x !== t) : [...mine, t];
  if (!next.length) return toast("Keep at least one topic");
  if (!navigator.onLine) return toast("You're offline. Change topics when you have signal.");
  try {
    const res = await api("/api/me/topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topics: next }) });
    if (!res.ok) throw new Error();
    me = { ...(me || {}), topics: (await res.json()).topics };
    renderMyTopics();
    await ensureDeck(true);
    toast(mine.includes(t) ? `${TOPICS[t].short} removed. Here's a fresh ten.` : `${TOPICS[t].short} added. Here's a fresh ten.`);
  } catch (err) {
    if (!(err instanceof SignInError)) toast("Couldn't save your topics. Try again.");
  }
});
$("share-likes").addEventListener("change", () => {
  const on = $("share-likes").checked;
  store(K.shareLikes, on);
  if (!on) api("/api/likes/clear", { method: "POST" }).catch(() => {});
  toast(on ? "Your likes now count towards “Liked by friends”" : "Your likes are no longer shared, and past ones are cleared");
});

/* ---------- You: what Tenner has learned ---------- */
const ADJ_LABEL = { less: "Less", auto: "Auto", more: "More" };

function renderInterests() {
  renderMyTopics();
  const p = profileNow();
  const learning = p.decisions >= COLD_START;
  const left = Math.max(0, COLD_START - p.decisions);
  $("learn-lede").textContent = learning
    ? `Your ten are picked from ${p.decisions} swipes, plus your opens, saves and long reads. Eight are your best matches; two are wildcards so the feed doesn't close in on itself.`
    : `${left} more swipe${left === 1 ? "" : "s"} and Tenner starts picking your ten for you. Until then, each day is split evenly across your topics.`;
  $("learn-progress").hidden = learning;
  $("learn-bar").style.width = `${Math.min(100, (p.decisions / COLD_START) * 100)}%`;
  $("tab-you").textContent = learning ? "learning" : `${left} to go`;

  const topics = myTopics();
  const max = Math.max(4, ...topics.map((t) => Math.abs(p.topic[t] || 0)));
  $("topics").innerHTML = topics.map((t) => {
    const tp = TOPICS[t], v = p.topic[t] || 0, w = (Math.abs(v) / max) * 50, mode = adjust[t] || "auto";
    const bar = v >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
    const seg = ["less", "auto", "more"].map((m) =>
      `<button type="button" data-topic="${t}" data-mode="${m}" aria-pressed="${mode === m}">${ADJ_LABEL[m]}</button>`).join("");
    return `<div class="trow${mode === "mute" ? " muted" : ""}" style="--c:${tp.c}">
      <div class="name"><span class="dot"></span>${tp.name}</div>
      <div class="score">${mode === "mute" ? "muted" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1)}</div>
      <div class="track" aria-hidden="true"><div class="fill ${v >= 0 ? "pos" : "neg"}" style="${bar}"></div></div>
      <div class="adjust">
        <div class="seg" role="group" aria-label="${tp.name}">${seg}</div>
        <button type="button" class="mute" data-topic="${t}" data-mode="mute" aria-pressed="${mode === "mute"}">${mode === "mute" ? "Unmute" : "Mute"}</button>
      </div>
    </div>`;
  }).join("");

  const h = highlights(p);
  const chip = ([k, v], cls) => `<span class="${cls}">${esc(k)}<b>${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}</b></span>`;
  $("kw-liked").innerHTML = h.liked.length ? h.liked.map((e) => chip(e, "p")).join("") : `<span>Nothing yet</span>`;
  $("kw-avoided").innerHTML = h.avoided.map((e) => chip(e, "m")).join("");
  $("kw-avoided").hidden = $("kw-avoided-label").hidden = !h.avoided.length;
  $("sources").innerHTML = h.sources.length ? h.sources.map((e) => chip(e, "p")).join("") : `<span>None yet</span>`;

  const cards = deck?.cards || [];
  $("mix").innerHTML = cards.map((c) => `<div class="${deck.wildcards?.includes(c.id) ? "wild" : ""}" style="--c:${(TOPICS[c.topic] || TOPICS.world).c}" title="${esc(c.title)}"></div>`).join("");
  $("legend").innerHTML = [...new Set(cards.map((c) => c.topic))].map((t) => `<span><i style="--c:${TOPICS[t].c}"></i>${TOPICS[t].short}</span>`).join("")
    + (deck?.wildcards?.length ? `<span><i class="wild"></i>Wildcard</span>` : "");

  $("log-count").textContent = `${p.decisions} swipes counted · ${p.likes} right, ${p.skips} left.`;
}

$("topics").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b) return;
  const t = b.dataset.topic;
  let mode = b.dataset.mode;
  if (mode === "mute" && adjust[t] === "mute") mode = "auto";
  if (mode === "mute" && myTopics().filter((x) => adjust[x] !== "mute").length <= 1) return toast("Keep at least one topic on");
  if (mode === "auto") delete adjust[t]; else adjust[t] = mode;
  store(K.adjust, adjust);
  renderInterests();
  toast(mode === "mute" ? `${TOPICS[t].short} muted from your next ten` : mode === "auto" ? `${TOPICS[t].short} back to automatic` : `${ADJ_LABEL[mode]} ${TOPICS[t].short} from your next ten`);
});

let resetArmed = false;
$("btn-reset").onclick = () => {
  const b = $("btn-reset");
  if (!resetArmed) {
    resetArmed = true;
    b.textContent = "Tap again to reset";
    setTimeout(() => { resetArmed = false; b.textContent = "Reset learning"; }, 3500);
    return;
  }
  resetArmed = false;
  b.textContent = "Reset learning";
  learnSince = Date.now();
  adjust = {};
  store(K.since, learnSince);
  store(K.adjust, adjust);
  renderInterests();
  toast("Learning reset. Your saved stories are kept.");
};

/* ---------- morning notification ---------- */
const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let swReg = null;
let pushState = { devices: 0, time: "07:30", publicKey: null, subscribed: false };

function b64ToBytes(b64) {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function renderNotify(message) {
  const on = pushState.subscribed && pushState.devices > 0;
  $("notify-pill").textContent = on ? "On" : "Off";
  $("notify-pill").className = `pill ${on ? "on" : ""}`;
  $("notify-time").value = pushState.time;
  $("notify-toggle").textContent = on ? "Turn off" : "Turn on";
  $("notify-toggle").classList.toggle("primary", !on);
  $("notify-test").hidden = !on;
  let status = on ? `Your top headline arrives at ${pushState.time} each morning.` : "Get your top headline each morning.";
  let canUse = true;
  if (!pushSupported) {
    canUse = false;
    status = isIOS && !standalone
      ? "On iPhone, add Tenner to your Home Screen first (Share, then Add to Home Screen). Open it from there to turn this on."
      : "This browser can't receive notifications.";
  } else if (Notification.permission === "denied") {
    canUse = false;
    status = "Notifications are blocked for Tenner. Turn them on in your phone's Settings, under Notifications.";
  }
  $("notify-toggle").disabled = !canUse;
  $("notify-time").disabled = !canUse;
  $("notify-status").textContent = message || status;
}

async function loadNotify() {
  if (!pushSupported || !key) return renderNotify();
  try {
    swReg = await navigator.serviceWorker.register("/sw.js");
    const [res, sub] = await Promise.all([api("/api/push"), swReg.pushManager.getSubscription()]);
    if (res.ok) Object.assign(pushState, await res.json());
    pushState.subscribed = !!sub;
    // This phone has a subscription the server forgot (e.g. after a new link): send it again.
    if (sub && !pushState.devices) await saveSubscription(sub);
  } catch (err) {
    if (err instanceof SignInError) return;
  }
  renderNotify();
}

async function saveSubscription(sub) {
  const res = await api("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), time: $("notify-time").value || pushState.time }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Server returned ${res.status}`);
  Object.assign(pushState, data, { subscribed: true });
}

$("notify-toggle").onclick = async () => {
  const btn = $("notify-toggle");
  btn.disabled = true;
  try {
    swReg = swReg || (await navigator.serviceWorker.register("/sw.js"));
    const existing = await swReg.pushManager.getSubscription();
    if (pushState.subscribed && existing) {
      await api("/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: existing.endpoint }) });
      await existing.unsubscribe();
      pushState.subscribed = false;
      pushState.devices = Math.max(0, pushState.devices - 1);
      renderNotify();
      return toast("Morning notification off");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return renderNotify(permission === "denied" ? undefined : "Tenner needs permission to send notifications. Tap Turn on again and choose Allow.");
    if (!pushState.publicKey) Object.assign(pushState, await (await api("/api/push")).json());
    const sub = existing || (await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(pushState.publicKey) }));
    await saveSubscription(sub);
    renderNotify();
    toast(`Done. See you at ${pushState.time}.`);
  } catch (err) {
    if (!(err instanceof SignInError)) renderNotify(`Couldn't turn notifications on: ${err.message}`);
  } finally {
    btn.disabled = false;
    if (!pushSupported) renderNotify();
  }
};

$("notify-time").addEventListener("change", async () => {
  const time = $("notify-time").value;
  if (!/^\d\d:\d\d$/.test(time)) return;
  pushState.time = time;
  if (!pushState.subscribed) return renderNotify();
  try {
    const res = await api("/api/push/time", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ time }) });
    if (res.ok) Object.assign(pushState, await res.json());
    renderNotify();
    toast(`Morning notification moved to ${pushState.time}`);
  } catch {}
});

$("notify-test").onclick = async () => {
  try {
    const res = await api("/api/push/test", { method: "POST" });
    const data = await res.json();
    toast(data.sent ? "Test sent. It should arrive in a few seconds." : "The test couldn't be delivered. Try turning notifications off and on again.");
  } catch (err) {
    if (!(err instanceof SignInError)) toast(err.message);
  }
};

// Tapping a notification while Tenner is open: make sure today's ten are loaded.
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type !== "tenner:refresh") return;
  (deck?.date !== londonDate() ? ensureDeck(true) : Promise.resolve()).then(checkInbox);
});

/* ---------- tabs, install hint, day change ---------- */
function show(view) {
  document.querySelectorAll("nav button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  ["today", "saved", "interests"].forEach((v) => ($("view-" + v).hidden = v !== view));
}
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => show(b.dataset.view)));

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
if (isIOS && !standalone && !load(K.install, false)) $("install").hidden = false;
$("install-close").onclick = () => { $("install").hidden = true; store(K.install, true); };

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !key) return;
  (deck && deck.date !== londonDate() ? ensureDeck(true) : Promise.resolve()).then(() => { checkInbox(); refreshFriendLikes(); });
});

function renderAll() { renderStack(); renderPips(); renderSaved(); renderInterests(); }

/* ---------- gate: shown when there's no valid invite link ---------- */
function showGate(err) {
  const kind = err?.kind || "signed-out";
  $("gate-title").textContent = kind === "paused" ? "Your access is paused." : "Tenner is invite-only.";
  $("gate-msg").textContent = kind === "paused"
    ? "Martin has paused your account for now. Your saved stories are still on this phone."
    : key
      ? "This invite link doesn't work any more. Ask Martin for a new one, then open it or paste it below."
      : "Open the invite link Martin sent you, or paste it below.";
  $("gate-form").hidden = kind === "paused";
  $("gate").hidden = false;
}

$("gate-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("gate-link").value.trim();
  const m = text.match(/\/u\/([\w-]{8,64})/) || (KEY_RE.test(text) ? [null, text] : null);
  if (!m) {
    $("gate-error").textContent = "That doesn't look like a Tenner invite link. It should contain /u/ followed by a code.";
    $("gate-error").hidden = false;
    return;
  }
  store(K.key, m[1]);
  // Drop any deck from a previous account so the new person's topics load.
  try { localStorage.removeItem(K.deck); } catch {}
  location.replace(`/u/${m[1]}`);
});

async function start() {
  renderSaved();
  renderInterests();
  renderOnline();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then((r) => (swReg = r)).catch(() => {});
  try { navigator.storage?.persist?.(); } catch {}
  if (!key) return showGate();
  try {
    const res = await api("/api/me");
    if (res.ok) {
      me = await res.json();
      $("signed-in").textContent = `Signed in as ${me.name}.`;
    }
  } catch (err) {
    if (err instanceof SignInError) return;
    // Offline: carry on with whatever is saved on the phone.
  }
  renderInterests();
  await ensureDeck();
  renderInterests();
  await checkInbox();
  refreshFriendLikes();
  loadNotify();
  flushActivity();
  backfillOffline();
}
start();
