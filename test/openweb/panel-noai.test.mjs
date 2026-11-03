// 2-in-1 product panel: the no-AI fallback rules used when no AI can check a picture (quota spent), and the range captions.
// Synthetic data only — no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleProductOk, ruleLogoOk, titleNames, commonsLogo, rangeName, AI_DOWN, NOT_AI_CHECKED } from "../../openweb/lib/panel-assets.mjs";

const official = (h) => h === "maggi.in" || h.endsWith(".maggi.in");
const base = { brand: "Maggi", product: "noodles", category: "Instant noodles and sauces", official, indianShops: ["amazon.in", "bigbasket.com"] };
const cut = { method: "plain-bg", w: 900, h: 700 };

test("no-AI rule: an Indian shop listing that names the brand and product, cut out, 400 px+ is accepted", () => {
  assert.deepEqual(ruleProductOk({ ...base, host: "www.amazon.in", title: "MAGGI 2-Minute Instant Noodles, Masala", cut }), { ok: true, problem: "" });
  assert.equal(ruleProductOk({ ...base, host: "maggi.in", title: "Maggi Masala Noodles pack", cut }).ok, true, "the brand's own site");
});

test("no-AI rule: wrong site, wrong title, failed cut-out or a small picture is refused", () => {
  assert.equal(ruleProductOk({ ...base, host: "pinterest.com", title: "Maggi noodles", cut }).ok, false);
  assert.equal(ruleProductOk({ ...base, host: "randomshop.in", title: "Maggi noodles", cut }).ok, false, "a .in site that is not a known shop");
  assert.equal(ruleProductOk({ ...base, host: "amazon.in", title: "Yippee noodles", cut }).ok, false, "another brand");
  assert.equal(ruleProductOk({ ...base, host: "amazon.in", title: "Maggi kitchen towel", cut }).ok, false, "brand but not the product");
  assert.equal(ruleProductOk({ ...base, host: "amazon.in", title: "Maggi noodles", cut: { method: "photo", w: 900, h: 900 } }).ok, false, "not cut out");
  assert.equal(ruleProductOk({ ...base, host: "amazon.in", title: "Maggi noodles", cut: { method: "plain-bg", w: 390, h: 300 } }).ok, false, "too small");
});

test("titleNames: brand and product or category by stem", () => {
  assert.equal(titleNames("MAGGI Atta Noodle 4-pack", "Maggi", "noodles"), true);
  assert.equal(titleNames("Nestle noodles", "Maggi", "noodles"), false);
});

test("no-AI logo rule: only the brand-knowledge logo or a Commons file named after the brand", () => {
  const known = { logo: { png: "https://upload.wikimedia.org/x/Amul.png" } };
  assert.equal(ruleLogoOk({ url: "https://upload.wikimedia.org/x/Amul.png" }, "Amul", known), true);
  assert.equal(ruleLogoOk({ url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Maggi_logo.svg/600px-Maggi_logo.svg.png" }, "Maggi", null), true);
  assert.equal(ruleLogoOk({ url: "https://upload.wikimedia.org/wikipedia/commons/a/a1/Nestle_logo.png" }, "Maggi", null), false, "another brand's file");
  assert.equal(ruleLogoOk({ url: "https://cdn.example.com/maggi-logo.png", title: "Maggi logo" }, "Maggi", null), false, "not Commons");
});

test("commonsLogo: picks the file whose name holds the brand and 'logo'", async () => {
  const fetchImpl = async () => ({ json: async () => ({ query: { pages: {
    1: { index: 1, title: "File:Nestle logo.svg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/n/600px-Nestle_logo.svg.png", url: "x" }] },
    2: { index: 2, title: "File:Maggi logo.svg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/m/600px-Maggi_logo.svg.png", url: "y", descriptionurl: "https://commons.wikimedia.org/wiki/File:Maggi_logo.svg" }] } } } }) });
  const r = await commonsLogo("Maggi", fetchImpl);
  assert.equal(r?.url, "https://upload.wikimedia.org/m/600px-Maggi_logo.svg.png");
  assert.equal(ruleLogoOk(r, "Maggi", null), true);
  assert.equal(await commonsLogo("Maggi", async () => ({ json: async () => ({}) })), null);
});

test("AI_DOWN matches quota errors, the flag text and range captions", () => {
  assert.match("All free Gemini models are out of quota for now", AI_DOWN);
  assert.match("got status: 429 RESOURCE_EXHAUSTED", AI_DOWN);
  assert.doesNotMatch("Checking the picture timed out", AI_DOWN);
  assert.equal(NOT_AI_CHECKED, "picture not AI-checked (AI quota) — verify");
  assert.equal(rangeName("MAGGI 2-Minute Instant Noodles, Masala Noodles with Goodness of Iron"), "MAGGI 2-Minute Instant Noodles");
});
