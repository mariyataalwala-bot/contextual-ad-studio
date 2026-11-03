/* global document */
import test from "node:test";
import assert from "node:assert/strict";
import { voxStripeHtml, voxFullHtml, voxHtml, fitVox, VOX_FULL_MS } from "../../openweb/lib/vox.mjs";
import { stripHtml } from "../../openweb/lib/strip.mjs";
import { statsOf, frameScore, pickCampaignFrame } from "../../openweb/lib/campaign.mjs";
import { loadStudioConfig } from "../../openweb/lib/studio.mjs";

const o = { brand: "Coca-Cola", headline: "Har Meal Aaah", subline: "Refresh with Diet Coke", cta: "Buy now", colour: "#e41e2b", accent: "#ffffff", productUrl: "/a/product.png", productMode: "alpha", logoUrl: "/a/logo.png", logoKind: "mark", logoInk: "#e41e2b", style: "fresh", productName: "Diet Coke", campaignUrl: "/a/campaign.jpg" };
const classes = (html) => new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));

test("vox stripe: campaign cell, name, line, button, logo and icons", () => {
  const h = voxStripeHtml(o);
  for (const s of ['class="vs"', 'class="vph vph-fit"', 'src="/a/campaign.jpg"', '<div class="vnm">Diet Coke</div>', '<div class="vln">Har Meal Aaah</div>', '<div class="vcta">Buy now</div>', 'src="/a/logo.png"', "&times;"]) assert.ok(h.includes(s), s);
  assert.match(h, /:host\(\[data-go\]\) \.vs\{animation:vsUp/);
});

test("vox full: takeover with data-go2, then the stripe on data-go2", () => {
  const h = voxFullHtml(o);
  assert.ok(h.includes(`data-go2="${VOX_FULL_MS}"`));
  assert.match(h, /:host\(\[data-go\]\) \.vf\{/);
  assert.match(h, /:host\(\[data-go2\]\) \.vs\{animation:vsUp/);
  assert.equal((h.match(/class="vnm"/g) || []).length, 2);
  assert.equal(voxHtml("vox-stripe", o), voxStripeHtml(o));
});

test("vox: a pack cut-out is contained, never cover-cropped", () => {
  for (const h of [voxStripeHtml({ ...o, campaignUrl: null }), voxFullHtml({ ...o, campaignUrl: null })]) {
    assert.ok(h.includes('class="vph vph-pack"><img src="/a/product.png"'));
    assert.ok(!h.includes("vph-cover\""));
  }
  assert.match(voxStripeHtml(o), /\.vph-pack img\{object-fit:contain/);
});

test("vox: copy is escaped", () => {
  const h = voxFullHtml({ ...o, productName: '<b>"X"</b>', headline: "a & b", cta: "<script>" });
  assert.ok(!h.includes("<b>") && !h.includes("<script>"));
  assert.ok(h.includes("&lt;b&gt;&quot;X&quot;&lt;/b&gt;") && h.includes("a &amp; b") && h.includes("&lt;script&gt;"));
});

test("vox: no decoration and no infinite loops", () => {
  for (const h of [voxStripeHtml(o), voxFullHtml(o)]) {
    assert.ok(!/infinite/.test(h));
    assert.ok(!/sparkle|bubble|glow|particle|twinkle|radial-gradient|drop-shadow|blur\(/i.test(h));
  }
});

test("vox: every class and keyframe starts with v, none clashes with the strip", () => {
  const strip = classes(stripHtml(o));
  for (const h of [voxStripeHtml(o), voxFullHtml(o)]) {
    for (const c of classes(h)) { assert.ok(c.startsWith("v"), c); assert.ok(!strip.has(c), c); }
    for (const m of h.matchAll(/@keyframes (\S+?)\{/g)) assert.ok(m[1].startsWith("v"), m[1]);
    for (const m of h.matchAll(/\.([a-z][\w-]*)/gi)) if (!/^\d/.test(m[1]) && !["png", "jpg"].includes(m[1])) assert.ok(m[1].startsWith("v"), m[1]);
  }
  assert.equal(typeof fitVox, "function");
});

test("campaign frame: rules prefer a lit, contrasty, sharp frame", async () => {
  const flat = statsOf(Buffer.alloc(96 * 54, 10), 96, 54);
  assert.equal(frameScore(flat), -1);
  const px = Buffer.alloc(96 * 54); for (let i = 0; i < px.length; i++) px[i] = (i % 2) ? 200 : 40;
  assert.ok(frameScore(statsOf(px, 96, 54)) > 0);
  assert.equal(await pickCampaignFrame([], { ffmpeg: async () => null }), null);
});

test("vox: the model name is short, without the brand or the size", async () => {
  const { shortName } = await import("../../openweb/lib/vox.mjs");
  assert.equal(shortName("Safari Pentagon 55 Cms Cabin Trolley Bag", "Safari"), "Pentagon 55");
  assert.equal(shortName("Diet Coke", "Coca-Cola"), "Diet Coke");
  assert.equal(shortName("Nescafé Classic Instant Coffee 100g", "Nescafe"), "Classic Instant Coffee");
});

test("config: vox-full is the default layout", () => {
  assert.equal(loadStudioConfig().creative.layout, "vox-full");
});

// ---------- the client's hard rule: text, logo and product never cut, trimmed or overlapping ----------
const wideLogo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="90"><rect width="900" height="90" fill="#d84e55"/></svg>');
const pack = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="400"><rect width="200" height="400" fill="#333"/></svg>');

test("vox fit: a long name, long line and wide logo still fit, inside the margins and without overlap", { timeout: 60000 }, async () => {
  const { chromium } = await import("playwright");
  const { voxGeom } = await import("../../openweb/lib/vox.mjs");
  const { geometryIssues } = await import("../../openweb/lib/qa.mjs");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    const long = { ...o, productName: "Ultra Comfort Sleeper Volvo Multi-Axle", headline: "Convenient boarding and dropping points across every city in India", cta: "Book your seat now", logoUrl: wideLogo, campaignUrl: null, productUrl: pack };
    for (const [html, wait] of [[voxStripeHtml(long), 1600], [voxFullHtml(long), 1400]]) {
      await page.setContent(`<div id="h" style="position:relative;width:380px;height:214px"></div>`);
      await page.evaluate((h) => { document.getElementById("h").attachShadow({ mode: "open" }).innerHTML = h; }, html);
      await page.waitForFunction(() => [...document.getElementById("h").shadowRoot.querySelectorAll("img")].every((i) => i.complete));
      await page.evaluate(`(${fitVox})(document.getElementById("h"))`);
      assert.equal(await page.evaluate(() => document.getElementById("h").dataset.voxFit), "ok");
      await page.evaluate(() => document.getElementById("h").setAttribute("data-go", ""));
      await page.waitForTimeout(wait);
      const geom = await page.evaluate(`(${voxGeom})(document.getElementById("h"))`);
      assert.ok(geom && geom.kind === "vox" && geom.logo, "the bar is measured");
      const lg = geom.logo; assert.ok(Math.abs(lg.w / lg.h - 10) < 0.3, "the logo keeps its aspect ratio");
      const bad = geometryIssues([{ t: 1, geom }]).filter((i) => ["text_overlap", "safe_margins", "logo_product_obstruction", "text_subject_overlap"].includes(i.check));
      assert.deepEqual(bad.map((i) => i.what), []);
    }
  } finally { await browser.close(); }
});

test("vox QA: a logo past the margin or a failed fit blocks approval, with the timestamp", async () => {
  const { geometryIssues } = await import("../../openweb/lib/qa.mjs");
  const geom = { kind: "vox", bar: "stripe", card: { x: 0, y: 100, w: 380, h: 90 }, view: { w: 412, h: 915 }, panelColour: "#ffffff", fit: "fail: the logo overlaps the button", texts: [], logo: { x: 340, y: 120, w: 40, h: 20 }, picture: { x: 0, y: 100, w: 140, h: 90 } };
  const is = geometryIssues([{ t: 3.2, geom }]);
  assert.ok(is.some((i) => i.check === "safe_margins" && i.severity === "critical" && i.t === 3.2));
  assert.ok(is.some((i) => i.check === "text_overlap" && /could not be fitted/.test(i.what)));
});

test("vox: a campaign frame is cover-cropped only when the AI confirmed it holds no text", () => {
  assert.ok(voxStripeHtml(o).includes('class="vph vph-fit"'));
  assert.ok(voxStripeHtml({ ...o, campaignCrop: true }).includes('class="vph vph-cover"'));
  assert.match(voxFullHtml(o), /\.vph-fit img\{object-fit:contain/);
});

/** a fake ffmpeg that writes a grey frame: flat, or with a caption-like band of strokes */
const fakeFfmpeg = (withText) => async (args) => {
  const [w, h] = /scale=(\d+):(\d+)/.exec(args.join(" ")).slice(1).map(Number), out = args.at(-1);
  const px = Buffer.alloc(w * h); for (let i = 0; i < px.length; i++) px[i] = 60 + ((i % w) * 3 + Math.floor(i / w)) % 140;   // a lit, contrasty, textured picture
  if (withText) { const y0 = Math.round(h * 0.8); px.fill(30, y0 * w - 4 * w, (y0 + 10) * w + 4 * w); for (let y = y0; y < y0 + 8; y++) for (let x = Math.round(w * 0.2); x < w * 0.8; x++) px[y * w + x] = x % 4 < 2 ? 240 : 30; }
  (await import("node:fs")).writeFileSync(out, px);
};

test("campaign frame: the free detector finds a caption band and leaves a plain picture", async () => {
  const { textBands, TEXT_W, TEXT_H } = await import("../../openweb/lib/campaign.mjs");
  const plain = Buffer.alloc(TEXT_W * TEXT_H, 120);
  assert.equal(textBands(plain, TEXT_W, TEXT_H).hasText, false);
  const cap = Buffer.from(plain); for (let y = 140; y < 150; y++) for (let x = 60; x < 260; x++) cap[y * TEXT_W + x] = x % 4 < 2 ? 250 : 20;
  const r = textBands(cap, TEXT_W, TEXT_H); assert.equal(r.hasText, true); assert.ok(r.box.y >= 75 && r.box.y <= 80);
});

test("campaign frame: a frame with text (AI has_text or the detector) is rejected; a clean AI pick may be cropped", async () => {
  const os = await import("node:os"), fs = await import("node:fs"), path = await import("node:path");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vox-")), files = ["a", "b", "c"].map((n) => { const f = path.join(d, n + ".png"); fs.writeFileSync(f, ""); return f; });
  const askText = async () => ({ pick: 1, product_x: 50, has_text: true, text_box: { x: 10, y: 80, w: 80, h: 8 }, why: "caption" });
  assert.equal(await pickCampaignFrame(files, { ffmpeg: fakeFfmpeg(false), ask: askText }), null, "has_text from the AI → no frame");
  assert.equal(await pickCampaignFrame(files, { ffmpeg: fakeFfmpeg(true) }), null, "the detector rejects every captioned frame");
  const clean = await pickCampaignFrame(files, { ffmpeg: fakeFfmpeg(false), ask: async () => ({ pick: 2, product_x: 40, has_text: false, text_box: { x: 0, y: 0, w: 0, h: 0 }, why: "pack" }) });
  assert.equal(clean.crop, true); assert.equal(clean.file, files[1]);
  const rules = await pickCampaignFrame(files, { ffmpeg: fakeFfmpeg(false) });
  assert.equal(rules.crop, false, "a rules pick is never cropped");
  fs.rmSync(d, { recursive: true, force: true });
});

test("vox fallback: with no clean frame the product cut-out is contained, never cropped", () => {
  for (const h of [voxStripeHtml({ ...o, campaignUrl: null, campaignCrop: true }), voxFullHtml({ ...o, campaignUrl: null })]) {
    assert.ok(h.includes('class="vph vph-pack"><img src="/a/product.png" alt="">'));
    assert.ok(!/vph-cover"/.test(h) && !/object-position:\d/.test(h.split("</style>")[1]));
  }
});
