// Mock renderer in a real headless browser, against a synthetic local article page (no internet).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { renderMock, MockError, tidyPage } from "../../openweb/lib/mock.mjs";
import { FILLER } from "./helpers.mjs";

// Solid-colour PNGs built here (valid PNG: signature, IHDR, IDAT, IEND)
function png(w, h, [r, g, b]) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = png(320, 100, [176, 0, 204]), LEAD = png(800, 450, [40, 120, 200]);
let srv, base, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "owmock-"));
  fs.writeFileSync(path.join(dir, "creative.png"), PNG);
  const page = (paras) => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0;font:16px sans-serif">
    <header style="height:60px;background:#222"></header><h1>Test article</h1><img src="/lead.png" style="width:100%;display:block">
    ${paras.map((p) => `<p>${p}</p>`).join("")}<div style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#000;color:#fff">Cookie banner</div></body></html>`;
  srv = http.createServer((req, res) => {
    if (req.url === "/lead.png") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(LEAD); }
    if (req.url === "/article") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(page([FILLER, FILLER, FILLER, FILLER])); }
    if (req.url === "/hostile") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>figure{position:relative;margin:0;height:232px} figure img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover} figure div, figure span{display:none}</style><body style="margin:0"><h1>Hostile CSS page</h1><figure><img src="/lead.png"></figure><p>${FILLER}</p></body>`); }
    if (req.url === "/tidy") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(`<!doctype html><body><div class="threads-list heads-up" id="content"><p>${FILLER}</p></div><div class="advert-box" id="adbox">Advertisement</div><iframe id="google_ads_iframe_1"></iframe><div class="row ads" id="ads1">x</div><div id="mk-slot">ours</div>`); }
    if (req.url === "/noimage") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(page([FILLER]).replace('<img src="/lead.png" style="width:100%;display:block">', "")); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
});
after(() => srv?.close());

for (const format of ["in-image", "in-scroll", "interstitial", "display"]) {
  test(`renders a ${format} mock (no watermark on the page)`, { timeout: 90000 }, async () => {
    const outBase = path.join(dir, "m_" + format);
    const out = await renderMock({ articleUrl: base + "/article", leadImage: base + "/lead.png", creativeFile: path.join(dir, "creative.png"), format, outBase });
    assert.ok(fs.statSync(out.png).size > 1000);
    assert.ok(out.slot.w > 0 && out.slot.how);
    if (format === "in-image") assert.match(out.slot.how, /lead image/);
    if (format === "in-scroll") assert.match(out.slot.how, /after paragraph 3/);
  });
}
test("no rendered lead image → SLOT_NOT_FOUND (no mock is faked)", { timeout: 90000 }, async () => {
  await assert.rejects(renderMock({ articleUrl: base + "/noimage", leadImage: null, creativeFile: path.join(dir, "creative.png"), format: "in-image", outBase: path.join(dir, "x") }), (e) => e instanceof MockError && e.code === "SLOT_NOT_FOUND");
});
test("missing creative file and unsupported type are refused before opening a browser", async () => {
  await assert.rejects(renderMock({ articleUrl: base + "/article", creativeFile: path.join(dir, "nope.png"), format: "in-image", outBase: path.join(dir, "y") }), (/** @type {any} */ e) => e.code === "CREATIVE_MISSING");
  await assert.rejects(renderMock({ articleUrl: base + "/article", creativeFile: path.join(dir, "a.exe"), format: "in-image", outBase: path.join(dir, "y") }), (/** @type {any} */ e) => e.code === "CREATIVE_TYPE");
});
test("a corrupt creative file is reported, not mocked", { timeout: 90000 }, async () => {
  fs.writeFileSync(path.join(dir, "bad.png"), "this is not an image");
  await assert.rejects(renderMock({ articleUrl: base + "/article", leadImage: base + "/lead.png", creativeFile: path.join(dir, "bad.png"), format: "in-image", outBase: path.join(dir, "b") }), (/** @type {any} */ e) => e.code === "CREATIVE_NOT_RENDERED");
});
test("a page that errors is reported, not mocked", { timeout: 90000 }, async () => {
  await assert.rejects(renderMock({ articleUrl: base + "/missing", creativeFile: path.join(dir, "creative.png"), format: "in-image", outBase: path.join(dir, "z") }), (/** @type {any} */ e) => e.code === "PAGE_LOAD");
});

test("page tidy-up hides publisher ad slots but never article content or our own unit", { timeout: 60000 }, async () => {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  try {
    const p = await b.newPage(); await p.goto(base + "/tidy"); await p.evaluate(tidyPage);
    const shown = await p.evaluate(() => Object.fromEntries(["content", "adbox", "google_ads_iframe_1", "ads1", "mk-slot"].map((id) => [id, getComputedStyle(document.getElementById(id)).display !== "none"])));
    assert.deepEqual(shown, { content: true, adbox: false, google_ads_iframe_1: false, ads1: false, "mk-slot": true });
  } finally { await b.close(); }
});

// ffmpeg from PATH or the WinGet install the app itself uses
const FFMPEG = (() => { for (const c of ["ffmpeg", path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages")]) {
  if (c === "ffmpeg") { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return "ffmpeg"; } catch { continue; } }
  try { for (const d of fs.readdirSync(c).filter((n) => n.startsWith("Gyan.FFmpeg"))) for (const e of fs.readdirSync(path.join(c, d))) { const f = path.join(c, d, e, "bin", "ffmpeg.exe"); if (fs.existsSync(f)) return f; } } catch { /* not installed here */ }
} return null; })();
test("scroll video: 824×1830 MP4 from the screencast, page loading not included", { timeout: 120000, skip: !FFMPEG && "ffmpeg not installed" }, async () => {
  const ffmpeg = async (args) => execFileSync(FFMPEG, args);
  const out = await renderMock({ articleUrl: base + "/article", leadImage: base + "/lead.png", creativeFile: path.join(dir, "creative.png"), format: "in-scroll", outBase: path.join(dir, "vid"), video: true, ffmpeg });
  const probe = execFileSync(FFMPEG.replace(/ffmpeg(\.exe)?$/, (m) => m.replace("ffmpeg", "ffprobe")), ["-v", "error", "-show_entries", "stream=width,height", "-show_entries", "format=duration", "-of", "json", out.mp4]).toString();
  const j = JSON.parse(probe);
  assert.equal(j.streams[0].width, 824); assert.equal(j.streams[0].height, 1830);
  assert.ok(+j.format.duration > 4 && +j.format.duration < 12, "duration " + j.format.duration);
});

test("the publisher's own CSS cannot collapse or hide the creative (shadow-DOM unit)", { timeout: 90000 }, async () => {
  const out = await renderMock({ articleUrl: base + "/hostile", leadImage: base + "/lead.png", creativeFile: path.join(dir, "creative.png"), format: "in-image", outBase: path.join(dir, "hostile") });
  assert.ok(out.slot.h > 50 && out.slot.w > 300, JSON.stringify(out.slot));
});
