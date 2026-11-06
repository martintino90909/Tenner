import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, b64urlDecode, b64urlEncode, generateVapidKeys, vapidAuthorization } from "../lib/webpush.js";

// Worked example from RFC 8291, Section 5.
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("payload encryption matches the RFC 8291 worked example byte for byte", async () => {
  const out = await encryptPayload(
    { p256dh: RFC.uaPublic, auth: RFC.auth },
    b64urlDecode(RFC.plaintext),
    { server: { publicRaw: b64urlDecode(RFC.asPublic), privateRaw: b64urlDecode(RFC.asPrivate) }, salt: b64urlDecode(RFC.salt) }
  );
  assert.equal(b64urlEncode(out), RFC.message);
});

test("random keys and salt give a well-formed message", async () => {
  const out = await encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, "hello");
  assert.equal(out.length, 86 + 5 + 1 + 16, "header + text + delimiter + tag");
  assert.equal(out[20], 65);
});

test("VAPID header is a valid ES256 token for the push service's origin", async () => {
  const vapid = await generateVapidKeys();
  const h = await vapidAuthorization("https://web.push.apple.com/abc/def", vapid, { subject: "https://tenner.example", now: 1_800_000_000_000 });
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, h);
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2])));
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "https://tenner.example");
  assert.equal(claims.exp, 1_800_000_000 + 12 * 3600);
  assert.equal(m[4], vapid.publicKey);
  const pub = await crypto.subtle.importKey("raw", b64urlDecode(vapid.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlDecode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.ok(ok, "signature verifies with the public key");
});
