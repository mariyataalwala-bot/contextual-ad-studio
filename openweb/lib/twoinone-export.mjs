// 2-in-1 ads: the downloadable video. The unit is injected into the REAL article page opened in a phone browser (as the
// In-Image studio does for its mocks), its opening and card play over the dimmed article, and the screen is recorded at
// 1080×1920 (9:16) and written as an MP4 — the same kind of file as In-Image's "Download video". Everything happens in our
// own browser; nothing is sent to the publisher or any ad server. If the article cannot be opened in the browser (blocked,
// paywalled, too slow) the recording is made on our own article page instead and says so.
/* global document, window */
import fs from "node:fs";
import path from "node:path";
import { tidyPage, screencast, ASSET_URL } from "./mock.mjs";

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
export const SCREEN = { w: 360, h: 640, scale: 3 };   // CSS pixels × device scale = 1080×1920

/**
 * @param {{ fontCss?: string, introSeconds?: number, articleUrl: string, parts: { css: string, html: string, js: string }, fallbackHtml: string, assetsDir: string, outBase: string, seconds: number,
 *   ffmpeg: (a: string[]) => Promise<any>, chromium?: any, navTimeoutMs?: number, say?: (m: string) => void }} o
 * @returns {Promise<{ mp4: string, png: string, page: "article"|"fallback", why?: string, seconds: number, geometry: { t: number, geom: any }[] }>}
 */
export async function recordTwoInOne({ fontCss = "", introSeconds = 2.3, articleUrl, parts, fallbackHtml, assetsDir, outBase, seconds, ffmpeg, chromium = null, navTimeoutMs = 40000, say = () => {} }) {
  chromium = chromium || (await import("playwright")).chromium;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const vdir = outBase + "_rec";
  try {
    const ctx = await browser.newContext({ viewport: { width: SCREEN.w, height: SCREEN.h }, deviceScaleFactor: SCREEN.scale, isMobile: true, hasTouch: true, userAgent: MOBILE_UA, locale: "en-IN" });
    // our pictures, the client's video file and fonts come from local files, requested as ASSET_URL + name
    await ctx.route((u) => u.href.startsWith(ASSET_URL), (r) => {
      const rel = decodeURIComponent(new URL(r.request().url()).pathname.replace(/^\/asset\//, "")), file = path.resolve(assetsDir, rel);
      if (!file.startsWith(path.resolve(assetsDir) + path.sep) || !fs.existsSync(file)) return r.fulfill({ status: 404, body: "" });
      r.fulfill({ status: 200, contentType: TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", body: fs.readFileSync(file) });
    });
    const page = await ctx.newPage();
    let which = /** @type {"article"|"fallback"} */ ("article"), why = "";
    say("Opening the article in a phone browser…");
    const resp = await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: navTimeoutMs }).catch((e) => { why = String(e.message).slice(0, 120); return null; });
    if (resp && resp.status() >= 400) why = `the article answered HTTP ${resp.status()} in the browser`;
    if (why || !resp) { which = "fallback"; await page.setContent(fallbackHtml, { waitUntil: "load" }); await page.waitForTimeout(800); }
    else {
      await page.waitForTimeout(2500);
      const ok = await page.evaluate(() => document.body && document.body.innerText.length > 400).catch(() => false);
      if (!ok) { which = "fallback"; why = "the article page was empty in the browser"; await page.setContent(fallbackHtml, { waitUntil: "load" }); await page.waitForTimeout(800); }
      else { await page.evaluate(tidyPage).catch(() => {}); await page.evaluate(() => window.scrollTo({ top: 320, behavior: "smooth" })).catch(() => {}); await page.waitForTimeout(1400); await page.evaluate(tidyPage).catch(() => {}); }
    }
    if (fontCss) { await page.addStyleTag({ content: fontCss }).catch(() => {}); await page.evaluate(() => document.fonts.ready).catch(() => {}); }
    // the unit lives in a shadow root over the page, so the publisher's own styles never touch it; Runtime.evaluate is not subject to the page's CSP
    if (which === "article") {
      await page.evaluate(`(()=>{const host=document.createElement("div");host.id="mk-2in1";host.style.cssText="all:initial;position:fixed;inset:0;z-index:2147483647";document.body.appendChild(host);
        const root=host.attachShadow({mode:"open"});root.innerHTML=${JSON.stringify(`<style>${parts.css}</style>${parts.html}`)};${parts.js};window.__mk=mkInit(root);})()`);
    } else await page.evaluate(`${parts.js};window.__mk=mkInit(document);`);
    const geometry = /** @type {{ t: number, geom: any }[]} */ ([]);
    const frames = await screencast(page, vdir, async () => {
      say("Recording the 2-in-1 unit…");
      const started = Date.now();
      await page.evaluate("window.__mk.open()");
      // the layout is measured while it plays: once the words have arrived, again when the chips are in, and just before the end
      for (const at of [introSeconds + 2.3, introSeconds + 5.3, Math.max(introSeconds + 6.1, seconds - 1.2)].filter((x) => x < seconds)) {
        const wait = at * 1000 - (Date.now() - started); if (wait > 0) await page.waitForTimeout(wait);
        geometry.push({ t: at, geom: await page.evaluate("window.__mk.geom()").catch(() => null) });
      }
      await page.waitForTimeout(Math.max(0, Math.round(seconds * 1000) - (Date.now() - started)));
    }, { w: SCREEN.w * SCREEN.scale, h: SCREEN.h * SCREEN.scale });
    const png = outBase + ".png";
    await page.screenshot({ path: png });
    await ctx.close();
    if (!frames.length) throw new Error("The browser recorded no frames.");
    // variable-rate screencast frames → a constant 25 fps sequence (each tick shows the latest frame) → MP4
    const seq = path.join(vdir, "seq"); fs.mkdirSync(seq, { recursive: true });
    const n = Math.max(1, Math.round((frames.end - frames[0].ts) * 25));
    for (let k = 0, j = 0; k < n; k++) {
      const t = frames[0].ts + k / 25; while (j + 1 < frames.length && frames[j + 1].ts <= t) j++;
      fs.copyFileSync(frames[j].file, path.join(seq, `s${String(k).padStart(5, "0")}.jpg`));
    }
    await ffmpeg(["-loglevel", "error", "-y", "-framerate", "25", "-i", path.join(seq, "s%05d.jpg"), "-vf", "scale=1080:1920:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-movflags", "+faststart", outBase + ".mp4"]);
    return { mp4: outBase + ".mp4", png, page: which, ...(why ? { why } : {}), seconds: +(n / 25).toFixed(1), geometry: geometry.filter((g) => g.geom) };
  } finally { await browser.close(); fs.rmSync(vdir, { recursive: true, force: true }); }
}
