// 2-in-1 creative upgrade (Nov 2026): the product is animated (3D spin-in, orbit, sparkles); no video frame stands in for it;
// the logo is never recoloured or cropped; a headline from a page is never pasted into the copy as a product name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewHtml } from "../../openweb/lib/twoinone-preview.mjs";
import { withRealName } from "../../openweb/lib/studio.mjs";

/** @type {any} */
const base = { brand: "Bingo!", product: "chips", publisher: "P", article: { headline: "h", url: "https://x.test/a", paragraphs: ["a"] }, video: { kind: "file", src: "v.mp4" } };

test("a product picture is animated with restraint: it rises in and keeps a slow push-in, with a soft shadow under it", () => {
  const h = previewHtml({ ...base, panel: { colour: "#d81f26", logo: "l.png", logoInk: "#d81f26", product: "p.png", productMode: "alpha", headline: "Crunch", cta: "Buy now" } });
  for (const x of ["@keyframes prodIn", "@keyframes pushIn", 'class="pshadow"', 'class="pprod cut"']) assert.ok(h.includes(x), x);
});

test("no product picture: the panel shows the whole logo large and never a frame of the video", () => {
  const h = previewHtml({ ...base, panel: { colour: "#d81f26", logo: "l.png", headline: "Crunch", cta: "Buy now" } });
  assert.match(h, /class="pn k-nop/); assert.doesNotMatch(h, /class="hero"/); assert.match(h, /class="pwm"/);
  assert.equal((h.match(/class="plogo/g) || []).length, 0, "the logo is not repeated in the top row");
});

test("the logo is never recoloured or cropped", () => {
  const h = previewHtml({ ...base, panel: { colour: "#d81f26", logo: "l.png", logoInk: "#d81f26", headline: "Crunch", cta: "Buy now" } });
  assert.doesNotMatch(h, /\.(plogo|il|pwm)(\.[a-z]+)?\{[^}]*(brightness|invert|grayscale|hue-rotate|clip-path)/);
  assert.match(h, /\.pwm\{[^}]*max-width:62%/); assert.match(h, /\.pwm\{[^}]*object-fit:contain/); assert.match(h, /\.il\{[^}]*object-fit:contain/);
});

test("a page's phrase is not swapped in as the product name", () => {
  assert.equal(withRealName("Taste the crunchy chips", "chips", "Bingo! Explore Various Flavors", "Bingo!"), "Taste the crunchy chips");
  assert.equal(withRealName("Taste the crunchy chips", "chips", "Bingo! Mad Angles", "Bingo!"), "Taste the crunchy Mad Angles");
});

import { INTRO_SECONDS } from "../../openweb/lib/twoinone-preview.mjs";
import { productIssues } from "../../openweb/lib/qa.mjs";

test("art-directed opening: the opener line, the product and the logo; its length is shared with the recorder", () => {
  const h = previewHtml({ ...base, panel: { colour: "#d81f26", logo: "l.png", product: "p.png", productMode: "alpha", opener: "Midnight cravings?", headline: "Crunch", cta: "Buy now" } });
  assert.match(h, /class="itype"/); assert.match(h, /Midnight/); assert.match(h, /class="ip cut"/); assert.match(h, /class="il"/); assert.ok(h.includes("INTRO=calm?0:" + INTRO_SECONDS * 1000));
  assert.ok(INTRO_SECONDS >= 3.5 && INTRO_SECONDS <= 5);
});

test("brand text theme: the brand's typeface is used through --ff, with the font files served", () => {
  const h = previewHtml({ ...base, panel: { colour: "#d81f26", logo: "l.png", fontFamily: "Baloo 2", fontCss: "@font-face{font-family:'Baloo 2';src:url(fonts/gf-fresh-0.woff2)}", headline: "Crunch", cta: "Buy now" } });
  assert.match(h, /--ff:'Baloo 2',system-ui,sans-serif/); assert.match(h, /@font-face\{font-family:'Baloo 2'/);
});

test("product QA: not on screen / cut off is critical with its timestamp; a product that never moves is major; a moving one passes", () => {
  const card = { x: 0, y: 0, w: 360, h: 640 }, at = (t, y, extra = {}) => ({ t, geom: { card, product: { x: 100, y, w: 120, h: 160, ...extra } } });
  assert.deepEqual(productIssues([at(6.5, 400), at(9.5, 396), at(12.5, 401)]), []);
  const still = productIssues([at(6.5, 400), at(9.5, 400), at(12.5, 400)]); assert.equal(still[0].severity, "major"); assert.equal(still[0].t, 6.5);
  const gone = productIssues([{ t: 6.5, geom: { card, product: null } }]); assert.equal(gone[0].severity, "critical"); assert.equal(gone[0].t, 6.5);
  const cut = productIssues([at(9.5, 600)]); assert.equal(cut[0].severity, "critical"); assert.match(cut[0].what, /cut off/);
});
