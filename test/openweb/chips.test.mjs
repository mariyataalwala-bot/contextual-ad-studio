// 2-in-1 ads: the panel's graphic layer — the strip of chips (names only, never claims) and the extra motion pieces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepHighlights } from "../../openweb/lib/panel-assets.mjs";
import { previewHtml, fitChips, chipSize } from "../../openweb/lib/twoinone-preview.mjs";

test("chips fit the strip: the type stays at least 10px on a phone, and chips that would not fit are dropped, never cut off", () => {
  assert.deepEqual(fitChips(["Smart Loans"]), ["Smart Loans"]);
  assert.ok(chipSize(["Smart Loans"]) >= 3.35);
  const many = fitChips(["Personal Loans", "Business Loans", "Digital Property Loans"]);
  assert.ok(many.length >= 1 && many.length < 3, "three long chips do not fit one strip");
  assert.ok(chipSize(many) >= 3.35, "still readable");
  assert.deepEqual(fitChips(["A very very long product line name beyond the limit"]), ["A very very long product lin"], "a single long chip is cut at 28 characters, as before");
});

test("chips: only names that appear in what the AI was given survive; claims, numbers and invented names are dropped", () => {
  const src = "Kissht Smart Loans for Smart India. Personal Loans, Business Loans and Digital Property Loans from Kissht";
  assert.deepEqual(keepHighlights(["Personal Loans", "Business Loans", "Digital Property Loans", "Gold Cards"], src), ["Personal Loans", "Business Loans", "Digital Property Loans"]);
  assert.deepEqual(keepHighlights(["Zero interest forever", "0% EMI"], src, [], "Smart Loans"), ["Smart Loans"], "invented claims fall back to the product as typed");
  assert.deepEqual(keepHighlights(["Loans 24"], "Loans 24", [], ""), [], "a name with a number is never kept");
  assert.deepEqual(keepHighlights([], "anything", ["Aqua", "Plus", "Max", "Extra"], "x"), ["Aqua", "Plus", "Max"], "brand knowledge fills in, at most three");
  assert.deepEqual(keepHighlights(["Personal Loans", "personal loans"], src), ["Personal Loans"], "no duplicates");
  assert.deepEqual(keepHighlights(["A very long product line name that cannot fit a chip"], "A very long product line name that cannot fit a chip", [], ""), []);
  assert.deepEqual(keepHighlights(["Airtel", "Priority Postpaid"], "Airtel Priority Postpaid", [], "", "Airtel"), ["Priority Postpaid"], "the brand's own name is not a chip");
  assert.deepEqual(keepHighlights(["Redmi Note", "Redmi"], "Redmi Note 17 Redmi Note Redmi", [], ""), ["Redmi Note"], "no chip inside another");
});

/** @type {any} */
const base = { brand: "Kissht", product: "Smart Loans", publisher: "Indian Express", article: { headline: "H", url: "https://x.test/a", published: null, paragraphs: ["One long enough paragraph of article text.", "Two.", "Three.", "Four."], hero: null },
  video: { kind: "youtube", id: "dQw4w9WgXcQ", title: "Kissht TVC" },
  panel: { colour: "#2b3fa0", accent: "#ffd21f", logo: "/api/ow/twoinone/file?path=k%2Flogo.png", hero: "/api/ow/twoinone/file?path=k%2Fad_frame.jpg", headline: "A YES for you", subline: "Kissht digital personal loans", cta: "Apply now", ctaUrl: "https://kissht.com", chips: ["Personal Loans", "Business <b>Loans</b>", "Digital Property Loans", "A fourth one"], productName: "Smart Loans" } };

test("graphic layer: a line of at most three chips, and no drawn decoration anywhere (no beams, bursts, rings or ripples)", () => {
  const h = previewHtml(base);
  const shown = (h.match(/<span style="--k:\d">/g) || []).length;
  assert.ok(shown >= 1 && shown <= 3 && shown === fitChips(base.panel.chips).length, "at most three chips, and only as many as fit the strip");
  assert.ok(h.includes('class="strip"') && h.includes("Personal Loans") && !h.includes("A fourth one") && h.includes("has-strip"));
  assert.doesNotMatch(h, /class="(beam|burst|ring|rip|mesh|bokeh|glow|decor)\b/);
  for (const k of ["beam", "ripple", "burst", "shimmer", "pulse"]) assert.ok(!h.includes(`@keyframes ${k}{`), k);
  // rows, not layers: logo + words, then the picture, then the chips — so words never sit on a picture
  const top = h.indexOf('class="ptop"'), vis = h.indexOf('<div class="vis">'), strip = h.indexOf('<div class="strip"');
  assert.ok(top > 0 && top < vis && vis < strip, "logo/words row, then picture row, then chips row");
  assert.ok(h.slice(top, vis).includes("<h2>") && !h.slice(vis, strip).includes("<h2>") && !h.slice(vis, strip).includes('class="cta"'), "the words are all above the picture");
  assert.match(h, /grid-template-rows:auto minmax\(0,1fr\) auto/);
  const esc = previewHtml({ ...base, panel: { ...base.panel, chips: ["Smart <b>Loans</b>"] } });
  assert.ok(!esc.includes("<b>Loans</b>") && esc.includes("&lt;b&gt;Loans&lt;/b&gt;"), "chip text is escaped");
});
test("graphic layer: a product picture gets only a soft shadow, no rings; no chips means no strip", () => {
  const withProduct = previewHtml({ ...base, panel: { ...base.panel, hero: null, product: "/api/ow/twoinone/file?path=k%2Fp.png" } });
  assert.equal((withProduct.match(/<i class="rip">/g) || []).length, 0); assert.equal((withProduct.match(/<i class="pshadow">/g) || []).length, 1);
  const none = previewHtml({ ...base, panel: { ...base.panel, chips: [] } });
  assert.ok(!none.includes('<div class="strip"') && !none.includes('class="pn k-hero has-strip"') && none.includes('class="pn k-hero"'));
});
