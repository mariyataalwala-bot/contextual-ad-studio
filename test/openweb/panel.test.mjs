// 2-in-1 ads: the 9:16 unit (16:9 video on top, animated product panel in the rest) and the product panel's inputs.
// Synthetic data only — no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { previewHtml, contrast } from "../../openweb/lib/twoinone-preview.mjs";
import { preparePanel } from "../../openweb/lib/panel-assets.mjs";
import { loadStudioConfig } from "../../openweb/lib/studio.mjs";
import { fakeAsk } from "./helpers.mjs";

/** @type {any} */
const base = { brand: "Dell", product: "laptop", publisher: "Indian Express", article: { headline: "A headline", url: "https://x.test/a", published: "2026-10-27T00:00:00Z", paragraphs: ["One long enough paragraph of article text.", "Two.", "Three.", "Four."], hero: null },
  video: { kind: "youtube", id: "dQw4w9WgXcQ", title: "Dell TVC" },
  panel: { colour: "#0076ce", accent: "#ffd21f", logo: "/api/ow/twoinone/file?path=d%2Flogo.png", product: "/api/ow/twoinone/file?path=d%2Fproduct.png", productMode: "cut", headline: "Matches your vibe", subline: "Discover the new Dell 14S", cta: "Buy now", ctaUrl: "https://www.dell.com", productName: "Dell 14S" } };

test("unit: a 9:16 card with the 16:9 video on top and the product panel in the rest of the space", () => {
  const h = previewHtml(base);
  assert.match(h, /\.unit\{[^}]*aspect-ratio:9\/16/); assert.match(h, /\.vid\{[^}]*aspect-ratio:16\/9/); assert.match(h, /\.phone\{[^}]*aspect-ratio:9\/16/, "the phone screen it sits in is 9:16 too");
  assert.ok(h.indexOf('class="vid"') < h.indexOf('class="disp"'), "video first, panel under it");
  assert.match(h, /\.disp\{flex:1/, "the panel takes everything the video leaves");
});
test("panel: headline words, subline, button, logo and product are there and animated; the opening shows the logo and product first", () => {
  const h = previewHtml(base);
  for (const w of ["Matches", "your", "vibe"]) assert.ok(h.includes(`<i style="--k:`) && h.includes(`>${w}</i>`), w);
  assert.ok(h.includes("Discover the new Dell 14S") && h.includes("Buy now") && h.includes('class="pprod cut"') && h.includes('class="plogo"') && h.includes('class="intro"') && h.includes('class="il"'));
  for (const k of ["@keyframes rise", "@keyframes prodIn", "@keyframes floaty", "@keyframes pop", "@keyframes sheen"]) assert.ok(h.includes(k), k);
  assert.match(h, /prefers-reduced-motion/, "motion is switched off for people who ask for that");
  assert.match(h, /--btn:#ffd21f/, "the accent colour is used for the button when it stands out on the panel");
});
test("panel: without a logo the brand name is the wordmark; without a product picture it is a brand panel; a client's finished picture replaces the animated panel", () => {
  const noPic = previewHtml({ ...base, panel: { ...base.panel, logo: null, product: null } });
  assert.ok(noPic.includes('class="plogo word"') && noPic.includes(">Dell</div>") && !noPic.includes('class="pprod') && noPic.includes('class="pn k-nop"'));
  const img = previewHtml({ ...base, panel: { image: "/api/ow/twoinone/file?path=d%2Fdisplay.png", productName: "x" } });
  assert.ok(img.includes('class="pn img"') && img.includes('class="dimg"') && !img.includes('class="ptxt"'));
  const photo = previewHtml({ ...base, panel: { ...base.panel, productMode: "photo" } });
  assert.ok(photo.includes('class="pprod photo"'));
});
test("panel: colours are validated; a bad one falls back and a low-contrast accent is not used for the button", () => {
  assert.ok(previewHtml({ ...base, panel: { ...base.panel, colour: "red;}</style>" } }).includes("--c:#101828"));
  assert.ok(contrast("#ffffff", "#000000") > 20 && contrast("#0076ce", "#0070c8") < 1.2);
  assert.match(previewHtml({ ...base, panel: { ...base.panel, accent: "#0070c8" } }), /--btn:#ffffff/, "the accent that blends into the panel is left out");
});

test("panel assets: with no pictures found online it says so and gives a brand panel with copy that follows the studio's rules", async () => {
  const studio = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-panel-"));
  const ask = fakeAsk({ headline: "Matches your vibe and every single thing you do today", subline: "Discover the new Dell 14S laptop for everyday work and study", cta: studio.copy.ctas[0], category: "laptops" });
  const emptyBing = async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
  const r = await preparePanel({ brand: "Dell", product: "14S laptop", known: null, studio, ask, py: async () => "{}", ffmpeg: async () => {}, fetchImpl: emptyBing, workDir: dir, video: { title: "Dell 14S TVC" }, budgetMs: 30000 });
  assert.equal(r.product, null); assert.equal(r.logo, null); assert.match(r.flags.join(" "), /No pictures of “Dell 14S laptop” were found/);
  assert.ok(r.copy.headline.split(/\s+/).length <= studio.copy.maxHeadlineWords + 2, "headline kept to the studio's word limit");
  assert.ok(r.copy.subline.split(/\s+/).length <= studio.copy.maxSublineWords + 2);
  assert.ok(studio.copy.ctas.includes(r.copy.cta) || /./.test(r.copy.cta));
  assert.match(ask.calls.at(-1).text, /no offers, discounts, prices|No superlatives|never|No /i, "the copy prompt carries the no-claims rule");
});
