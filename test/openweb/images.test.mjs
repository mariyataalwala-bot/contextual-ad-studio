// In-article images (in-image placements, stage 1): which images belong to the article, their context, and the checks
// on the image files themselves. All HTML and image bytes here are synthetic test data written for these tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractImages, fetchImages, imageSize, canonicalImageId, largestFromSrcset, dHash, hamming } from "../../openweb/lib/images.mjs";
import { extractArticle } from "../../openweb/lib/extract.mjs";
import { analyseUrl } from "../../openweb/lib/pipeline.mjs";
import { makeStore } from "../../openweb/lib/store.mjs";
import { cfg, FILLER } from "./helpers.mjs";

const URL1 = "https://www.example-news.test/food/noodle-study-1.html";
const P = (t) => `<p>${t} ${FILLER}</p>`;
function page({ lead = "https://img.example-news.test/2026/10/lead.jpg", body = "", sidebar = "" } = {}) {
  const ld = { "@context": "https://schema.org", "@type": "NewsArticle", headline: "What India eats for breakfast", articleBody: [1, 2, 3, 4].map((n) => `Paragraph ${n} about breakfast habits. ${FILLER}`).join("\n\n"), image: lead };
  return `<!doctype html><html><head><title>t</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>
  <header><img src="https://www.example-news.test/static/images/logo.png" alt="logo" width="160" height="40"></header>
  <h1>What India eats for breakfast</h1>
  <img src="https://img.example-news.test/2026/10/lead.jpg?w=1024" alt="A plate of poha" width="1024" height="576"><p class="caption">Poha is a popular breakfast. (Photo: Test)</p>
  ${P("Paragraph 1 about breakfast habits.")}
  ${body}
  ${P("Paragraph 2 about breakfast habits.")}${P("Paragraph 3 about breakfast habits.")}${P("Paragraph 4 about breakfast habits.")}
  ${"<div>space</div>".repeat(200)}
  <aside>${sidebar}</aside></body></html>`;
}
const imgs = (html, url = URL1) => { const a = extractArticle(html, url); return extractImages(html, url, a); };

test("article images: the lead image (with its caption) and a lazy in-body image (largest srcset), with the paragraphs around it", () => {
  const r = imgs(page({ body: `<figure><img class="lazyload wp-image-1" src="data:image/gif;base64,R0lGOD" data-src="https://img.example-news.test/2026/10/bowl.jpg?resize=60" data-srcset="https://img.example-news.test/2026/10/bowl-300x169.jpg 300w, https://img.example-news.test/2026/10/bowl-1024x576.jpg 1024w" alt="Bowl of noodles" width="1600" height="900"><figcaption>Noodles served at a street stall.</figcaption></figure>` }));
  assert.equal(r.images.length, 2);
  const [lead, inBody] = r.images;
  assert.equal(lead.lead, true); assert.equal(lead.alt, "A plate of poha"); assert.match(lead.caption, /Poha is a popular breakfast/);
  assert.equal(inBody.lead, false); assert.equal(inBody.lazy, true);
  assert.equal(inBody.src, "https://img.example-news.test/2026/10/bowl-1024x576.jpg", "largest srcset candidate, not the placeholder or the 60 px version");
  assert.equal(inBody.caption, "Noodles served at a street stall.");
  assert.match(inBody.context.before, /^Paragraph 1/); assert.match(inBody.context.after, /^Paragraph 2/); assert.equal(inBody.context.paragraphIndex, 1);
});

test("not article content: logos, icons, tracking pixels, placeholders, small thumbnails, related-story links and the sidebar are left out", () => {
  const body = `<img src="https://www.facebook.com/tr?id=1&ev=PageView" width="1" height="1">
    <img src="https://img.example-news.test/icons/share.svg" alt="share">
    <img src="data:image/gif;base64,R0lGODlhAQAB" alt="">
    <img src="https://img.example-news.test/2026/10/thumb.jpg" alt="Another story" width="80" height="45">
    <a href="https://www.example-news.test/food/other-story-9.html"><img src="https://img.example-news.test/2026/10/related.jpg" alt="Read this other story" width="640" height="360"></a>
    <img src="https://img.example-news.test/static_news/images/default-218x145.jpg">`;
  const r = imgs(page({ body, sidebar: `<img src="https://img.example-news.test/2026/10/sidebar.jpg" alt="Trending" width="640" height="360">` }));
  assert.deepEqual(r.images.map((i) => i.src), ["https://img.example-news.test/2026/10/lead.jpg?w=1024"]);
  for (const k of ["tracking pixel", "vector icon", "no image address (placeholder or empty)", "too small (declared size)", "links to another article (related story)", "outside the article"]) assert.ok(r.skipped[k] >= 1, k);
});

test("duplicates: the same picture at other sizes is one image; a declared lead image outside the markup still counts", () => {
  const body = `<img src="https://img.example-news.test/2026/10/lead.jpg?resize=300" alt="again" width="600" height="338"><img src="https://img.example-news.test/2026/10/lead-300x169.jpg" alt="again" width="600" height="338">`;
  const r = imgs(page({ body }));
  assert.equal(r.images.length, 1, "lead.jpg?w=1024, lead.jpg?resize=300 and the WordPress size lead-300x169.jpg are one picture");
  assert.equal(r.images[0].seen, 3); assert.equal(r.skipped["duplicate in the article"], 2);
  assert.equal(canonicalImageId("https://a.test/x/pic.jpg?w=1024&q=80").id, canonicalImageId("https://a.test/x/pic.jpg?resize=60").id);
  assert.equal(canonicalImageId("https://a.test/x/pic-300x200.jpg").id, canonicalImageId("https://a.test/x/pic.jpg").id);
  assert.notEqual(canonicalImageId("https://a.test/x/pic.jpg?id=1").id, canonicalImageId("https://a.test/x/pic.jpg?id=2").id, "non-size parameters keep images apart");
  const html = page({ lead: "https://cdn.example-news.test/og/lead-og.jpg" });
  const r2 = imgs(html);
  assert.ok(r2.images.some((i) => i.lead && i.declaredOnly && i.src === "https://cdn.example-news.test/og/lead-og.jpg"));
});

test("at most 8 images per article", () => {
  const body = Array.from({ length: 12 }, (_, i) => `<img src="https://img.example-news.test/2026/10/p${i}.jpg" alt="photo ${i}" width="800" height="450">`).join("");
  const r = imgs(page({ body }));
  assert.equal(r.images.length, 8); assert.ok(Object.keys(r.skipped).some((k) => /over 8 images/.test(k)));
});

test("srcset: the largest width (or density) wins; placeholders are ignored", () => {
  assert.equal(largestFromSrcset("a.jpg 320w, b.jpg 1280w, c.jpg 640w", "https://x.test/").url, "https://x.test/b.jpg");
  assert.equal(largestFromSrcset("a.jpg 1x, b.jpg 2x", "https://x.test/").url, "https://x.test/b.jpg");
  assert.equal(largestFromSrcset("data:image/gif;base64,AAA 1x", "https://x.test/"), null);
});

// ---------- image files ----------
const png = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const res = (status, type, body, extra = {}) => /** @type {any} */ ({ ok: status >= 200 && status < 300, status, url: extra.url, headers: { get: (k) => ({ "content-type": type, "content-length": extra.len ?? String(body?.length || 0) })[k.toLowerCase()] ?? null }, arrayBuffer: async () => body });

test("image files: real size from the bytes (PNG, JPEG, AVIF)", () => {
  assert.deepEqual(imageSize(png(800, 450)), { type: "png", width: 800, height: 450 });
  assert.deepEqual(imageSize(jpeg(1280, 720)), { type: "jpeg", width: 1280, height: 720 });
  assert.equal(imageSize(Buffer.from("not an image")).width, null);
  // AVIF (some CDNs send it whenever a browser offers it): size from the "ispe" box
  const avif = Buffer.alloc(64); avif.writeUInt32BE(28, 0); avif.write("ftypavif", 4, "ascii"); avif.write("mif1avif", 16, "ascii");
  avif.write("ispe", 40, "ascii"); avif.writeUInt32BE(1600, 48); avif.writeUInt32BE(900, 52);
  assert.deepEqual(imageSize(avif), { type: "avif", width: 1600, height: 900 });
});

test("image files: usable, too small, unavailable, blocked, not an image, too large, unreadable, network error", async () => {
  const files = {
    "https://i.test/ok.png": res(200, "image/png", png(800, 450)), "https://i.test/small.png": res(200, "image/png", png(120, 80)),
    "https://i.test/gone.jpg": res(404, "text/html", Buffer.from("x")), "https://i.test/bot.jpg": res(403, "text/html", Buffer.from("x")),
    "https://i.test/page.jpg": res(200, "text/html", Buffer.from("<html>")), "https://i.test/huge.jpg": res(200, "image/jpeg", Buffer.alloc(10), { len: String(9 * 1024 * 1024) }),
    "https://i.test/broken.jpg": res(200, "image/jpeg", Buffer.from("garbage bytes here")),
  };
  const fetchImpl = async (u) => { if (u === "https://i.test/down.jpg") throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }); return files[u]; };
  /** @type {any[]} */ const list = ["ok.png", "small.png", "gone.jpg", "bot.jpg", "page.jpg", "huge.jpg", "broken.jpg", "down.jpg", "robots.jpg"].map((f, i) => ({ id: "i" + i, src: "https://i.test/" + f }));
  await fetchImages(list, { fetchImpl, allowed: async (u) => !u.endsWith("robots.jpg") });
  assert.deepEqual(list.map((x) => x.status), ["ok", "too_small", "unavailable", "blocked", "not_image", "too_large", "unreadable", "unavailable", "blocked"]);
  assert.equal(list[0].width, 800); assert.match(list[0].bytesHash, /^[0-9a-f]{64}$/);
  assert.match(list[7].statusDetail, /ENOTFOUND/); assert.match(list[8].statusDetail, /robots/);
});

test("duplicates by content: identical bytes, or the same picture re-encoded (perceptual hash)", async () => {
  const a = png(800, 450), b = Buffer.concat([png(800, 450), Buffer.from([1])]), c = Buffer.concat([png(640, 360), Buffer.from([2, 2, 2])]);
  const files = { "https://i.test/a.png": a, "https://i.test/a2.png": a, "https://i.test/b.png": b, "https://i.test/c.png": c };
  const fetchImpl = async (u) => res(200, "image/png", files[u]);
  const grayFor = { a: Array.from({ length: 72 }, (_, i) => (i * 37) % 256), c: Array.from({ length: 72 }, (_, i) => 255 - ((i * 37) % 256)) };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owimg-"));
  const gray9x8 = async (file) => (fs.readFileSync(file).length === b.length || fs.readFileSync(file).length === a.length ? grayFor.a : grayFor.c);   // b = a re-encoded (same look)
  /** @type {any[]} */ const list = ["a.png", "a2.png", "b.png", "c.png"].map((f, i) => ({ id: "d" + i, src: "https://i.test/" + f }));
  await fetchImages(list, { fetchImpl, gray9x8, tmpDir, fs, path });
  assert.deepEqual(list.map((x) => x.status), ["ok", "duplicate", "duplicate", "ok"]);
  assert.equal(list[1].dupOf, "d0"); assert.equal(list[2].dupOf, "d0");
  assert.equal(hamming(dHash(grayFor.a), dHash(grayFor.a)), 0); assert.ok(hamming(dHash(grayFor.a), dHash(grayFor.c)) > 6);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("pipeline: images are stored with the article; repeated images across articles keep one record that lists both", async () => {
  const store = makeStore(fs.mkdtempSync(path.join(os.tmpdir(), "owimg-")));
  const html = page({ body: `<img src="https://img.example-news.test/2026/10/bowl.jpg" alt="Bowl" width="800" height="450">` });
  const fetcher = { get: async () => ({ text: html, finalUrl: URL1 }), allowed: async () => true };
  const fetchImpl = async () => res(200, "image/png", png(800, 450));
  const a1 = await analyseUrl({ url: URL1, publisher: { id: "p1" }, fetcher, cfg, store, ask: null, fetchImpl });
  const URL2 = "https://www.example-news.test/food/noodle-study-2.html";
  const a2 = await analyseUrl({ url: URL2, publisher: { id: "p1" }, fetcher: { ...fetcher, get: async () => ({ text: html, finalUrl: URL2 }) }, cfg, store, ask: null, fetchImpl });
  assert.equal(a1.images.length, 2); assert.equal(a1.versions.images, "images.v1");
  assert.equal(a1.images[0].status, "ok"); assert.equal(a1.images[1].status, "duplicate", "same bytes as the lead image in this fake");
  const rec = store.getImage(a1.images[0].id);
  assert.deepEqual(rec.articleIds.sort(), [a1.id, a2.id].sort());
  assert.equal(rec.uses[a1.id].alt, "A plate of poha"); assert.equal(rec.width, 800);
  assert.ok(a1.imagesInfo.skipped["outside the article"] >= 1, "the header logo sits above the headline");
  // a later check replaces the file-level result (no stale status notes), keeping the per-article uses
  store.saveImage({ id: rec.id, index: 1, lead: true, alt: "A plate of poha", src: rec.src, status: "unavailable", statusDetail: "HTTP 404", fetchedAt: "2026-10-28T00:00:00Z" }, a1.id);
  const again = store.getImage(rec.id);
  assert.equal(again.status, "unavailable"); assert.equal(again.width, undefined, "old size is not kept after a failed re-check");
  assert.deepEqual(again.articleIds.sort(), [a1.id, a2.id].sort()); assert.equal(again.firstSeenAt, rec.firstSeenAt);
});

test("an article that could not be fetched has no images and no image requests", async () => {
  const store = makeStore(fs.mkdtempSync(path.join(os.tmpdir(), "owimg-"))), seen = [];
  const fetcher = { get: async () => { throw Object.assign(new Error("gone"), { code: "HTTP_404" }); }, allowed: async () => true };
  const a = await analyseUrl({ url: URL1, publisher: { id: "p1" }, fetcher, cfg, store, ask: null, fetchImpl: async (u) => { seen.push(u); return res(200, "image/png", png(800, 450)); } });
  assert.equal(a.error.code, "HTTP_404"); assert.equal(a.images, undefined); assert.deepEqual(seen, []);
});
