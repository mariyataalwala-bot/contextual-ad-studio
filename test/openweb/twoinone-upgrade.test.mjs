// 2-in-1 creative upgrade (Nov 2026): the product is animated (3D spin-in, orbit, sparkles); no video frame stands in for it;
// the logo is never recoloured or cropped; a headline from a page is never pasted into the copy as a product name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewHtml } from "../../openweb/lib/twoinone-preview.mjs";
import { withRealName } from "../../openweb/lib/studio.mjs";

const base = { brand: "Bingo!", product: "chips", publisher: "P", article: { headline: "h", url: "https://x.test/a", paragraphs: ["a"] }, video: { kind: "file", src: "v.mp4" } };

test("a product picture is animated: spin-in, orbit rings, light sweep over its outline, sparkles", () => {
  const h = previewHtml({ ...base, panel: { colour: "#d81f26", logo: "l.png", logoInk: "#d81f26", product: "p.png", productMode: "alpha", headline: "Crunch", cta: "Buy now" } });
  for (const x of ["rotateY(-110deg)", "orbitSpin", "pshine", "class=\"spk\"", "class=\"orbit\""]) assert.ok(h.includes(x), x);
});

test("no product picture: the panel animates the brand and never shows a frame of the video", () => {
  const h = previewHtml({ ...base, panel: { colour: "#d81f26", logo: "l.png", headline: "Crunch", cta: "Buy now" } });
  assert.match(h, /class="pn k-nop/); assert.doesNotMatch(h, /class="hero"/); assert.match(h, /class="orbit"/);
});

test("the logo is never recoloured or cropped", () => {
  const h = previewHtml({ ...base, panel: { colour: "#d81f26", logo: "l.png", logoInk: "#d81f26", headline: "Crunch", cta: "Buy now" } });
  assert.doesNotMatch(h, /\.(plogo|il)\.[a-z]+\{[^}]*(brightness|invert)/);
  assert.match(h, /\.pwm\{[^}]*max-width:62%/);
});

test("a page's phrase is not swapped in as the product name", () => {
  assert.equal(withRealName("Taste the crunchy chips", "chips", "Bingo! Explore Various Flavors", "Bingo!"), "Taste the crunchy chips");
  assert.equal(withRealName("Taste the crunchy chips", "chips", "Bingo! Mad Angles", "Bingo!"), "Taste the crunchy Mad Angles");
});
