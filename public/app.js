// Tenner: ten news stories a day as swipeable cards.
// Phase 1: real feeds, swipe, open, save. Every action is logged on this phone
// so Phase 3 can learn from it.

const TOPICS = {
  tech: { name: "Tech & engineering", short: "Tech", c: "var(--t-tech)" },
  biz: { name: "Business & markets", short: "Business", c: "var(--t-biz)" },
  cars: { name: "Cars & motorsport", short: "Cars", c: "var(--t-cars)" },
  world: { name: "UK & world", short: "UK & world", c: "var(--t-world)" },
};
const TOPIC_KEYS = Object.keys(TOPICS);
const K = { deck: "tenner.deck", saved: "tenner.saved", log: "tenner.log", install: "tenner.installDismissed" };
const LOG_LIMIT = 2000;

/* ---------- storage ---------- */
const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let deck = load(K.deck, null);
let saved = load(K.saved, []);
let log = load(K.log, []);

function record(story, kind, extra = {}) {
  log.push({ id: story.id, topic: story.topic, source: story.source, kind, t: Date.now(), ...extra });
  if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT);
  store(K.log, log);
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

/* ---------- loading today's ten ---------- */
async function fetchToday() {
  const res = await fetch("/api/today", { cache: "no-store" });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data = await res.json();
  if (!data.deck?.length) throw new Error("No stories came back from the feeds");
  return data;
}

async function ensureDeck(force = false) {
  const today = londonDate();
  if (!force && deck && deck.date === today && deck.cards?.length) return renderAll();
  renderLoading();
  try {
    const data = await fetchToday();
    deck = { date: data.date, cards: data.deck, pool: data.pool || [], index: 0, results: {}, shown: data.deck.map((c) => c.id), round: 1 };
    store(K.deck, deck);
    renderAll();
  } catch (err) {
    renderError(err);
  }
}

// "10 more": next batch from today's pool, balanced and interleaved by topic.
function dealMore() {
  const shown = new Set(deck.shown);
  const byTopic = {};
  TOPIC_KEYS.forEach((t) => (byTopic[t] = deck.pool.filter((s) => s.topic === t && !shown.has(s.id))));
  const next = [];
  while (next.length < 10 && TOPIC_KEYS.some((t) => byTopic[t].length)) {
    for (const t of TOPIC_KEYS) {
      const s = byTopic[t].shift();
      if (s && next.length < 10) next.push(s);
    }
  }
  if (!next.length) return toast("That's every story from today's feeds");
  deck.cards = next;
  deck.index = 0;
  deck.results = {};
  deck.shown.push(...next.map((s) => s.id));
  deck.round = (deck.round || 1) + 1;
  store(K.deck, deck);
  renderAll();
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
      <div class="meta"><span>${esc(s.source)}</span>${s.published ? `<span>·</span><span>${ago(s.published)}</span>` : ""}</div>
      <h2 class="headline">${esc(s.title)}</h2>
      ${s.summary ? `<p class="summary">${esc(s.summary)}</p>` : ""}
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

/* ---------- article sheet ---------- */
function openSheet(story) {
  const tp = TOPICS[story.topic] || TOPICS.world;
  record(story, "open");
  $("sheet").innerHTML = `
    <div class="grab"></div>
    ${story.image ? `<img src="${esc(story.image)}" alt="" referrerpolicy="no-referrer">` : ""}
    <div class="meta"><span style="color:${tp.c};font-weight:600">${tp.name}</span><span>·</span><span>${esc(story.source)}</span>${story.published ? `<span>·</span><span>${ago(story.published)}</span>` : ""}</div>
    <h2 class="headline" id="sheet-h">${esc(story.title)}</h2>
    ${story.summary ? `<p>${esc(story.summary)}</p>` : ""}
    <div class="btn-row">
      <a class="btn primary" id="read-link" href="${esc(story.link)}" target="_blank" rel="noopener">Read on ${esc(story.source)}</a>
      <button class="btn" id="sheet-close">Back to cards</button>
    </div>`;
  $("sheet").querySelector("img")?.addEventListener("error", (e) => e.target.remove());
  $("scrim").hidden = false;
  $("sheet").hidden = false;
  $("read-link").onclick = () => record(story, "read");
  $("sheet-close").onclick = closeSheet;
  $("read-link").focus();
}
function closeSheet() { $("scrim").hidden = true; $("sheet").hidden = true; }
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
        <a href="${esc(s.link)}" target="_blank" rel="noopener"><h3>${esc(s.title)}</h3><small>${tp.short} · ${esc(s.source)}</small></a>
        <button data-id="${esc(s.id)}" aria-label="Remove from saved">Remove</button></div>`;
    })
    .join("");
  list.querySelectorAll("button[data-id]").forEach((b) => (b.onclick = () => {
    const s = saved.find((x) => x.id === b.dataset.id);
    if (s) toggleSave(s);
    if (deck) renderStack();
  }));
}

/* ---------- Interests (Phase 1: raw counts) ---------- */
function finalDecisions() {
  const last = new Map();
  for (const e of log) {
    if (e.kind === "like" || e.kind === "skip") last.set(e.id, e);
    else if (e.kind === "undo") last.delete(e.id);
  }
  return [...last.values()];
}

function renderInterests() {
  const decided = finalDecisions();
  const count = (t, kind) =>
    kind === "save"
      ? saved.filter((s) => s.topic === t).length
      : decided.filter((e) => e.topic === t && e.kind === kind).length;
  $("topics").innerHTML = TOPIC_KEYS.map((t) => {
    const tp = TOPICS[t], l = count(t, "like"), s = count(t, "skip"), sv = count(t, "save"), total = l + s || 1;
    return `<div class="trow" style="--c:${tp.c}">
      <div class="name"><span class="dot"></span>${tp.name}</div>
      <div class="counts">${l} yes · ${s} no · ${sv} saved</div>
      <div class="split"><span class="l" style="width:${(l / total) * 100}%"></span><span class="s" style="width:${(s / total) * 100}%"></span></div>
    </div>`;
  }).join("");

  const bySource = {};
  [...decided.filter((e) => e.kind === "like"), ...saved].forEach((e) => (bySource[e.source] = (bySource[e.source] || 0) + 1));
  const top = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 8);
  $("sources").innerHTML = top.length
    ? top.map(([n, v]) => `<span>${esc(n)}<b>${v}</b></span>`).join("")
    : `<span>None yet</span>`;
  const decisions = decided.length;
  $("log-count").textContent = `${decisions} swipes recorded on this phone.`;
}

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

renderSaved();
renderInterests();
ensureDeck();
