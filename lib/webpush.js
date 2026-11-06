// Standard Web Push (RFC 8291 payload encryption + RFC 8292 VAPID), built on
// WebCrypto so it runs in Cloudflare Workers with no extra packages.
// Works with Apple (iPhone Home Screen apps), Google and Mozilla push services.

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export function b64urlEncode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hmac(key, data) {
  const k = await subtle().importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle().sign("HMAC", k, data));
}

// A P-256 key from its raw public point (65 bytes) and optional private scalar (32 bytes).
function p256Jwk(publicRaw, privateRaw) {
  const jwk = { kty: "EC", crv: "P-256", x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33, 65)), ext: true };
  if (privateRaw) jwk.d = b64urlEncode(privateRaw);
  return jwk;
}

/**
 * Encrypts a push message for one subscription (RFC 8291, aes128gcm).
 * `server` and `salt` can be passed in for testing; normally both are random.
 */
export async function encryptPayload(subscriptionKeys, plaintext, { server, salt } = {}) {
  const uaPublic = b64urlDecode(subscriptionKeys.p256dh);
  const authSecret = b64urlDecode(subscriptionKeys.auth);
  const body = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
  salt = salt || crypto.getRandomValues(new Uint8Array(16));

  let asPrivate, asPublic;
  if (server) {
    asPublic = server.publicRaw;
    asPrivate = await subtle().importKey("jwk", p256Jwk(server.publicRaw, server.privateRaw), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  }

  const uaKey = await subtle().importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);

  const aesKey = await subtle().importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(body, new Uint8Array([2])); // 0x02 = last (only) record
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ciphertext);
}

/* ---------- VAPID (who is sending) ---------- */

export async function generateVapidKeys() {
  const pair = await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = b64urlEncode(await subtle().exportKey("raw", pair.publicKey));
  const privateJwk = await subtle().exportKey("jwk", pair.privateKey);
  return { publicKey, privateJwk };
}

export async function vapidAuthorization(endpoint, vapid, { subject, now = Date.now() } = {}) {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await subtle().importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

/**
 * Sends one notification. Returns { ok, status, gone } — `gone` means the
 * subscription has expired or been revoked and should be deleted.
 */
export async function sendPush(subscription, payload, vapid, { subject, ttl = 12 * 3600, topic } = {}) {
  const body = await encryptPayload(subscription.keys, JSON.stringify(payload));
  const headers = {
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(ttl),
    urgency: "normal",
    authorization: await vapidAuthorization(subscription.endpoint, vapid, { subject }),
  };
  if (topic) headers.topic = topic;
  let res;
  try {
    res = await fetch(subscription.endpoint, { method: "POST", headers, body });
  } catch (err) {
    return { ok: false, status: 0, gone: false, error: String(err?.message || err) };
  }
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
