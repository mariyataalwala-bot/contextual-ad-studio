// 2-in-1 ads: reading the client's video — frames are sampled across the ad and at its end card, and the AI's answer
// carries a separate "other brand" so a missing logo is not mistaken for a wrong brand.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { identifyClientVideo, brandDecision } from "../../openweb/lib/twoinone.mjs";

test("brand decision: the right brand passes; another advertiser is rejected; no brand visible is held for the client's confirmation, never placed silently", () => {
  assert.equal(brandDecision({ matches_brand: true, brand_seen: "Airtel" }, { brand: "Airtel" }).action, "ok");
  const wrong = brandDecision({ matches_brand: false, brand_seen: "Kissht", other_brand: "Kissht", evidence: "kissht logo" }, { brand: "Airtel" });
  assert.equal(wrong.action, "wrong"); assert.match(wrong.message, /shows “Kissht”/);
  const none = { matches_brand: false, brand_seen: "", other_brand: "" };
  const held = brandDecision(none, { brand: "Airtel" });
  assert.equal(held.action, "review"); assert.match(held.message, /not placed/);
  const ok = brandDecision(none, { brand: "Airtel", confirmed: true });
  assert.equal(ok.action, "client_confirmed"); assert.match(ok.message, /client confirmed/);
  assert.equal(brandDecision({ matches_brand: false, other_brand: "Jio" }, { brand: "Airtel", confirmed: true }).action, "wrong", "a confirmation never overrides a different brand on screen");
});
import { fakeAsk } from "./helpers.mjs";

test("identify: six frames are read, the last one near the end card, and the question asks for a different advertiser separately", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-id-")), times = [];
  const ffmpeg = async (/** @type {string[]} */ a) => { times.push(+a[a.indexOf("-ss") + 1]); fs.writeFileSync(a.at(-1), "jpg"); };
  const ask = fakeAsk({ brand_seen: "Airtel", matches_brand: true, other_brand: "", is_ad: true, product_seen: "SIM", campaign: "Bheed mein bhi speed", evidence: "logo at the end" }, /** @type {any} */ ({ image: { brand_seen: "Airtel", matches_brand: true, other_brand: "", is_ad: true, product_seen: "SIM", campaign: "Bheed mein bhi speed", evidence: "logo at the end" } }));
  const r = await identifyClientVideo({ ask, ffmpeg, file: "x.mp4", duration: 30, brand: "Airtel", product: "Postpaid", known: null, dir });
  assert.equal(times.length, 6); assert.ok(Math.abs(times.at(-1) - 29.3) < 0.01, "the last frame is 0.7 s before the end");
  assert.equal(r.frames.length, 6); assert.equal(r.matches_brand, true);
  assert.match(ask.calls[0].text, /other_brand: a DIFFERENT advertiser/); assert.match(ask.calls[0].text, /an absence of any logo is not a different brand/);
  assert.equal(ask.calls[0].images.length, 6);
});
test("identify: a video whose frames cannot be read at all is an error, not a pass", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-id-"));
  await assert.rejects(() => identifyClientVideo({ ask: fakeAsk({}), ffmpeg: async () => { throw new Error("no"); }, file: "x.mp4", duration: 10, brand: "A", product: "B", known: null, dir }), /No frames could be read/);
});
