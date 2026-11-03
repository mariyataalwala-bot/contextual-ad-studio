// 2-in-1 ads: a logo that would vanish into the panel colour is never recoloured — the field behind it changes to a pale
// or deep tone of the brand colour instead (a plate is the last resort).
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewHtml, contrast } from "../../openweb/lib/twoinone-preview.mjs";

/** @type {any} */
const base = { brand: "Kissht", product: "Loans", publisher: "P", article: { headline: "H", url: "https://x.test", published: null, paragraphs: ["A long enough paragraph of article text here.", "Two.", "Three.", "Four."], hero: null },
  video: { kind: "youtube", id: "dQw4w9WgXcQ", title: "t" }, panel: { colour: "#2e42a5", logo: "/l.png", logoInk: "#3b54a4", product: "/p.png", headline: "Hi there" } };
const fieldOf = (/** @type {string} */ h) => /--c:(#[0-9a-f]{6})/.exec(h)?.[1] || "";

test("logo field: a logo that would vanish on the brand colour gets a pale or deep tone of it instead, shown as it is; a plate is the last resort", () => {
  const same = previewHtml(base);   // blue ink on a blue panel → a pale blue field, the logo untouched
  assert.ok(same.includes('class="plogo"') && same.includes('class="il"') && !same.includes(' light"'));
  const field = fieldOf(same);
  assert.ok(contrast("#3b54a4", field) >= 3, `the logo stands out on the field (${field})`);
  assert.ok(contrast("#2e42a5", field) >= 3 && same.includes("--head:#2e42a5"), "the brand colour becomes the type colour on the pale field");
  const noProduct = previewHtml({ ...base, panel: { ...base.panel, product: null } });
  assert.ok(noProduct.includes('class="pwm"') && !noProduct.includes('class="plogo'), "a brand panel shows the logo once, large");
  const fine = previewHtml({ ...base, panel: { ...base.panel, logoInk: "#ffffff" } });
  assert.ok(fine.includes('class="plogo"') && fine.includes('class="il"') && fieldOf(fine) === "#2e42a5", "a logo that stands out keeps the brand colour");
  const lightPanel = previewHtml({ ...base, panel: { ...base.panel, colour: "#f4f4f4", logoInk: "#eeeeee" } });
  assert.ok(contrast("#eeeeee", fieldOf(lightPanel)) >= 3 && lightPanel.includes('class="plogo"'), "a pale logo on a pale panel gets a deep field");
  const unknown = previewHtml({ ...base, panel: { ...base.panel, logoInk: undefined } });
  assert.ok(unknown.includes('class="plogo"') && fieldOf(unknown) === "#2e42a5", "without a known ink nothing is changed");
  assert.doesNotMatch(same, /\.(plogo|il|pwm)[^{]*\{[^}]*filter:(?!none)[^}]*(brightness|invert|grayscale)/, "the logo is never put through a colour filter");
});
