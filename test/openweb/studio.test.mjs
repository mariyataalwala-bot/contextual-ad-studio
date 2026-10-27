// In-Image Studio: picture search parsing, the strip creative, topic matching over sitemaps, the studio config, and
// the HTML creative in the mock renderer (real headless browser, synthetic local pages — no internet).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { parseBingImages, brandHost } from "../../openweb/lib/websearch.mjs";
import { stripHtml, fitStrip, luminance } from "../../openweb/lib/strip.mjs";
import { slugTitle, matchSlugs, sitemapIndex, loadStudioConfig, withRealName, usedArticles, rivalMatcher } from "../../openweb/lib/studio.mjs";
import { renderMock, ASSET_URL } from "../../openweb/lib/mock.mjs";
import { loadMediaPlan, checkPublisherSources } from "../../openweb/lib/inventory.mjs";
import { extractArticle } from "../../openweb/lib/extract.mjs";
import { FILLER } from "./helpers.mjs";

test("image search results: full picture, thumbnail, source page and title from each tile; entities decoded; duplicates dropped", () => {
  const tile = (o) => ` m="${JSON.stringify(o).replace(/"/g, "&quot;").replace(/&(?!quot;)/g, "&amp;")}"`;
  const html = `<a class="iusc"${tile({ murl: "https://www.bata.com/img/shoe.jpg?sw=800&sh=800", turl: "https://tse1.mm.bing.net/th?id=OIP.a&pid=Api", purl: "https://www.bata.com/in/power-shoe.html", t: "Power Grey Running Shoes | Bata" })}></a>
    <a class="iusc"${tile({ murl: "https://www.bata.com/img/shoe.jpg?sw=800&sh=800", turl: "x", purl: "https://www.bata.com/in/dup.html", t: "dup" })}></a>
    <a class="iusc"${tile({ murl: "https://shop.test/p.png", purl: "not a url", t: "bad page" })}></a>`;
  const r = parseBingImages(html);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { url: "https://www.bata.com/img/shoe.jpg?sw=800&sh=800", thumb: "https://tse1.mm.bing.net/th?id=OIP.a&pid=Api", page: "https://www.bata.com/in/power-shoe.html", host: "bata.com", title: "Power Grey Running Shoes | Bata" });
});

test("copy names the product found online, not a misspelt or made-up name that was typed", () => {
  assert.equal(withRealName("Discover Motorola V70 edge plus", "V70 edge plus", "Motorola Edge 70 Pro Plus", "Motorola"), "Discover Motorola Edge 70 Pro Plus");
  assert.equal(withRealName("Run in Power shoes", "Power running shoes", "power running shoes", "Bata"), "Run in Power shoes");
  assert.equal(withRealName("Try a.b (x)", "a.b (x)", "Real", "B"), "Try Real", "typed text with regex characters is matched literally");
});

test("one advertiser per article: an article used by another brand's mock is off-limits; withdrawn mocks and the same brand's own reruns are not", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "used-"));
  const put = (dir, r) => { fs.mkdirSync(path.join(root, dir), { recursive: true }); fs.writeFileSync(path.join(root, dir, "result.json"), JSON.stringify(r)); };
  put("indigo/1", { brand: "IndiGo", product: "flights", placement: { article: { url: "https://news.test/article/road-trips-123/?ref=x" } } });
  put("airbnb/1", { brand: "Airbnb", product: "stays", error: "Withdrawn", placement: { article: { url: "https://news.test/article/greece-456/" } } });
  put("motorola/1", { brand: "Motorola", product: "phone", placement: { article: { url: "https://news.test/article/camera-tips-789/" } } });
  put("_index", {}); fs.writeFileSync(path.join(root, "_index", "x.json"), "{}");
  const used = usedArticles(root, "motorola");
  assert.deepEqual([...used.keys()], ["https://news.test/article/road-trips-123"]);
  assert.equal(used.get("https://news.test/article/road-trips-123"), "IndiGo · flights");
});

test("rival names in a headline are caught as whole words, with or without spaces, and never inside other words", () => {
  const m = rivalMatcher(["Apple", "iPhone", "One Plus", "Samsung", "Motorola"]);
  assert.deepEqual(m("iPhone Duo goes on sale in India"), ["iPhone"]);
  assert.deepEqual(m("OnePlus 15 review"), ["OnePlus"]);
  assert.deepEqual(m("Samsung's new tablet"), ["Samsung"]);
  assert.deepEqual(m("Motorola Edge launch"), ["Motorola"], "the brand's own news is left out too");
  assert.equal(m("Pineapple smoothie recipes"), null);
  assert.equal(m("WhatsApp lets you screen callers"), null);
});

test("subscription articles are recognised from the page's own schema.org flag (Indian Express marks them isAccessibleForFree: false)", () => {
  const page = (flag) => `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: "H", articleBody: FILLER, ...(flag === undefined ? {} : { isAccessibleForFree: flag }) })}</script></head><body></body></html>`;
  assert.equal(extractArticle(page("False"), "https://x.test/a").free, false);
  assert.equal(extractArticle(page(false), "https://x.test/a").free, false);
  assert.equal(extractArticle(page("True"), "https://x.test/a").free, true);
  assert.equal(extractArticle(page(undefined), "https://x.test/a").free, null);
});

test("the brand's own site is recognised by its host name, retailers are not", () => {
  assert.equal(brandHost("bata.com", "Bata"), true);
  assert.equal(brandHost("www.giva.co", "GIVA"), true);
  assert.equal(brandHost("maggi.in", "Maggi"), true);
  assert.equal(brandHost("amazon.in", "Maggi"), false);
  assert.equal(brandHost("ubata.com", "Bata"), false);
  assert.equal(brandHost("x.com", "LG"), false);   // too short a name to match on
});

test("strip creative: copy is escaped, the layout follows the product picture, light brand colours get dark text", () => {
  const base = { brand: "Brand <b>", headline: "Hi <script>alert(1)</script>", subline: 'Say "yes" & go', cta: "Shop now", colour: "#e31b23", productUrl: "https://a.test/p.png", logoUrl: null };
  const cut = stripHtml({ ...base, productMode: "plain-bg" });
  assert.ok(!cut.includes("<script>alert") && cut.includes("&lt;script&gt;") && cut.includes("&quot;yes&quot;") && cut.includes(">&amp;<"));   // words are wrapped one by one for the rise
  assert.ok(cut.includes('class="p cut"') && !cut.includes('class="sc"'));
  assert.ok(cut.includes('class="lg lgt">Brand &lt;b&gt;'), "no logo → the brand name as text");
  assert.ok(stripHtml({ ...base, productMode: "photo" }).includes('class="p card"'));
  const scene = stripHtml({ ...base, productMode: "scene" });
  assert.ok(scene.includes('class="sc"') && !scene.includes('class="p '));
  assert.ok(luminance("#ffdf00") > 0.62 && stripHtml({ ...base, colour: "#ffdf00", productMode: "alpha" }).includes("color:#141414"));
  assert.ok(stripHtml({ ...base, colour: "#ffdf00", accent: "#d32f2f", productMode: "alpha" }).includes('class="pn"'), "contrasting accent → product panel");
  assert.ok(!stripHtml({ ...base, colour: "#e31b23", accent: "#e0201c", productMode: "alpha" }).includes('class="pn"'), "accent too close to the main colour → no panel");
  const one = stripHtml({ ...base, subline: "", productMode: "alpha" });
  assert.ok(!one.includes('class="sb"') && one.includes('class="tx one"'));
});

test("topic matching over sitemap URLs: words taken from the URL, more matches rank first, then newer", () => {
  assert.equal(slugTitle("https://indianexpress.com/article/lifestyle/fitness/20-minute-walk-brain-health-10832732/"), "20 minute walk brain health");
  const e = (slug, d) => ({ url: `https://x.test/article/lifestyle/${slug}-1234567/`, title: slugTitle(`https://x.test/article/lifestyle/${slug}-1234567/`), published: d, section: "s" });
  const list = [e("easy-noodle-recipes", "2026-10-01"), e("monsoon-noodle-recipes-for-hostel", "2026-09-20"), e("stock-market-today", "2026-10-02"), e("noodle-bar-opens", "2026-10-05")];
  const m = matchSlugs(list, ["noodle", "recipes", "hostel life", "monsoon"]);
  assert.deepEqual(m.map((x) => x.title), ["monsoon noodle recipes for hostel", "easy noodle recipes", "noodle bar opens"]);
});

test("sitemap index: reads each day once, keeps only allowed sections, re-reads today after 30 min, forgets days outside the window", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smidx-")), file = path.join(dir, "i.json");
  const sm = { id: "t", domain: "news.test", days: 3, paths: ["/article/lifestyle/"], today: "https://news.test/today.xml", yesterday: "https://news.test/yesterday.xml", daily: "https://news.test/sm.xml?d={yyyy}-{mm}-{dd}" };
  const asked = [];
  const fetcher = { get: async (u) => { asked.push(u); return { text: `<urlset><url><loc>https://news.test/article/lifestyle/food/a-${asked.length}-100001/</loc></url><url><loc><![CDATA[https://news.test/article/india/politics-100002/]]></loc></url><url><loc>https://news.test/article/lifestyle/live-updates/x-100003/</loc></url></urlset>` }; } };
  const now = Date.parse("2026-10-27T06:00:00Z");
  let all = await sitemapIndex(sm, fetcher, file, { now });
  assert.equal(asked.length, 3); assert.ok(asked[2].includes("d=2026-10-25"));
  assert.equal(all.length, 3); assert.ok(all.every((x) => x.url.includes("/article/lifestyle/food/")), "other sections and live blogs left out");
  await sitemapIndex(sm, fetcher, file, { now: now + 10 * 60e3 });
  assert.equal(asked.length, 3, "nothing re-read within 30 minutes");
  await sitemapIndex(sm, fetcher, file, { now: now + 31 * 60e3 });
  assert.equal(asked.length, 5, "today and yesterday re-read after 30 minutes, older days never");
  all = await sitemapIndex(sm, fetcher, file, { now: now + 2 * 864e5 });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).days).sort(), ["2026-10-27", "2026-10-28", "2026-10-29"]);
});

test("studio config: versioned, and every section cites a media-plan in-image cell that really lists its site", { skip: !loadMediaPlan().ok && "media plan file not on this computer" }, () => {
  const c = loadStudioConfig();
  assert.match(c.version, /^inimage-studio\.v\d+$/);
  const checks = checkPublisherSources([...c.sections, ...(c.sitemaps || [])], loadMediaPlan());
  for (const x of checks) assert.equal(x.formats["in-image"], true, `${x.id} cites a cell that is not in the media plan`);
  assert.ok(c.copy.ctas.length && c.copy.noClaims);
});

// ---------- the HTML creative in the mock renderer ----------
function png(w, h, [r, g, b]) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}
let srv, base, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-"));
  fs.writeFileSync(path.join(dir, "product.png"), png(200, 120, [200, 30, 30]));
  const page = ({ viewport = true, wall = false } = {}) => `<!doctype html><html><head>${viewport ? '<meta name="viewport" content="width=device-width">' : ""}</head><body style="margin:0;font:16px sans-serif">
    <h1>Test article</h1><img src="/lead-640x360.png" style="width:100%;display:block"><p>${FILLER}</p><p>${FILLER}</p>
    <figure style="margin:0"><img src="/walk.png" style="width:100%;display:block"></figure><p>${FILLER}</p>${wall ? "<div>This archive story requires a subscription</div>" : ""}<p>${FILLER}</p></body></html>`;
  srv = http.createServer((req, res) => {
    if (/\.png$/.test(req.url)) { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(png(800, 450, req.url.includes("walk") ? [30, 160, 60] : [40, 120, 200])); }
    // pages that change once the unit starts (data-go): a subscription wall drops in, or the article is blanked
    const later = (js) => page().replace("</body>", `<script>new MutationObserver((m, o) => { const u = document.getElementById("mk-slot"); if (u && u.hasAttribute("data-go")) { o.disconnect(); setTimeout(() => { ${js} }, 50); } }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-go"] });</script></body>`);
    const html = { "/a": page(), "/desktop": page({ viewport: false }), "/wall": page({ wall: true }), "/sized": page().replace("/walk.png", "/images/w-412,imgid-abc,imgname-walk.png"),
      "/late-wall": later(`const d = document.createElement("div"); d.textContent = "This archive story requires a subscription"; document.body.append(d);`),
      "/blanked": later(`for (const el of document.querySelectorAll("p, figure, h1, img")) el.style.display = "none";`) }[req.url];
    if (html) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
});
after(() => srv?.close());

const creative = (o = {}) => stripHtml({ brand: "Test", headline: "A headline that is rather long for a strip", subline: "And a second line that also runs long", cta: "Shop now", colour: "#e31b23", productUrl: ASSET_URL + "product.png", productMode: "plain-bg", ...o });
const opts = (url, image, extra = {}) => ({ articleUrl: base + url, leadImage: base + image, format: "in-image", outBase: path.join(dir, "m" + Math.random().toString(36).slice(2, 6)), creativeHtml: creative(), assets: { "product.png": path.join(dir, "product.png") }, fit: fitStrip, holdMs: 300, strict: true, ...extra });

test("HTML creative: placed over the chosen in-body picture (not the lead), its product picture served from the local file", { timeout: 90000 }, async () => {
  const out = await renderMock(opts("/a", "/walk.png"));
  assert.equal(out.slot.how, "the chosen article image");
  assert.ok(out.slot.y > 300, "the in-body picture, below the lead image");
  assert.ok(fs.statSync(out.png).size > 5000);
});

test("HTML creative: a size variant of the picture (WordPress -WxH suffix) still counts as the same picture", { timeout: 90000 }, async () => {
  const out = await renderMock(opts("/a", "/lead.png"));
  assert.equal(out.slot.how, "the chosen article image");
});

test("HTML creative: size and format tokens inside the picture's name (w-1280,h-720,format-jpg,…) still match the phone copy", { timeout: 90000 }, async () => {
  const out = await renderMock(opts("/sized", "/images/w-1280,h-720,format-jpg,imgid-abc,imgname-walk.png"));
  assert.equal(out.slot.how, "the chosen article image"); assert.ok(out.slot.y > 300);
});

test("HTML creative: the chosen picture missing from the page → SLOT_NOT_FOUND, never a different picture", { timeout: 90000 }, async () => {
  await assert.rejects(renderMock(opts("/a", "/other.png")), (/** @type {any} */ e) => e.code === "SLOT_NOT_FOUND");
});

test("HTML creative: a page without a phone layout, or behind a subscription wall, is refused", { timeout: 90000 }, async () => {
  await assert.rejects(renderMock(opts("/desktop", "/walk.png")), (/** @type {any} */ e) => e.code === "NOT_MOBILE");
  await assert.rejects(renderMock(opts("/wall", "/walk.png")), (/** @type {any} */ e) => e.code === "PAYWALL");
});

/* global document */
test("HTML creative: a wall that appears, or an article that is blanked, during the recording → no mock", { timeout: 90000 }, async () => {
  await assert.rejects(renderMock(opts("/late-wall", "/walk.png")), (/** @type {any} */ e) => e.code === "PAYWALL");
  await assert.rejects(renderMock(opts("/blanked", "/walk.png")), (/** @type {any} */ e) => e.code === "NOT_VISIBLE");
});

test("fitStrip: long copy shrinks until it sits above the button", { timeout: 60000 }, async () => {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 412, height: 400 } });
    await p.setContent('<div id="box" style="position:relative;width:380px;height:214px"></div>');
    await p.evaluate((html) => { const el = document.createElement("mk-unit"); el.id = "mk-slot"; el.style.cssText = "position:absolute;inset:0;display:block"; el.attachShadow({ mode: "open" }).innerHTML = html; document.getElementById("box").append(el); }, creative({ productUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }));
    await p.evaluate(`(${fitStrip})(document.getElementById("mk-slot"))`);
    const r = await p.evaluate(() => { const root = document.getElementById("mk-slot").shadowRoot, q = (s) => /** @type {HTMLElement} */ (root.querySelector(s)); const tx = q(".tx"), cta = q(".cta");
      return ["hd", "sb"].map((k) => ({ bottom: tx.offsetTop + q("." + k).offsetTop + q("." + k).offsetHeight, ctaTop: cta.offsetTop })); });
    for (const x of r) assert.ok(x.bottom <= x.ctaTop, `text ends at ${x.bottom}px, button starts at ${x.ctaTop}px`);
  } finally { await b.close(); }
});

// ---------- product cut-out and logo trimming (the Python helpers; synthetic pictures drawn here) ----------
const PY = process.platform === "win32" ? "python" : "python3";
const SCRIPTS = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "..", "pipeline", "scripts");
const hasPy = (() => { try { execFileSync(PY, ["-c", "import cv2, PIL, numpy"], { stdio: "ignore" }); return true; } catch { return false; } })();
const draw = (code, file) => execFileSync(PY, ["-c", `from PIL import Image, ImageDraw\n${code}\nim.save(r"${file}")`]);
const pyJson = (args) => JSON.parse(execFileSync(PY, args).toString().trim().split("\n").pop());

test("cut-out: a product on a plain studio background comes out with a transparent background; a real photo is kept whole", { skip: !hasPy && "Python with cv2/PIL not installed" }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cut-"));
  draw('im = Image.new("RGB", (400, 300), (250, 250, 250)); ImageDraw.Draw(im).ellipse((80, 60, 320, 240), fill=(200, 40, 40))', path.join(d, "shot.png"));
  const r = pyJson([path.join(SCRIPTS, "cutout.py"), "product", path.join(d, "shot.png"), path.join(d, "out.png")]);
  assert.equal(r.method, "plain-bg");
  assert.ok(r.w < 400 && r.h < 300, "trimmed to the product");
  const corner = execFileSync(PY, ["-c", `from PIL import Image; print(Image.open(r"${path.join(d, "out.png")}").getpixel((1, 1))[3])`]).toString().trim();
  assert.equal(corner, "0");
  draw('import random\nrandom.seed(1)\nim = Image.new("RGB", (300, 200))\nfor x in range(300):\n  for y in range(200): im.putpixel((x, y), (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)))', path.join(d, "photo.png"));
  assert.equal(pyJson([path.join(SCRIPTS, "cutout.py"), "product", path.join(d, "photo.png"), path.join(d, "out2.png")]).method, "photo");
});

test("logo trim: a fake transparency checkerboard is cleaned and cropped to the logo", { skip: !hasPy && "Python with cv2/PIL not installed" }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "logo-")), f = path.join(d, "logo.png");
  draw('im = Image.new("RGBA", (400, 400), (255, 255, 255, 255))\ndr = ImageDraw.Draw(im)\nfor x in range(0, 400, 20):\n  for y in range(0, 400, 20):\n    if (x + y) // 20 % 2: dr.rectangle((x, y, x + 19, y + 19), fill=(235, 235, 235, 255))\ndr.rectangle((50, 170, 350, 230), fill=(255, 90, 95, 255))', f);
  execFileSync(PY, [path.join(SCRIPTS, "trim_logo.py"), f]);
  const [w, h, c] = execFileSync(PY, ["-c", `from PIL import Image; im = Image.open(r"${f}").convert("RGB"); print(im.size[0], im.size[1], im.getpixel((2, 2)))`]).toString().trim().split(/ (?=\d+ |\()/);
  assert.ok(+w < 360 && +h < 100, `cropped to the logo (${w}×${h})`);
  assert.equal(c, "(255, 255, 255)", "checkerboard squares painted white");
});
