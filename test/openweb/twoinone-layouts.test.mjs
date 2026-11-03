// 2-in-1 opening (Nov 2026 art direction): three restrained layouts — editorial, hero, range — chosen per brand, with no
// drawn decoration (no orbits, rings, bursts, sparkles or particles) and no looping animation. Synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unitParts, previewHtml, introLayout, fitType, INTRO_LAYOUTS } from "../../openweb/lib/twoinone-preview.mjs";

/** @type {any} */
const base = { brand: "Fizz", product: "cola", publisher: "P", article: { headline: "H", url: "https://x.test/a", published: null, paragraphs: ["A long enough paragraph of article text.", "Two.", "Three."], hero: null },
  video: { kind: "file", src: "v.mp4" } };
const panel = { colour: "#d81f26", logo: "l.png", logoInk: "#ffffff", product: "p.png", productMode: "cut", opener: "Cold, crisp and ready", headline: "Open happiness", cta: "Buy now", productName: "Fizz Cola" };
const range = [{ name: "Fizz Cola", src: "a.png" }, { name: "Fizz Lime", src: "b.png" }, { name: "Fizz Orange", src: "c.png" }];
const parts = (/** @type {any} */ p) => unitParts({ ...base, panel: { ...panel, ...p } });
const layoutOf = (/** @type {string} */ html) => /data-layout="(\w+)"/.exec(html)?.[1];

test("layout choice is deterministic: override, then range data, then design style or typeface, then category, then picture kind", () => {
  assert.deepEqual([...INTRO_LAYOUTS], ["editorial", "hero", "range"]);
  assert.equal(introLayout({ introLayout: "editorial", style: "luxe" }), "editorial", "an explicit override wins");
  assert.equal(introLayout({ layout: "hero" }), "hero");
  assert.equal(introLayout({ range }), "range");
  assert.equal(introLayout({ style: "luxe" }), "hero"); assert.equal(introLayout({ style: "tech" }), "hero");
  assert.equal(introLayout({ style: "bold" }), "editorial"); assert.equal(introLayout({ style: "sport" }), "editorial");
  assert.equal(introLayout({ fontFamily: "Playfair Display" }), "hero", "the typeface tells the style when the style is not passed");
  assert.equal(introLayout({ fontFamily: "Anton" }), "editorial");
  assert.equal(introLayout({ category: "Perfume" }), "hero"); assert.equal(introLayout({ category: "Soft drink" }), "editorial");
  assert.equal(introLayout({ productMode: "photo" }), "editorial"); assert.equal(introLayout({ productMode: "cut" }), "hero");
  assert.equal(introLayout({ style: "bold" }), introLayout({ style: "bold" }), "same input, same layout");
});

test("range falls back to hero without real pack shots (absent, one only, or entries without a name or picture)", () => {
  assert.equal(introLayout({ introLayout: "range" }), "hero");
  assert.equal(introLayout({ introLayout: "range", range: [range[0]] }), "hero");
  assert.equal(introLayout({ introLayout: "range", range: [{ name: "", src: "a.png" }, { name: "X", src: "" }] }), "hero");
  const h = parts({ introLayout: "range" }).html;
  assert.equal(layoutOf(h), "hero"); assert.doesNotMatch(h, /class="irange"/); assert.match(h, /class="isweep"/);
});

test("editorial renders its parts: big type, the product beside it with a soft shadow, the logo, and one slow push-in", () => {
  const { html, css } = parts({ style: "bold" });
  assert.equal(layoutOf(html), "editorial");
  assert.match(html, /class="intro L-editorial/); assert.match(html, /<p class="itype">/); assert.match(html, /class="ip cut" src="p\.png"/);
  assert.match(html, /<i class="ishadow"><\/i>/); assert.match(html, /<img class="il" src="l\.png"/); assert.doesNotMatch(html, /class="isweep"/);
  for (const w of ["Cold,", "crisp", "and", "ready"]) assert.ok(html.includes(`>${w}</span>`), w);
  assert.match(css, /\.L-editorial\.go \.istage\{animation:push/); assert.match(css, /\.L-editorial \.ibox\{left:56cqw/); assert.match(css, /\.L-editorial \.itype\{left:7cqw;width:46cqw/);
});

test("hero renders its parts: the product centred, one light sweep masked to its cut-out, the line below, then the logo", () => {
  const { html, css } = parts({ style: "luxe" });
  assert.equal(layoutOf(html), "hero");
  assert.match(html, /class="isweep" style="--pu:url\(&quot;p\.png&quot;\)"/, "the sweep is masked to the product picture");
  const box = html.indexOf('class="ibox"'), type = html.indexOf('class="itype"'), logo = html.indexOf('class="il"');
  assert.ok(box > 0 && box < type && type < logo, "product, then line, then logo");
  assert.match(css, /\.L-hero\.go \.ipw\{animation:riseTilt/); assert.match(css, /\.L-hero\.go \.isweep\{animation:sweep 1\.1s/);
  assert.match(css, /@keyframes riseTilt\{0%\{opacity:0;transform:translateY\(8%\) rotateX\(9deg\) rotateY\(-13deg\)/, "a gentle tilt, not a spin");
});

test("range renders its parts: every real pack with its real name under it, then the logo", () => {
  const { html, css } = parts({ range });
  assert.equal(layoutOf(html), "range");
  assert.equal((html.match(/<figure class="rk"/g) || []).length, 3);
  for (const r of range) { assert.ok(html.includes(`src="${r.src}" alt="${r.name}"`), r.src); assert.ok(html.includes(`<figcaption>${r.name}</figcaption>`), r.name); }
  assert.match(css, /\.rk figcaption\{[^}]*text-transform:uppercase/); assert.match(css, /\.L-range\.go \.rk\{animation:rkIn/);
  assert.equal((parts({ range: [...range, ...range] }).html.match(/<figure class="rk"/g) || []).length, 4, "four packs at most");
  assert.match(parts({ range, opener: "" }).html, /class="intro L-range noline"/, "no opener line: the packs move up");
});

test("no product picture: a typographic opening with the logo; nothing stands in for the product", () => {
  const { html } = parts({ product: null, style: "luxe" });
  assert.equal(layoutOf(html), "type"); assert.doesNotMatch(html, /class="ip /); assert.match(html, /class="itype"/); assert.match(html, /class="il"/);
});

test("no drawn decoration and no looping motion anywhere in the unit, for every layout", () => {
  for (const p of [{ style: "bold" }, { style: "luxe" }, { range }, { product: null }, { product: null, hero: "f.jpg" }, { productMode: "photo" }]) {
    const { html, css } = parts(p), all = html + css;
    assert.doesNotMatch(html, /class="[^"]*\b(orbit|o2|iorb|spk|sparkle|burst|ring|rip|beam|bokeh|mesh|glow|decor|particle)\b/, JSON.stringify(p));
    assert.doesNotMatch(css, /@keyframes (orbitSpin|spark|burst|ringOut|ripple|beam|breathe|pulse|shimmer|floaty|rise2|drift[123])\b/, JSON.stringify(p));
    assert.doesNotMatch(all, /infinite/, "every animation plays once");
    assert.doesNotMatch(css, /text-decoration:(?!none)/, "no underlines");
  }
});

test("motion uses the house ease and durations of 0.6–1.2 s for the arrivals", () => {
  const { css } = parts({ style: "luxe" });
  const arrivals = [...css.matchAll(/animation:(?:iwIn|ilIn|slideIn|riseTilt|sweep|rkIn|wordIn|prodIn|fadeUp) ([\d.]+)s/g)].map((m) => +m[1]);
  assert.ok(arrivals.length >= 8 && arrivals.every((d) => d >= 0.6 && d <= 1.2), arrivals.join(","));
  assert.ok(css.includes("cubic-bezier(.2,.8,.2,1)"));
  assert.match(css, /\.intro\.done\{opacity:0;transform:scale\(\.94\)\}/, "the opening scales and crossfades out");
  assert.match(css, /\.unit\{[^}]*opacity:0;transform:scale\(\.96\)\}/, "while the card scales and crossfades in");
});

test("the type is sized to its region: long lines get smaller type, a word too wide for the column stacks the editorial layout", () => {
  const short = fitType("Cold and crisp", 46, 6, 13, 6.5), long = fitType("Every single summer afternoon tastes better", 46, 6, 13, 6.5);
  assert.ok(short.ok && long.ok && short.fs > long.fs);
  assert.equal(fitType("Supercalifragilisticexpialidocious", 46, 6, 13, 6.5).ok, false);
  assert.match(parts({ style: "bold", opener: "Supercalifragilisticexpialidocious" }).html, /class="intro L-editorial stack"/);
  assert.match(parts({ style: "bold" }).html, /class="intro L-editorial"/);
});

test("copy in the opening is escaped: opener, pack names, brand and pictures", () => {
  const evil = '"><script>alert(1)</script>';
  for (const p of [{ style: "bold" }, { style: "luxe" }, { range }]) {
    const { html } = unitParts({ ...base, brand: evil, panel: { ...panel, ...p, opener: `Hi ${evil}`, logo: null, product: `p.png${evil}`, range: p.range ? [{ name: evil, src: `a.png${evil}` }, { name: "B <b>x</b>", src: "b.png" }] : undefined } });
    assert.ok(!html.includes("<script>alert"), "no injected script"); assert.ok(!html.includes("<b>x</b>"), "pack names are escaped");
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "shown as text");
  }
  const full = previewHtml({ ...base, panel: { ...panel, opener: '"><img src=x onerror=alert(1)>' } });
  assert.ok(!full.includes("<img src=x"));
});
