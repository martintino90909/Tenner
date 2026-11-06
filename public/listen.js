// Listen mode: reads a story aloud with the phone's built-in voice.
// Speaks one paragraph (or a few sentences) at a time, because long single
// utterances get cut off on some phones and short ones make pause, skip and
// "resume where you left off" reliable.

export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
export const RATES = [1, 1.25, 1.5, 0.85];

// Splits long text into chunks of whole sentences, about `max` characters each.
export function chunk(text, max = 260) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const sentences = clean.split(/(?<=[.!?…]["”’)]?)\s+(?=["“‘(A-Z0-9])/);
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + " " + s).length > max) { out.push(cur); cur = s; }
    else cur = cur ? cur + " " + s : s;
  }
  if (cur) out.push(cur);
  return out;
}

// Best available British voice: enhanced/premium local voices first.
export function pickVoice(voices) {
  const score = (v) =>
    (v.lang === "en-GB" ? 40 : v.lang?.startsWith("en") ? 10 : 0) +
    (/premium|enhanced|natural|neural/i.test(v.name) ? 20 : 0) +
    (v.localService ? 5 : 0) +
    (/daniel|serena|kate|arthur|martha|google uk english/i.test(v.name) ? 3 : 0) +
    (/novelty|whisper|bells|bubbles|cellos|organ|zarvox|trinoids|bad news|good news|jester|superstar|albert|fred|junior|ralph/i.test(v.name) ? -100 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0] || null;
}

/**
 * Creates a player. `parts` are { text, el } — el is the element to highlight.
 * onChange(state) is called whenever playback state changes.
 */
export function createPlayer({ onChange = () => {}, onFinish = () => {} } = {}) {
  const synth = canSpeak ? window.speechSynthesis : null;
  let parts = [];
  let i = 0;
  let playing = false;
  let rateIndex = 0;
  let token = 0;
  let voice = null;
  let wakeLock = null;
  let startedAt = 0;
  let listenedMs = 0;

  const loadVoice = () => { if (synth) voice = pickVoice(synth.getVoices()); };
  loadVoice();
  synth?.addEventListener?.("voiceschanged", loadVoice);

  const state = () => ({ playing, index: i, total: parts.length, rate: RATES[rateIndex], current: parts[i] || null, listenedMs: listenedMs + (playing ? Date.now() - startedAt : 0) });
  const emit = () => onChange(state());

  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { wakeLock = null; }
  }

  function speak() {
    if (!synth) return;
    const my = ++token;
    synth.cancel();
    if (i >= parts.length) {
      stopClock();
      playing = false;
      i = 0;
      keepAwake(false);
      emit();
      onFinish(state());
      return;
    }
    const u = new SpeechSynthesisUtterance(parts[i].text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || "en-GB";
    u.rate = RATES[rateIndex];
    u.onend = () => { if (my === token && playing) { i++; speak(); } };
    u.onerror = (e) => {
      if (my !== token || e.error === "interrupted" || e.error === "canceled") return;
      playing = false; stopClock(); keepAwake(false); emit();
    };
    emit();
    // Safari sometimes drops an utterance queued in the same tick as cancel().
    setTimeout(() => { if (my === token) synth.speak(u); }, 60);
  }

  function stopClock() { if (startedAt) { listenedMs += Date.now() - startedAt; startedAt = 0; } }

  return {
    get state() { return state(); },
    load(newParts) { this.stop(); parts = newParts.filter((p) => p.text); i = 0; listenedMs = 0; emit(); },
    play() {
      if (!synth || !parts.length) return;
      playing = true;
      startedAt = Date.now();
      keepAwake(true);
      speak();
    },
    pause() {
      if (!playing) return;
      playing = false;
      token++;
      synth?.cancel();
      stopClock();
      keepAwake(false);
      emit();
    },
    toggle() { playing ? this.pause() : this.play(); },
    skip(delta) {
      i = Math.max(0, Math.min(parts.length - 1, i + delta));
      playing ? speak() : emit();
    },
    jumpTo(index) { i = Math.max(0, Math.min(parts.length - 1, index)); if (!playing) this.play(); else speak(); },
    cycleRate() {
      rateIndex = (rateIndex + 1) % RATES.length;
      playing ? speak() : emit(); // restart the current chunk at the new speed
    },
    stop() {
      const was = playing || i > 0 || listenedMs > 0;
      playing = false;
      token++;
      synth?.cancel();
      stopClock();
      keepAwake(false);
      const s = state();
      i = 0;
      emit();
      return was ? s : null;
    },
  };
}
