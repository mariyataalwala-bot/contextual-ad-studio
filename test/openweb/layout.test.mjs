// 2-in-1 ads: text sizes that keep the words from growing into the picture, and the unit parts used by the recorder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { textSizes, unitParts } from "../../openweb/lib/twoinone-preview.mjs";

test("text sizes: long copy gets smaller type so the headline stays on two lines and the subline on two", () => {
  const short = textSizes("Speed in the crowd", "Airtel Priority Postpaid"), long = textSizes("A very long headline that wants to run over many many lines here", "A very long subline that goes on and on and on, naming every single feature it can think of today");
  assert.ok(short.hs > long.hs && short.ss >= long.ss);
  for (const s of [short, long]) { assert.ok(s.hs >= 6.4 && s.hs <= 10 && s.ss >= 3.3 && s.ss <= 4.4); }
  const lines = (txt, fs, em) => Math.ceil(txt.length * em * fs / 86);
  assert.ok(lines("Speed in the crowd", short.hs, 0.56) <= 2);
  assert.deepEqual(textSizes("", ""), { hs: 10, ss: 4.4 }, "no copy: defaults");
});

/** @type {any} */
const base = { brand: "Dell", product: "laptop", publisher: "P", article: { headline: "H", url: "https://x.test", published: null, paragraphs: ["x"], hero: null }, video: { kind: "file", src: "https://mk-mock.invalid/asset/v.mp4" },
  panel: { colour: "#0076ce", product: "https://mk-mock.invalid/asset/p.png", headline: "Matches your vibe", subline: "Discover the new Dell 14S", cta: "Buy now", chips: ["Dell 14S"] } };

test("unit parts: css + html + an init script that runs on a document or a shadow root; fixed mode covers the window", () => {
  const a = unitParts(base), b = unitParts(base, { fixed: true });
  assert.match(a.css, /\.veil\{position:absolute/); assert.match(b.css, /\.veil\{position:fixed/);
  assert.ok(a.html.includes('id="veil"') && a.html.includes('id="unit"') && a.html.includes('<video id="vid"'));
  assert.match(a.js, /^function mkInit\(root\)/); assert.match(a.js, /root\.getElementById/);
  assert.doesNotMatch(a.html, /controls/, "the unit has no player chrome — the recording looks like the references");
  assert.match(unitParts({ ...base, video: { kind: "youtube", id: "dQw4w9WgXcQ" } }).html, /controls=0/);
  assert.doesNotThrow(() => new Function(a.js + "; return mkInit;"), "the init script is valid JavaScript");
});
