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
import { stripHtml, fitStrip, luminance, STYLES, logoMode } from "../../openweb/lib/strip.mjs";
import { clientCreative } from "../../openweb/routes.mjs";
import { recentDevices, slugTitle, matchSlugs, sitemapIndex, loadStudioConfig, withRealName, usedArticles, rivalMatcher, styleFonts, studioRefusal, ctaFor, recentAdsRef, noMatchMessage } from "../../openweb/lib/studio.mjs";
import { renderMock, ASSET_URL, placeInPage, goCreative } from "../../openweb/lib/mock.mjs";
import { storyHtml, splitStory, hookFor, MOTIFS, STORY_MS } from "../../openweb/lib/story.mjs";
import { sceneHtml, deviceFor, DEVICES, directorPrompt } from "../../openweb/lib/director.mjs";
import { loadMediaPlan, checkPublisherSources } from "../../openweb/lib/inventory.mjs";
import { extractArticle } from "../../openweb/lib/extract.mjs";
import { FILLER } from "./helpers.mjs";
import { loadBrands, findBrand, brandBrief } from "../../openweb/lib/brands.mjs";

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
  assert.equal(withRealName("Order fresh food on Zomato", "food", "Zomato", "Zomato"), "Order fresh food on Zomato", "the bare brand never replaces the typed words");
  assert.equal(withRealName("Seafood fans love food", "food", "Fresh Meals", "X"), "Seafood fans love Fresh Meals", "whole words only");
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

test("the button follows what the brand sells: Shop now / Buy now in most cases, Book now for travel, Order now for delivery …; Explore only when nothing fits", () => {
  const st = loadStudioConfig(), b = loadBrands();
  const cta = (brand, product, aiCategory = "", aiCta = "Explore") => ctaFor({ rules: st.copy.ctaRules, ctas: st.copy.ctas, known: findBrand(b, brand, product), product, aiCategory, aiCta }).cta;
  assert.equal(cta("Bata", "Power running shoes"), "Shop now");
  assert.equal(cta("GIVA", "silver earrings"), "Shop now");
  assert.equal(cta("Tissot", "PRX watch"), "Shop now");
  assert.equal(cta("Samsung", "Galaxy S26"), "Buy now");
  assert.equal(cta("Motorola", "Edge 70", "Smartphones"), "Buy now");
  assert.equal(cta("Sprite", "lemon lime drink"), "Buy now");
  assert.equal(cta("IndiGo", "flights"), "Book now");
  assert.equal(cta("Swiggy", "Instamart"), "Order now");
  assert.equal(cta("Netflix", "subscription"), "Watch now");
  assert.equal(cta("Maruti Suzuki", "Swift"), "Book a test drive");
  assert.equal(cta("Hero MotoCorp", "Splendor"), "Book a test ride");
  assert.equal(cta("Godrej Properties", "new homes", "Real estate"), "Explore", "nothing to buy in a click: the AI's Explore stands");
  assert.ok(st.copy.ctaRules.every((r) => st.copy.ctas.includes(r.cta)), "every rule's button is in the allowed list");
});

test("brand-only ad (a service with no usable photo): no product picture or scene in the ad, the copy takes the width", () => {
  for (const style of STYLES) {
    const html = stripHtml({ brand: "Zomato", headline: "Dinner, sorted", subline: "Order from top restaurants", cta: "Order now", colour: "#e23744", productUrl: "https://a.test/none.png", productMode: "none", logoUrl: null, style });
    assert.ok(!html.includes("none.png"), `${style}: no product picture`);
    assert.ok(!/class="p |class="sc"/.test(html), `${style}: no product or scene element`);
    assert.ok(/\.tx\{[^}]*width:74cqw/.test(html), `${style}: wider copy`);
  }
});

test("recent ads as the reference: the brand's commercials (title, link, still) plus its recorded campaigns; cached per brand", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ref-")), cacheFile = path.join(dir, "recentads.json");
  let calls = 0;
  const findAds = async () => { calls++; return [{ id: "abc123", title: "Spicy Laga. Sprite Utha. | Sprite TVC", channel: "Coca-Cola India" }, { title: "no id" }]; };
  const known = { campaigns: [{ name: "Spicy Laga. Sprite Utha.", year: 2026, source: "https://x.test/a" }], adLook: "Green and white, comic tone" };
  const r = await recentAdsRef("Sprite", "lemon drink", { findAds, known, cacheFile });
  assert.equal(r.ads.length, 1);
  assert.deepEqual(r.ads[0], { id: "abc123", title: "Spicy Laga. Sprite Utha. | Sprite TVC", channel: "Coca-Cola India", url: "https://www.youtube.com/watch?v=abc123", still: "https://i.ytimg.com/vi/abc123/hqdefault.jpg" });
  assert.equal(r.campaigns[0].name, "Spicy Laga. Sprite Utha."); assert.equal(r.adLook, "Green and white, comic tone");
  await recentAdsRef("Sprite", "lemon drink", { findAds, known, cacheFile });
  assert.equal(calls, 1, "the second run reads the cache");
  const slow = await recentAdsRef("Slow", "x", { findAds: () => new Promise(() => {}), timeoutMs: 50 });
  assert.deepEqual(slow.ads, [], "a slow ad search never holds the run up");
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
  assert.ok(stripHtml({ ...base, productMode: "photo" }).includes('class="p photo"'));
  const scene = stripHtml({ ...base, productMode: "scene" });
  assert.ok(scene.includes('class="sc"') && !scene.includes('class="p '));
  assert.ok(luminance("#ffdf00") > 0.62 && stripHtml({ ...base, colour: "#ffdf00", productMode: "alpha" }).includes("color:#141414"));
  assert.ok(stripHtml({ ...base, colour: "#ffdf00", accent: "#d32f2f", productMode: "alpha" }).includes('class="pn"'), "contrasting accent → product panel");
  assert.ok(!stripHtml({ ...base, colour: "#e31b23", accent: "#e0201c", productMode: "alpha" }).includes('class="pn"'), "accent too close to the main colour → no panel");
  const one = stripHtml({ ...base, subline: "", productMode: "alpha" });
  assert.ok(!one.includes('class="sb"') && one.includes('class="tx one"'));
});

test("every design: no product card class; the product photo is never blended into a glow (accuracy over effect)", () => {
  for (const style of STYLES) for (const productMode of /** @type {("plain-bg"|"photo")[]} */ (["plain-bg", "photo"])) {
    const html = stripHtml({ brand: "B", headline: "H", subline: "S", cta: "Shop now", colour: "#e31b23", accent: "#ffd400", productUrl: "https://a.test/p.png", productMode, logoUrl: "https://a.test/l.png", logoKind: "mark", logoInk: "#e31b23", style });
    assert.ok(!/class="p card"/.test(html) && !/\.p\.card/.test(html), `${style}: no product card`);
    assert.ok(!/mix-blend-mode:multiply/.test(html), `${style}: the product photo is not blended`);
  }
});

test("logo display: the logo is never recoloured — own colours when it stands out, otherwise unchanged on an opaque plate; badges as they are", () => {
  assert.equal(logoMode({ kind: "mark", ink: "#cb2129", behind: "#e31b23" }), "chip");          // red Bata logo on a red strip: white plate, not an all-white logo
  assert.equal(logoMode({ kind: "mark", ink: "#111111", behind: "#ffd100" }), "colour");        // dark logo on yellow
  assert.equal(logoMode({ kind: "mark", ink: "#ffd100", behind: "#ffe14d" }), "chipd");
  assert.equal(logoMode({ kind: "mark", ink: "#17a84b", behind: "#d6ece0" }), "chip", "Sprite (Nov 2026): green on pale green went flat black — now unchanged on a plate");
  assert.equal(logoMode({ kind: "mark", ink: "#e8e9e9", behind: "#0f9a4a" }), "colour");
  assert.equal(logoMode({ kind: "mark", ink: "#f4f4f4", behind: "#f0f0f0" }), "chipd", "a light logo on a light strip gets a dark plate");
  assert.equal(logoMode({ kind: "badge", ink: "#e21f26", behind: "#ffd100" }), "badge");       // Maggi's oval
  assert.equal(logoMode({ kind: "photo", ink: "#888888", behind: "#222222" }), "chip");
  for (const [ink, behind] of [["#17a84b", "#d6ece0"], ["#cb2129", "#e31b23"], ["#4a0e2e", "#2a0819"], ["#fe5005", "#ff5200"]]) {
    const html = stripHtml({ brand: "B", headline: "h", cta: "Shop now", colour: behind, productUrl: "/a/p.png", productMode: "none", logoUrl: "/a/logo.png", logoKind: "mark", logoInk: ink, style: "fresh" });
    assert.doesNotMatch(html, /\.lg[^{]*img\{[^}]*(brightness|invert|grayscale|hue-rotate|sepia)/, "no filter ever recolours the logo");
    assert.match(html, /<img src="\/a\/logo\.png"/);
  }
});

test("product photo: shown as supplied — no blend, no faded edges, no colour filter", () => {
  const html = stripHtml({ brand: "B", headline: "h", cta: "Shop now", colour: "#0f9a4a", productUrl: "/a/p.jpg", productMode: "photo", style: "fresh" });
  const rule = (html.match(/\.p\.photo img\{[^}]*\}/) || [""])[0];
  assert.ok(rule, "photo rule present"); assert.doesNotMatch(rule, /mix-blend-mode|mask-image|filter/);
  const swiggy = stripHtml({ brand: "Swiggy", headline: "Freshness delivered in minutes", cta: "Order now", colour: "#ff5200", productUrl: "/a/product.png", productMode: "none", logoUrl: "/a/logo.png", logoKind: "mark", logoInk: "#fe5005", style: "journey" });
  assert.match(swiggy, /<div class="lg chip"><img src="\/a\/logo\.png"/);
  const html2 = swiggy;
  // the journey route is not drawn over a real photo (its pin landed on a person's face)
  const scene = stripHtml({ brand: "Swiggy", headline: "h", cta: "Order now", colour: "#ff5200", productUrl: "/a/p.png", productMode: "scene", style: "journey", motif: "pin" });
  assert.match(scene, /\.rt\{display:none\}/); assert.doesNotMatch(html2, /\.rt\{display:none\}/);
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
      // Mid-day style: the photo's container flips over like a card (rotateY 180°, back face hidden) as it scrolls in
      "/flip": later(`const f = document.querySelector("figure"); f.style.transition = "transform .3s"; f.style.transformStyle = "preserve-3d"; f.querySelector("img").style.backfaceVisibility = "hidden"; f.style.transform = "rotateY(180deg)";`),
      "/pic-removed": later(`document.querySelector("figure img").style.setProperty("display", "none", "important");`),
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
test("HTML creative: a publisher effect that flips the photo away (Mid-day) is held still — the photo and the ad stay on screen", { timeout: 90000 }, async () => {
  const out = await renderMock(opts("/flip", "/walk.png", { holdMs: 1200 }));
  assert.equal(out.slot.how, "the chosen article image");
});

test("HTML creative: the photo removed by the page during the recording → no video (NOT_VISIBLE)", { timeout: 90000 }, async () => {
  await assert.rejects(renderMock(opts("/pic-removed", "/walk.png")), (/** @type {any} */ e) => e.code === "NOT_VISIBLE");
});

test("HTML creative: a wall that appears, or an article that is blanked, during the recording → no mock", { timeout: 90000 }, async () => {
  await assert.rejects(renderMock(opts("/late-wall", "/walk.png")), (/** @type {any} */ e) => e.code === "PAYWALL");
  await assert.rejects(renderMock(opts("/blanked", "/walk.png")), (/** @type {any} */ e) => e.code === "NOT_VISIBLE");
});

test("designs: every one keeps the parts the text fitting and the checks rely on, escapes copy, and looks different", () => {
  const html = (style, o = {}) => creative({ style, headline: "Hi <b>there</b>", productMode: style === "journey" ? "scene" : "plain-bg", ...o });
  const seen = new Set();
  for (const st of STYLES) {
    const h = html(st);
    for (const cls of ['class="lg', 'class="tx', 'class="hd"', 'class="sb"', 'class="cta"', `st-${st}"`]) assert.ok(h.includes(cls), `${st}: ${cls}`);
    assert.ok(!h.includes("<b>there</b>") && h.includes("&lt;b&gt;there&lt;/b&gt;"), `${st}: copy escaped`);
    assert.match(h, /data-lg="[\d.]+" data-tx="[\d.]+" data-fs="[\d.]+" data-fs2="[\d.]+"/);
    seen.add(h.split("</style>")[0].length);
  }
  assert.equal(seen.size, STYLES.length, "each design has its own CSS");
  assert.ok(html("fresh").includes('class="bb"') && html("fresh", { motif: "steam" }).includes('class="stm"'), "fresh: bubbles for drinks, steam for food");
  assert.ok(html("luxe").includes('class="sp"') && html("sport").includes('class="sl"') && html("tech").includes('class="bm"'));
  assert.ok(html("journey").includes("✈") && html("journey", { motif: "pin" }).includes("📍"));
  assert.ok(creative({ style: "no-such-design" }).includes("st-bold"), "an unknown design falls back to bold");
});

test("client's ad file: the type is read from the file's own bytes; anything else (or too big) is refused", () => {
  const url = (buf) => "data:application/octet-stream;base64," + Buffer.from(buf).toString("base64");
  assert.deepEqual([clientCreative(url([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])).ext, clientCreative(url([0x89, 0x50, 0x4e, 0x47])).type], ["png", "image"]);
  assert.equal(clientCreative(url([0xff, 0xd8, 0xff, 0xe0])).ext, "jpg");
  assert.equal(clientCreative(url(Buffer.from("GIF89a"))).ext, "gif");
  assert.equal(clientCreative(url(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).ext, "webp");
  assert.deepEqual([clientCreative(url(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom")]))).ext, clientCreative(url(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom")]))).type], ["mp4", "video"]);
  assert.equal(clientCreative(url([0x1a, 0x45, 0xdf, 0xa3])).ext, "webm");
  assert.ok(clientCreative(url(Buffer.from("<html><script>"))).error, "an HTML file renamed .png is refused");
  assert.ok(clientCreative("not a data url").error);
  assert.ok(clientCreative(url(Buffer.alloc(41e6))).error, "over 40 MB");
});

test("fitStrip: long copy shrinks until it sits above the button, in every design", { timeout: 90000 }, async () => {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 412, height: 400 } });
    for (const style of STYLES) {
      await p.setContent('<div id="box" style="position:relative;width:380px;height:214px"></div>');
      await p.evaluate((html) => { const el = document.createElement("mk-unit"); el.id = "mk-slot"; el.style.cssText = "position:absolute;inset:0;display:block"; el.attachShadow({ mode: "open" }).innerHTML = html; document.getElementById("box").append(el); },
        creative({ style, productMode: style === "journey" ? "scene" : "plain-bg", productUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }));
      await p.evaluate(`(${fitStrip})(document.getElementById("mk-slot"))`);
      const r = await p.evaluate(() => { const root = document.getElementById("mk-slot").shadowRoot, q = (s) => /** @type {HTMLElement} */ (root.querySelector(s)); const tx = q(".tx"), cta = q(".cta");
        return ["hd", "sb"].map((k) => ({ bottom: tx.offsetTop + q("." + k).offsetTop + q("." + k).offsetHeight, ctaTop: cta.offsetTop })); });
      for (const x of r) assert.ok(x.bottom <= x.ctaTop, `${style}: text ends at ${x.bottom}px, button starts at ${x.ctaTop}px`);
    }
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
  // silver on white: the cut-out would eat the product and keep the background inside the hoop → the original photo
  draw('im = Image.new("RGB", (400, 400), (252, 252, 252)); dr = ImageDraw.Draw(im); dr.ellipse((100, 60, 300, 340), outline=(205, 205, 210), width=22); dr.ellipse((150, 300, 250, 330), fill=(225, 225, 228))', path.join(d, "silver.png"));
  assert.equal(pyJson([path.join(SCRIPTS, "cutout.py"), "product", path.join(d, "silver.png"), path.join(d, "out3.png")]).method, "photo");
});

test("logo keying: a logo on a white background becomes transparent everywhere, holes inside letters too; a filled multi-colour shape is a badge", { skip: !hasPy && "Python with cv2/PIL not installed" }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "logok-"));
  draw('im = Image.new("RGB", (400, 160), (255, 255, 255)); dr = ImageDraw.Draw(im); dr.ellipse((40, 30, 140, 130), outline=(200, 20, 30), width=18); dr.rectangle((170, 40, 360, 120), fill=(200, 20, 30))', path.join(d, "mark.png"));
  const r = pyJson([path.join(SCRIPTS, "cutout.py"), "logo", path.join(d, "mark.png"), path.join(d, "mark_out.png")]);
  assert.equal(r.kind, "mark"); assert.equal(r.keyed, true); assert.equal(r.colours, 1);
  const hole = execFileSync(PY, ["-c", `from PIL import Image; im = Image.open(r"${path.join(d, "mark_out.png")}"); w, h = im.size; print(im.getpixel((int(w * 0.24), h // 2))[3])`]).toString().trim();
  assert.equal(hole, "0", "the middle of the O is transparent, not white");
  draw('im = Image.new("RGB", (300, 200), (255, 255, 255)); dr = ImageDraw.Draw(im); dr.ellipse((10, 10, 290, 190), fill=(225, 30, 38)); dr.rectangle((90, 80, 210, 120), fill=(255, 210, 0))', path.join(d, "badge.png"));
  assert.equal(pyJson([path.join(SCRIPTS, "cutout.py"), "logo", path.join(d, "badge.png"), path.join(d, "badge_out.png")]).kind, "badge");
});

test("logo trim: a fake transparency checkerboard is cleaned and cropped to the logo", { skip: !hasPy && "Python with cv2/PIL not installed" }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "logo-")), f = path.join(d, "logo.png");
  draw('im = Image.new("RGBA", (400, 400), (255, 255, 255, 255))\ndr = ImageDraw.Draw(im)\nfor x in range(0, 400, 20):\n  for y in range(0, 400, 20):\n    if (x + y) // 20 % 2: dr.rectangle((x, y, x + 19, y + 19), fill=(235, 235, 235, 255))\ndr.rectangle((50, 170, 350, 230), fill=(255, 90, 95, 255))', f);
  execFileSync(PY, [path.join(SCRIPTS, "trim_logo.py"), f]);
  const [w, h, c] = execFileSync(PY, ["-c", `from PIL import Image; im = Image.open(r"${f}").convert("RGB"); print(im.size[0], im.size[1], im.getpixel((2, 2)))`]).toString().trim().split(/ (?=\d+ |\()/);
  assert.ok(+w < 360 && +h < 100, `cropped to the logo (${w}×${h})`);
  assert.equal(c, "(255, 255, 255)", "checkerboard squares painted white");
});

// ---------- brand knowledge, design fonts and the client's own file ----------

test("brand knowledge: 50 brands, valid; a typed brand or a sub-brand in the product finds the right profile", () => {
  const c = loadBrands();
  assert.equal(c.brands.length, 50);
  assert.equal(findBrand(c, "Nestle", "Maggi 2-minute noodles").name, "Maggi");
  assert.equal(findBrand(c, "maggie", "noodles").name, "Maggi", "common misspelling is an alias");
  assert.equal(findBrand(c, "Coke", "Zero Sugar").id, "coca-cola");
  assert.equal(findBrand(c, "ITC", "Bingo Mad Angles").name, "Bingo!");
  assert.equal(findBrand(c, "GIVA", "earrings"), null, "brands not on the list are left to the AI");
  const oppo = findBrand(c, "OPPO", "Reno");
  assert.ok(oppo.family.includes("OnePlus") && !oppo.competitors.includes("OnePlus"), "a sister brand is never a rival");
  const sprite = findBrand(c, "Sprite", "lemon lime");
  assert.ok(sprite.family.includes("Thums Up") && sprite.competitors.includes("7UP") && sprite.domains.includes("coca-cola.com/in/en/brands/sprite"));
  assert.match(brandBrief(sprite), /Competitors: .*7UP.*Same company \(never competitors\): .*Thums Up/);
});

test("design fonts: fetched once from Google Fonts into a local cache, then served from local files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gf-")); let calls = 0;
  const fake = /** @type {any} */ (async (u) => { calls++; return u.includes("css2") ? { ok: true, text: async () => "@font-face{font-family:'Anton';src:url(https://fonts.gstatic.com/s/anton/v1/a.woff2) format('woff2')}" } : { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; });
  const a = await styleFonts("sport", dir, fake);
  assert.ok(a.css.includes(ASSET_URL + "gf-sport-0.woff2") && fs.existsSync(a.files["gf-sport-0.woff2"]));
  const n = calls; await styleFonts("sport", dir, fake);
  assert.equal(calls, n, "second time: nothing fetched");
  assert.equal(await styleFonts("bold", dir, fake), null, "bold uses the local Poppins");
});

test("client's own ad: the supplied file is placed over the chosen picture with the same page checks", { timeout: 90000 }, async () => {
  const f = path.join(dir, "client.png"); fs.writeFileSync(f, png(600, 200, [20, 90, 200]));
  const out = await renderMock({ articleUrl: base + "/a", leadImage: base + "/walk.png", format: "in-image", outBase: path.join(dir, "client"), creativeFile: f, holdMs: 300, strict: true });
  assert.equal(out.slot.how, "the chosen article image"); assert.ok(out.slot.y > 300);
  await assert.rejects(renderMock({ articleUrl: base + "/wall", leadImage: base + "/walk.png", format: "in-image", outBase: path.join(dir, "client2"), creativeFile: f, holdMs: 300, strict: true }), (/** @type {any} */ e) => e.code === "PAYWALL");
});

test("products that may not be advertised are refused before any work starts (infant formula and infant food — IMS Act)", () => {
  const c = loadBrands();
  for (const [b, p] of [["Nestle", "NAN Pro infant formula"], ["Nestle", "Cerelac"], ["Cerelac", "wheat apple"]]) assert.match(studioRefusal(c, b, p) || "", /IMS Act/, `${b} / ${p}`);
  assert.equal(studioRefusal(c, "Nestle", "Maggi noodles"), null);
  assert.equal(studioRefusal(c, "GIVA", "earrings"), null, "brands not on the list are not blocked");
});

// Réal fruit juice (2026-10-29): the stop message named a weak "safe" article as the best and hid why the strong one failed
test("no match: the message says how many articles were checked, the closest fits and what each missed, and that search is off", () => {
  const c = (headline, url, v, score) => ({ a: { headline, url }, v, score });
  const scored = [
    c("Prabhu Deva's breakfast routine", "u1", { context_fit: 5, safe: true, strip_ok: true }, 4.5),
    c("Whole fruit vs juice: what people with diabetes should know", "u2", { context_fit: 8, safe: false, safe_why: "Health warnings about juice." }, 8.4),
    c("Whole fruit vs juice: what people with diabetes should know", "u2", { context_fit: 8, safe: false, safe_why: "Health warnings about juice." }, 8.4),
  ];
  const m = noMatchMessage({ brand: "Réal", product: "fruit juice", scored, minContext: 8, minScore: 7, searchOn: false });
  assert.match(m, /^No article fits Réal fruit juice right now — 2 articles checked\. Closest: “Whole fruit vs juice/);
  assert.match(m, /\(fit 8\/10\): not brand-safe — Health warnings about juice · “Prabhu Deva's breakfast routine” \(fit 5\/10\): only a loose fit \(5\/10, needs 8\)\./);
  assert.match(m, /Article search is off \(add a Firecrawl key in Settings\)/);
  assert.doesNotMatch(noMatchMessage({ brand: "B", product: "p", scored, minContext: 8, minScore: 7, searchOn: true }), /search is off/);
});

// ---------- the story creative (hook over the page → frosted takeover with the medallion → message → strip) ----------
const story = (o = {}) => storyHtml({ brand: "Test", headline: "Fizz <b>up</b> your meal", subline: "Second line", cta: "Buy now", colour: "#e41e2b", accent: "#ffffff", productUrl: ASSET_URL + "product.png", productMode: "alpha", style: "fresh", motif: "bubbles", ...o });

test("story: the strip waits for act 4 (data-go2), the hook goes on the page layer, the copy is escaped", () => {
  const [own, page] = splitStory(story());
  assert.ok(page, "a hook layer for the page");
  assert.match(own, /:host\(\[data-go2\]\) \.s\{/, "the strip's own entrance starts on data-go2");
  assert.match(own, /:host\(\[data-go\]\) \.md\{/, "the takeover starts on data-go");
  assert.ok(own.includes(`data-go2="${STORY_MS}"`));
  assert.ok(!own.includes("<b>up</b>") && own.includes("&lt;b&gt;up&lt;/b&gt;"));
  assert.match(page, /<use href="#k"\/>/); assert.ok((page.match(/class="f/g) || []).length >= 8, "enough hook elements");
  assert.equal(story(), story(), "the same brand always gets the same scatter");
  assert.ok(story({ claim: "99.9% <protection>" }).includes("&lt;protection&gt;"), "an approved claim takes the medallion's back");
  assert.deepEqual(splitStory("<div>strip</div>"), ["<div>strip</div>", null]);
});

test("story: every hook draws, old motif names map to a hook", () => {
  for (const h of MOTIFS) assert.match(splitStory(story({ hook: h }))[1], /<g id="k"/, h);
  assert.equal(hookFor("steam"), "leaves"); assert.equal(hookFor("none"), "bokeh"); assert.equal(hookFor("bubbles"), "bubbles"); assert.equal(hookFor("nonsense"), "bokeh");
});

test("story: placed on the page, the hook layer sits over the picture and act 4 follows data-go", { timeout: 90000 }, async () => {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 412, height: 900 } });
    await p.goto(base + "/a");
    const slot = /** @type {any} */ (await p.evaluate(placeInPage, { format: "in-image", src: "", isVideo: false, leadImage: base + "/walk.png", html: story(), strict: true }));
    assert.equal(slot.how, "the chosen article image");
    const r = await p.evaluate(() => {
      const u = document.getElementById("mk-slot"), pg = document.getElementById("mk-page"), a = u.getBoundingClientRect(), c = pg.getBoundingClientRect();
      /** @type {HTMLElement} */ (u.shadowRoot.querySelector("[data-go2]")).dataset.go2 = "150";   // act 4 sooner, for the test
      return { dx: Math.abs(a.left - c.left) + Math.abs(a.top - c.top) + Math.abs(a.width - c.width), flyers: pg.shadowRoot.querySelectorAll(".f").length };
    });
    assert.ok(r.dx < 2, "the hook layer covers the picture's box"); assert.ok(r.flyers >= 8);
    await p.evaluate(goCreative);
    assert.ok(await p.evaluate(() => document.getElementById("mk-page").hasAttribute("data-go")));
    await p.waitForFunction(() => document.getElementById("mk-slot").hasAttribute("data-go2"), null, { timeout: 3000 });
  } finally { await b.close(); }
});

// ---------- the creative director (one idea per ad, staged by a device) ----------
const look = /** @type {any} */ ({ brand: "Test", headline: "Strip line", subline: "Second", cta: "Buy now", colour: "#e41e2b", accent: "#ffffff", productUrl: ASSET_URL + "product.png", productMode: "alpha", style: "fresh", photoUrl: "https://a.test/photo.jpg" });

test("director: every device stages its own scene, then the strip on data-go2; copy escaped; classes never clash with the strip", () => {
  const stripClasses = new Set([...stripHtml(look).matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const seen = new Set();
  for (const device of DEVICES.filter((d) => d !== "medallion")) {
    const h = sceneHtml(look, { device, message: "Cold <b>as</b> ice", kicker: "Hot day?", base: "#e41e2b", accent: "#fff", liquid: "#f6a400", product_fx: ["shine", "droplets", "rim", "reflection", "glints"] });
    assert.ok(h.includes(`data-device="${device}"`), device);
    assert.match(h, /:host\(\[data-go2\]\) \.s\{/, `${device}: the strip waits for act 2`);
    assert.ok(!h.includes("<b>as</b>") && h.includes("&lt;b&gt;as&lt;/b&gt;"), `${device}: copy escaped`);
    const scene = h.slice(h.indexOf('<div class="dz"'));
    const mine = [...scene.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => !["white", "black", "colour", "reverse", "badge", "chip", "text"].includes(c));
    for (const c of mine) assert.ok(!stripClasses.has(c), `${device}: class ${c} is also the strip's`);
    seen.add(scene.length);
  }
  assert.equal(seen.size, 5, "five different scenes");
  assert.ok(splitStory(sceneHtml(look, { device: "medallion", message: "Hi" }))[1], "medallion is the story with its hook layer");
  assert.ok(splitStory(sceneHtml({ ...look, photoUrl: null }, { device: "shatter", message: "Hi" }))[1], "shatter needs the article photo, else the medallion story");
  assert.ok(sceneHtml(look, { device: "frost", message: "x", product_fx: ["droplets"] }).includes('class="dDew"'), "condensation on a cold cut-out");
  assert.ok(!sceneHtml({ ...look, productMode: "photo" }, { device: "frost", message: "x", product_fx: ["droplets"] }).includes('class="dDew"'), "no condensation masked onto a photo");
});

test("director: rules pick a device when the AI is not available; the brief prompt carries the recent devices", () => {
  assert.equal(deviceFor({ style: "fresh", hook: "bubbles", category: "Soft drinks" }), "frost");
  assert.equal(deviceFor({ style: "fresh", hook: "leaves", category: "Coffee" }), "pour");
  assert.equal(deviceFor({ style: "luxe", hook: "sparkle", category: "Jewellery" }), "spotlight");
  assert.equal(deviceFor({ style: "journey", hook: "flight", category: "Airline" }), "portal");
  assert.equal(deviceFor({ style: "sport", hook: "speed", category: "Running shoes" }), "shatter");
  assert.equal(deviceFor({ style: "bold", hook: "insects", category: "Mosquito repellent" }), "medallion");
  const p = directorPrompt({ brand: "B", product: "p", category: "", imageAlt: "", headline: "h", articleHeadline: "a", colours: ["#000000"], recent: ["frost", "pour"] });
  assert.match(p, /Recent ads already used: frost, pour/);
});

test("director: recentDevices lists the newest ads' devices, skipping withdrawn ones and the index", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-"));
  const put = (b, t, r) => { fs.mkdirSync(path.join(root, b, t), { recursive: true }); fs.writeFileSync(path.join(root, b, t, "result.json"), JSON.stringify(r)); };
  put("a", "1", { createdAt: "2026-10-29T10:00:00Z", director: { device: "frost" } });
  put("b", "1", { createdAt: "2026-10-29T11:00:00Z", director: { device: "portal" } });
  put("c", "1", { createdAt: "2026-10-29T12:00:00Z", director: { device: "pour" }, error: "withdrawn" });
  put("_index", "x", { createdAt: "2026-10-29T13:00:00Z", director: { device: "shatter" } });
  assert.deepEqual(recentDevices(root), ["portal", "frost"]);
});
