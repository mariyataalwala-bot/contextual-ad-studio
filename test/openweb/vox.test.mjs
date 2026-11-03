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
  for (const s of ['class="vs"', 'class="vph vph-cover"', 'src="/a/campaign.jpg"', '<div class="vnm">Diet Coke</div>', '<div class="vln">Har Meal Aaah</div>', '<div class="vcta">Buy now</div>', 'src="/a/logo.png"', "&times;"]) assert.ok(h.includes(s), s);
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
