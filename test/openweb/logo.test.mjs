// 2-in-1 ads: a logo that would vanish into the panel colour is shown all-white (all-black on a light panel).
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewHtml } from "../../openweb/lib/twoinone-preview.mjs";

/** @type {any} */
const base = { brand: "Kissht", product: "Loans", publisher: "P", article: { headline: "H", url: "https://x.test", published: null, paragraphs: ["A long enough paragraph of article text here.", "Two.", "Three.", "Four."], hero: null },
  video: { kind: "youtube", id: "dQw4w9WgXcQ", title: "t" }, panel: { colour: "#2e42a5", logo: "/l.png", logoInk: "#3b54a4", headline: "Hi there" } };

test("logo tone: blue ink on a blue panel is white; white ink stays as it is; dark ink on a light panel is black; a dark logo is white on the dark opening", () => {
  const same = previewHtml(base);
  assert.ok(same.includes('class="plogo light"') && same.includes('class="il light"'));
  const fine = previewHtml({ ...base, panel: { ...base.panel, logoInk: "#ffffff" } });
  assert.ok(fine.includes('class="plogo"') && fine.includes('class="il"'));
  const lightPanel = previewHtml({ ...base, panel: { ...base.panel, colour: "#f4f4f4", logoInk: "#eeeeee" } });
  assert.ok(lightPanel.includes('class="plogo dark"'));
  const unknown = previewHtml({ ...base, panel: { ...base.panel, logoInk: undefined } });
  assert.ok(unknown.includes('class="plogo"'), "without a known ink nothing is changed");
});
