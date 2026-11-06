// Tenner: ten news stories a day as swipeable cards.
// Phase 1: real feeds, swipe, open, save. Every action is logged on this phone
// so Phase 3 can learn from it.

import { buildProfile, personalise, keywords, highlights, COLD_START } from "/learn.js";

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
const K = { deck: "tenner.deck", saved: "tenner.saved", log: "tenner.log", install: "tenner.installDismissed", key: "tenner.key", pending: "tenner.pendingActivity", adjust: "tenner.adjust", since: "tenner.learnSince" };
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
  if (!key || !(pending.swipes || pending.opens || pending.reads)) return;
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
    deck = {
      date: data.date, topics: data.topics, cards: ten.cards, wildcards: ten.wildcards, personalised: ten.personalised,
      pool, index: 0, results: {}, shown: ten.cards.map((c) => c.id), round: 1,
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
      <div class="meta"><span>${esc(s.source)}</span>${s.published ? `<span>·</span><span>${ago(s.published)}</span>` : ""}${deck?.wildcards?.includes(s.id) ? `<span class="wild-tag" title="Something outside your usual picks">Wildcard</span>` : ""}</div>
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
      <h2>Couldn't load today's news.</h2>
      <p>${esc(err.message)}. Check you're online, then try again.</p>
      <div class="btn-row"><button class="btn primary" id="retry">Try again</button></div>
    </div>`;
  $("retry").onclick = () => ensureDeck(true);
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

function toggleSave(story) {
  const i = saved.findIndex((x) => x.id === story.id);
  if (i === -1) {
    saved.unshift({ ...story, savedAt: Date.now() });
    record(story, "save");
    toast("Saved for later");
  } else {
    saved.splice(i, 1);
    record(story, "unsave");
    toast("Removed from saved");
  }
  store(K.saved, saved);
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
  };
  try {
    let a = articleCache.get(story.link);
    if (!a) {
      const res = await api(`/api/article?url=${encodeURIComponent(story.link)}`);
      a = await res.json().catch(() => ({ ok: false, reason: `Server returned ${res.status}` }));
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
  } catch (err) {
    done(`<div class="reader-fail"><p><b>Couldn't show the full story here.</b> ${esc(err.message)}.</p>
      <a class="btn primary" href="${esc(story.link)}" target="_blank" rel="noopener">Read on ${esc(story.source)}</a></div>`);
  }
}

function setReaderSave() {
  const b = $("reader-save");
  if (b && reading) b.setAttribute("aria-pressed", String(saved.some((x) => x.id === reading.story.id)));
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
      <button class="icon-btn save-toggle" id="reader-save" aria-label="Save for later" aria-pressed="false">${BOOKMARK}</button>
    </div>
    <div class="reader-scroll" id="reader-scroll">
      <div class="reader-inner">
        ${story.image ? `<img class="reader-img" src="${esc(story.image)}" alt="" referrerpolicy="no-referrer">` : ""}
        <h2 class="reader-title" id="sheet-h">${esc(story.title)}</h2>
        ${story.summary ? `<p class="reader-lede" id="reader-lede">${esc(story.summary)}</p>` : ""}
        <div class="why" data-why="${esc(story.id)}">${whyHTML(story)}</div>
        <div class="article" id="article" aria-busy="true">
          <div class="bar" style="width:96%"></div><div class="bar" style="width:90%"></div><div class="bar" style="width:93%"></div><div class="bar" style="width:60%"></div>
          <div class="bar" style="width:94%;margin-top:14px"></div><div class="bar" style="width:88%"></div><div class="bar" style="width:72%"></div>
        </div>
        <div class="reader-foot">
          <a class="btn" href="${esc(story.link)}" target="_blank" rel="noopener" id="reader-orig">Open on ${esc(story.source)}</a>
        </div>
      </div>
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
  $("reader-close").focus();
}

function closeSheet() {
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
        <button class="saved-open" data-open="${esc(s.id)}"><h3>${esc(s.title)}</h3><small>${tp.short} · ${esc(s.source)}</small></button>
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

/* ---------- You: what Tenner has learned ---------- */
const ADJ_LABEL = { less: "Less", auto: "Auto", more: "More" };

function renderInterests() {
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
  if (e.data?.type === "tenner:refresh" && deck?.date !== londonDate()) ensureDeck(true);
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
  if (document.visibilityState === "visible" && deck && deck.date !== londonDate()) ensureDeck(true);
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
  loadNotify();
  flushActivity();
}
start();
