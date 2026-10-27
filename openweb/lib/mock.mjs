// Mock renderer: opens the real article in a headless phone browser, places the supplied source creative in the
// matched slot (in-image over the lead image, in-scroll between paragraphs, interstitial, or a display box), and
// saves a screenshot plus an optional short scroll video. Everything happens in our own browser only — nothing
// is sent to the publisher or any ad server. Each mock carries a visible "MOCK" badge and a JSON sidecar.
import fs from "node:fs";
import path from "node:path";

export class MockError extends Error { constructor(code, message) { super(message); this.code = code; } }

const TYPES = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
export const CREATIVE_URL = "https://mk-mock.invalid/creative";

// Runs inside the page. Other advertisers' slots and consent / app-install / sticky overlays would clutter the mock:
// hide them (never click them). Called before placing the creative and again right before capture, because
// publisher ads keep loading late.
export function tidyPage() {
  const vw = innerWidth, vh = innerHeight;
  const ADS = 'iframe, ins.adsbygoogle, [id^="div-gpt-ad"], [id*="google_ads"], [class*="ad-slot"], [class*="adslot"], [class*="ad-container"], [class*="advert"], [class~="ads"], [class^="ads-"], [class*=" ads-"], [class$="-ads"], [class*="-ads "], [id^="ads-"], [id*="-ads-"], [id*="_ads_"]';   // "ads" as its own word only (not "heads-", "threads-")
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(ADS))) if (!el.closest("#mk-slot, #mk-mark") && !el.querySelector("#mk-slot")) el.style.setProperty("display", "none", "important");
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("body *"))) {
    if (el.closest("#mk-slot, #mk-mark") || el.querySelector("#mk-slot")) continue;   // never our own unit or its overlay
    const cs = getComputedStyle(el); if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    const r = el.getBoundingClientRect(); if (r.width * r.height > vw * vh * 0.2 || (r.top > vh * 0.6 && r.height > 40)) el.style.setProperty("display", "none", "important");
  }
  document.documentElement.style.setProperty("overflow", "auto", "important"); document.body.style.setProperty("overflow", "auto", "important");
}

// Runs inside the page. Returns the slot's document rectangle, or { error }.
// Our unit lives in a shadow root on a custom <mk-unit> element (id "mk-slot") with !important inline styles, so the
// publisher's CSS cannot restyle, resize or hide the creative.
export function placeInPage({ format, src, isVideo, leadImage }) {
  const vw = innerWidth, vh = innerHeight;
  const imp = (css) => css.split(";").map((d) => d.trim()).filter(Boolean).map((d) => d + " !important").join(";");
  const unit = (hostCss, innerCss, { close = true, caption = false, mediaCss = "" } = {}) => {
    const host = document.createElement("mk-unit"); host.id = "mk-slot"; host.setAttribute("style", imp(hostCss));
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>:host{display:block}.u{${innerCss}}img,video{display:block;width:100%;height:auto;${mediaCss}}
      .b{position:absolute;top:6px;left:6px;z-index:3;font:600 10px/1 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:3px 6px;border-radius:4px;letter-spacing:.04em}
      .x{position:absolute;top:4px;right:6px;z-index:3;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font:600 15px/20px system-ui;text-align:center}
      .cap{font:600 10px/1 system-ui,sans-serif;letter-spacing:.12em;color:#888;text-align:center;padding:6px 0}</style>` +
      (caption ? `<div class="cap">ADVERTISEMENT</div>` : "") + `<div class="u"><span class="b">Ad</span>${close ? `<span class="x">×</span>` : ""}</div>`;
    const m = document.createElement(isVideo ? "video" : "img"); m.src = src; m.dataset.mkCreative = "1";
    if (isVideo) Object.assign(m, { muted: true, autoplay: true, loop: true, playsInline: true });
    root.querySelector(".u").prepend(m);
    return host;
  };
  const docRect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };
  const paragraphs = () => [.../** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("article p, main p, p"))].filter((p) => p.innerText.trim().length >= 80 && p.getBoundingClientRect().width > vw * 0.5);
  let slot;
  if (format === "in-image") {
    const imgs = [...document.querySelectorAll("img")].filter((i) => { const r = i.getBoundingClientRect(); return r.width >= vw * 0.6 && r.height >= 120 && i.naturalWidth >= 300; });
    const base = (leadImage || "").split("?")[0].split("/").pop();
    const img = imgs.find((i) => base && decodeURIComponent(i.currentSrc || i.src).includes(decodeURIComponent(base))) || imgs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    if (!img) return { error: "SLOT_NOT_FOUND: no lead image is rendered on the page" };
    // anchored to the image's own block container, so it stays on the image if the page shifts (late ads, lazy images)
    let host = img.parentElement; while (host.parentElement && getComputedStyle(host).display === "inline") host = host.parentElement;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const hr = host.getBoundingClientRect(), ir = img.getBoundingClientRect();
    host.append(unit(`position:absolute;left:${ir.left - hr.left + host.scrollLeft}px;top:${ir.top - hr.top + host.scrollTop}px;width:${ir.width}px;height:${ir.height}px;overflow:hidden;z-index:2147483000;pointer-events:none;margin:0;padding:0;border:0`,
      "position:absolute;left:0;right:0;bottom:0;max-height:100%;overflow:hidden;box-shadow:0 -6px 18px rgba(0,0,0,.25)"));
    slot = { ...docRect(img), how: base && decodeURIComponent(img.currentSrc || img.src).includes(decodeURIComponent(base)) ? "lead image (matches the article's declared image)" : "first large image on the page" };
  } else if (format === "in-scroll" || format === "display") {
    const ps = paragraphs(); const after = ps[Math.min(format === "display" ? 1 : 2, ps.length - 1)];
    if (!after) return { error: "SLOT_NOT_FOUND: no article paragraphs are rendered on the page" };
    const el = format === "display"
      ? unit("display:block;position:relative;width:300px;margin:18px auto;background:#f2f2f2;padding:0;border:0", "position:relative;width:300px;height:250px;overflow:hidden", { close: false, caption: true, mediaCss: "width:300px;height:250px;object-fit:contain" })
      : unit("display:block;position:relative;width:100%;margin:18px 0;background:#f2f2f2;padding:0;border:0", "position:relative;overflow:hidden", { close: false, caption: true });
    after.insertAdjacentElement("afterend", el);
    slot = { ...docRect(el), how: `after paragraph ${ps.indexOf(after) + 1}` };
  } else if (format === "interstitial") {
    document.body.append(unit("position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.82);display:grid;place-items:center;margin:0", "position:relative;width:88vw;max-height:86vh;overflow:hidden;border-radius:10px"));
    slot = { x: 0, y: scrollY, w: vw, h: vh, how: "full-screen interstitial" };
  } else return { error: `SLOT_NOT_FOUND: no mock layout for format ${format}` };
  const mark = document.createElement("mk-mark"); mark.id = "mk-mark"; mark.textContent = "MOCK · MediaKart · not a live ad";
  mark.setAttribute("style", imp("display:block;position:fixed;left:8px;bottom:8px;z-index:2147483647;font:700 11px/1 system-ui,sans-serif;color:#fff;background:rgba(176,0,204,.88);padding:6px 9px;border-radius:6px;letter-spacing:.03em"));
  document.body.append(mark);
  return slot;
}

// Chrome DevTools screencast while `act` runs → [{ file, ts }] JPEG frames at device pixels.
async function screencast(page, dir, act) {
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page), frames = /** @type {any} */ ([]);
  cdp.on("Page.screencastFrame", (f) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64")); frames.push({ file, ts: f.metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 824, maxHeight: 1830, everyNthFrame: 1 });
  try { await act(); } finally { await cdp.send("Page.stopScreencast").catch(() => {}); await cdp.detach().catch(() => {}); }
  frames.end = Date.now() / 1000;   // frames only arrive when the page changes: the last one is held until here
  return frames;
}

/**
 * @param {{ articleUrl: string, leadImage?: string|null, creativeFile: string, format: string, outBase: string, video?: boolean, ffmpeg?: ((args: string[]) => Promise<any>)|null, chromium?: any }} opts
 */
export async function renderMock({ articleUrl, leadImage, creativeFile, format, outBase, video = false, ffmpeg = null, chromium = null }) {
  const ext = path.extname(creativeFile).toLowerCase(), type = TYPES[ext];
  if (!type) throw new MockError("CREATIVE_TYPE", `Unsupported creative file type ${ext}`);
  if (!fs.existsSync(creativeFile)) throw new MockError("CREATIVE_MISSING", "The source creative file is not in the creatives folder yet");
  chromium = chromium || (await import("playwright")).chromium;
  const browser = await chromium.launch();
  const vdir = outBase + "_rec";
  try {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOBILE_UA, locale: "en-IN",
    });
    await ctx.route(CREATIVE_URL + ext, (r) => r.fulfill({ status: 200, contentType: type, body: fs.readFileSync(creativeFile) }));
    const page = await ctx.newPage();
    const resp = await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => { throw new MockError("PAGE_LOAD", e.message.slice(0, 200)); });
    if (!resp || resp.status() >= 400) throw new MockError("PAGE_LOAD", `The article returned HTTP ${resp?.status()} in the browser`);
    await page.waitForTimeout(2500);
    if (format === "in-image") {   // lead images often lazy-load: wait (up to 15 s) for a large decoded image before placing
      await page.waitForFunction(() => [...document.images].some((i) => { const r = i.getBoundingClientRect(); return r.width >= innerWidth * 0.6 && r.height >= 120 && i.complete && i.naturalWidth >= 300; }), null, { timeout: 15000 }).catch(() => {});
    }
    await page.evaluate(tidyPage);
    const slot = await page.evaluate(placeInPage, { format, src: CREATIVE_URL + ext, isVideo: type.startsWith("video"), leadImage });
    if (slot.error) throw new MockError("SLOT_NOT_FOUND", slot.error);
    // the creative must actually load and show — otherwise there is no mock to save
    const loaded = await page.waitForFunction(() => { const m = /** @type {any} */ (document.getElementById("mk-slot")?.shadowRoot?.querySelector("[data-mk-creative]")); return m && (m.tagName === "VIDEO" ? m.readyState >= 2 : m.complete && m.naturalWidth > 0); }, null, { timeout: 15000 }).then(() => true, () => false);
    if (!loaded) throw new MockError("CREATIVE_NOT_RENDERED", "The creative file did not load in the browser (corrupt or unsupported encoding?)");
    Object.assign(slot, await page.evaluate(() => { const r = document.getElementById("mk-slot").shadowRoot.querySelector(".u").getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    if (!(slot.w > 0 && slot.h > 0)) throw new MockError("CREATIVE_NOT_RENDERED", "The creative was placed but has no visible size on this page");
    await page.waitForTimeout(800);
    const target = Math.max(0, slot.y - (format === "in-image" ? 140 : 90));
    await page.evaluate(tidyPage);
    let frames = null;
    await page.evaluate(`setInterval(${tidyPage.toString()}, 250)`);   // publisher ads keep loading: keep them hidden while capturing
    if (video) {   // Chrome screencast at device resolution (824×1830): sharp, and animated creatives keep playing
      frames = await screencast(page, vdir, async () => {
        await page.waitForTimeout(600);
        await page.evaluate((y) => new Promise((done) => {   // one smooth 2 s eased scroll down to the slot
          const y0 = scrollY, t0 = performance.now();
          const step = (t) => { const k = Math.min(1, (t - t0) / 2000); scrollTo(0, y0 + (y - y0) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)); if (k < 1) requestAnimationFrame(step); else done(null); };
          requestAnimationFrame(step);
        }), target);
        await page.waitForTimeout(4000);
      });
    }
    else { await page.evaluate((y) => scrollTo(0, y), target); await page.waitForTimeout(1500); await page.evaluate(tidyPage); await page.waitForTimeout(300); }
    await page.screenshot({ path: outBase + ".png" });
    const out = { png: outBase + ".png", slot, viewport: "412×915 @2x (Android phone)" };
    await ctx.close();
    if (frames?.length && ffmpeg) {
      // variable-rate screencast frames → a constant 25 fps sequence (each tick shows the latest frame) → MP4
      const seq = path.join(vdir, "seq"); fs.mkdirSync(seq);
      const n = Math.max(1, Math.round((frames.end - frames[0].ts) * 25));
      for (let k = 0, j = 0; k < n; k++) {
        const t = frames[0].ts + k / 25; while (j + 1 < frames.length && frames[j + 1].ts <= t) j++;
        fs.copyFileSync(frames[j].file, path.join(seq, `s${String(k).padStart(5, "0")}.jpg`));
      }
      await ffmpeg(["-loglevel", "error", "-y", "-framerate", "25", "-i", path.join(seq, "s%05d.jpg"), "-vf", "scale=824:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", outBase + ".mp4"]);
      out.mp4 = outBase + ".mp4";
    }
    return out;
  } finally { await browser.close(); fs.rmSync(vdir, { recursive: true, force: true }); }
}
