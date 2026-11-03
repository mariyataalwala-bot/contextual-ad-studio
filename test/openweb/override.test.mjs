// "Place anyway (I approve)" for In-Image: only celebrity / rival refusals can be approved, for one article + picture
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createOpenWeb } from "../../openweb/routes.mjs";
import { overridable, overrideOffer, OVERRIDE_KINDS, OVERRIDE_LABEL } from "../../openweb/lib/studio.mjs";

const cand = (kinds, extra = {}) => ({ a: { url: "https://x.in/a", headline: "Ronaldo's watch" }, s: { section: "lifestyle" }, im: { src: "https://x.in/p.jpg" }, score: 8,
  v: { safe: false, article_safe: true, context_fit: 8, refusal_kinds: kinds, safe_why: "celebrity face", ...extra } });

test("override: only a candidate refused for celebrity and/or rival context is overridable", () => {
  assert.deepEqual(OVERRIDE_KINDS, ["celebrity", "rival"]);
  assert.match(OVERRIDE_LABEL, /manually approved: celebrity \/ rival context/);
  assert.ok(overridable(cand(["celebrity"])));
  assert.ok(overridable(cand(["celebrity", "rival"])));
  for (const k of [["tragedy"], ["celebrity", "crime"], ["illness"], ["negative_product"], []]) assert.ok(!overridable(cand(k)), k.join());
  assert.ok(overridable(cand(["celebrity", "rival"], { article_safe: false })), "the kinds decide, not article_safe (the AI marks a rival article unsafe too)");
  assert.ok(!overridable(cand(["celebrity"], { safe: true })), "nothing to override");
  assert.ok(!overridable(cand(["rival"], { context_fit: 3 }), { minContext: 6 }), "a weak fit is not offered");
});

test("override: the offer is the closest overridable candidate, with its reasons", () => {
  const o = overrideOffer([cand(["tragedy"], { }), { ...cand(["rival", "celebrity", "rival"]), score: 7 }], {});
  assert.deepEqual(o, { article: "https://x.in/a", image: "https://x.in/p.jpg", headline: "Ronaldo's watch", section: "lifestyle", reasons: ["rival", "celebrity"], why: "celebrity face" });
  assert.equal(overrideOffer([cand(["crime"])], {}), null);
});

test("studio start: overrideArticle / overrideImage must be https links and the studio's own creative", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-ov-"));
  const ow = createOpenWeb({ dataDir: path.join(dir, "data"), studioDir: path.join(dir, "inimage") });
  const srv = http.createServer((req, res) => ow.handle(req, res, new URL(req.url, "http://x"), { local: true }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(null)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  const start = (b) => fetch(base + "/api/ow/studio/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: "Testbrand", product: "watch", ...b }) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  try {
    let r = await start({ overrideArticle: "http://x.in/a", overrideImage: "https://x.in/p.jpg" });
    assert.equal(r.status, 400); assert.match(r.json.error, /Place anyway needs/);
    r = await start({ overrideArticle: "https://x.in/a" });
    assert.equal(r.status, 400); assert.match(r.json.error, /Place anyway needs/);
    r = await start({ overrideArticle: "https://x.in/a", overrideImage: "https://x.in/p.jpg" });
    assert.doesNotMatch(r.json.error || "", /Place anyway/, "a valid override is accepted (this test app then stops for want of an AI key)");
    assert.match(r.json.error, /AI key/);
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
