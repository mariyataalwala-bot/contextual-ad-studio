// Product pictures for the In-Image Studio: which pictures are tried (by kind), the bounded retry loop, and the run's
// recoverable "add the product photo" ending. The pictures here are stubs (no network, no AI) — the AI's classification
// and check answers are given in each test.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { productCandidates, tryProductPictures, PICTURE_KINDS, foreignSite } from "../../openweb/lib/studio.mjs";
import { createOpenWeb } from "../../openweb/routes.mjs";

const thumbs = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, url: `https://shop.example.test/p${i + 1}.jpg`, host: "shop.example.test", title: `P${i + 1}` }));
const pic = (n, kind, exact = true) => ({ n, kind, exact });

// ---------- which pictures are tried ----------
test("candidates: clean packshots first, then the product on a background; promotional banners and irrelevant pictures are never tried", () => {
  const pick = { packshot: 1, packshot_ranked: [1, 2, 3, 4], pictures: [pic(1, "promo_banner"), pic(2, "product_on_background"), pic(3, "cutout"), pic(4, "irrelevant"), pic(5, "cutout", false)] };
  const c = productCandidates(pick, thumbs(5));
  assert.deepEqual(c.map((x) => [x.n, x.kind]), [[3, "cutout"], [2, "product_on_background"]], "the banner the AI ranked first is not tried; a picture of another variant (exact: false) neither");
  assert.deepEqual(PICTURE_KINDS, ["cutout", "product_on_background", "lifestyle", "promo_banner", "irrelevant"]);
});
test("candidates: lifestyle photos only where the design shows them as a scene (food, drinks, services) — and last", () => {
  const pick = { packshot: 1, packshot_ranked: [1, 2], pictures: [pic(1, "lifestyle"), pic(2, "product_on_background")] };
  assert.deepEqual(productCandidates(pick, thumbs(2)).map((x) => x.n), [2], "a phone in someone's hand is not a product picture");
  assert.deepEqual(productCandidates(pick, thumbs(2), { lifestyleOk: true }).map((x) => x.n), [2, 1]);
});
test("candidates: the same address is tried once; at most `max`; an answer without classes falls back to the AI's ranking", () => {
  const t = thumbs(8); t[1].url = t[0].url;
  const pick = { packshot: 1, packshot_ranked: [1, 2, 3, 4, 5, 6, 7, 8], pictures: t.map((x) => pic(x.n, "cutout")) };
  const c = productCandidates(pick, t, { max: 4 });
  assert.equal(c.length, 4); assert.equal(new Set(c.map((x) => x.url)).size, 4);
  assert.deepEqual(productCandidates({ packshot: 3, packshot_ranked: [3, 1] }, thumbs(3)).map((x) => x.n), [3, 1]);
  assert.deepEqual(productCandidates({ packshot: 0, packshot_ranked: [], pictures: [pic(1, "promo_banner"), pic(2, "irrelevant")] }, thumbs(2)), [], "nothing suitable → nothing to try");
});

test("market: the brand's sites for other countries are never a source of product pictures (Domino's Estonia or France for an Indian ad)", () => {
  for (const h of ["media.dominospizza.ee", "www.dominos.fr", "www.tesco.co.uk", "shop.example.com.au"]) assert.ok(foreignSite(h), h);
  for (const h of ["www.dominos.co.in", "amazon.in", "api.pizzahut.io", "www.dominos.com", "b.zmtcdn.com"]) assert.ok(!foreignSite(h), h);
});

// ---------- the bounded retry loop ----------
const got = (n, extra = {}) => ({ x: { url: `https://shop.example.test/p${n}.jpg`, kind: "cutout", ...extra.x }, f: extra.f === undefined ? `/tmp/p${n}.jpg` : extra.f, via: "site", hash: extra.hash || `h${n}` });
const harness = (answers) => {
  const log = [];
  return { log,
    prepare: async (g, mode) => { log.push(`${g.x.url.slice(-6)}:${mode}`); return { method: mode === "photo" ? "photo" : "alpha", preview: "p.jpg" }; },
    check: async (g, c) => { const a = answers[g.x.url.slice(-6)]; return typeof a === "function" ? a(c) : a || { ok: false, kind: "irrelevant", problem: "not this product", picture_problem: true }; } };
};
test("retry loop: a clean packshot passes on the first check", async () => {
  const h = harness({ "p1.jpg": { ok: true, kind: "cutout" } });
  const r = await tryProductPictures([got(1), got(2)], h);
  assert.equal(r.got.x.url, "https://shop.example.test/p1.jpg"); assert.deepEqual(h.log, ["p1.jpg:auto"]); assert.equal(r.checks.length, 1);
});
test("retry loop: a banner or lifestyle picture rejected for its content goes straight to the next picture (no second try of the same one)", async () => {
  const h = harness({ "p1.jpg": { ok: false, kind: "promo_banner", problem: "price text over the picture", picture_problem: true }, "p2.jpg": { ok: true } });
  const r = await tryProductPictures([got(1), got(2)], h);
  assert.deepEqual(h.log, ["p1.jpg:auto", "p2.jpg:auto"]); assert.equal(r.got.x.url.slice(-6), "p2.jpg");
  assert.equal(r.checks[0].kind, "promo_banner");
});
test("retry loop: a rejected cut-out of a real product picture → its original photo is checked once (the cut-out may have damaged it)", async () => {
  const h = harness({ "p1.jpg": (c) => c.method === "photo" ? { ok: true, kind: "product_on_background" } : { ok: false, kind: "cutout", problem: "the spatula holding the slice was removed — a floating slice", picture_problem: true } });
  const r = await tryProductPictures([got(1)], h);
  assert.deepEqual(h.log, ["p1.jpg:auto", "p1.jpg:photo"]); assert.equal(r.c.method, "photo");
});
test("retry loop: lifestyle pictures are never cut out", async () => {
  const h = harness({ "p1.jpg": { ok: true, kind: "lifestyle" } });
  await tryProductPictures([got(1, { x: { kind: "lifestyle" } })], h);
  assert.deepEqual(h.log, ["p1.jpg:photo"]);
});
test("retry loop: unavailable addresses and repeated pictures (same address or same bytes) are skipped, not checked", async () => {
  const h = harness({ "p4.jpg": { ok: true } });
  const dup = got(3, { hash: "h2" });   // a different address serving the same file as p2
  const r = await tryProductPictures([got(1, { f: null }), got(2), dup, got(2), got(4)], h);
  assert.deepEqual(h.log, ["p2.jpg:auto", "p4.jpg:auto"]);
  assert.match(r.checks[0].skipped, /could not be downloaded/);
  assert.equal(r.checks.filter((c) => /already checked/.test(c.skipped || "")).length, 2);
  assert.equal(r.got.x.url.slice(-6), "p4.jpg");
});
test("retry loop: no valid picture → nothing chosen, after at most maxTries checks; out of time → the rest are not tried", async () => {
  const h = harness({});
  const r = await tryProductPictures([1, 2, 3, 4, 5, 6, 7].map((n) => got(n)), { ...h, maxTries: 3 });
  assert.equal(r.got, null); assert.equal(h.log.length, 3);
  assert.equal(r.checks.filter((c) => /limit of 3 checks/.test(c.skipped || "")).length, 4);
  const h2 = harness({}); let n = 0;
  const r2 = await tryProductPictures([1, 2, 3].map((k) => got(k)), { ...h2, outOfTime: () => ++n > 1 });
  assert.equal(h2.log.length, 1); assert.equal(r2.checks.filter((c) => /time for this step/.test(c.skipped || "")).length, 2);
});

// ---------- the user's own product photo ----------
test("studio start: an uploaded product photo must be a PNG, JPEG or WebP picture", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-prod-"));
  const ow = createOpenWeb({ dataDir: path.join(dir, "data"), studioDir: path.join(dir, "inimage") });
  const srv = http.createServer((req, res) => ow.handle(req, res, new URL(req.url, "http://x"), { local: true }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(null)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  const start = (productUpload) => fetch(base + "/api/ow/studio/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: "Testbrand", product: "pizza", productUpload }) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  try {
    for (const data of ["data:text/plain;base64," + Buffer.from("not a picture").toString("base64"), "data:image/gif;base64," + Buffer.from("GIF89a....").toString("base64")]) {
      const r = await start({ name: "x", data });
      assert.equal(r.status, 400); assert.match(r.json.error, /PNG, JPEG or WebP/);
    }
    const png = await start({ name: "p.png", data: "data:image/png;base64," + Buffer.from("\x89PNG\r\n\x1a\n....", "latin1").toString("base64") });
    assert.doesNotMatch(png.json.error || "", /PNG, JPEG or WebP/, "a PNG is accepted (this test app then stops for want of an AI key)");
    assert.match(png.json.error, /AI key/);
  } finally { srv.close(); }
});
