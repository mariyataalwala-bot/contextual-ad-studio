// In-article images for in-image placements. Two steps:
//  1. extractImages(html, url, article) — no network. Finds the images that belong to the article (between the headline
//     and the end of the article text), reads lazy-load sources and srcsets, alt text, captions and the paragraphs around
//     each image, and drops what is not article content: icons, logos, tracking pixels, placeholders, and thumbnails that
//     link to other articles ("related stories").
//  2. fetchImages(images, …) — downloads only those images (robots.txt honoured, size and type checked) to record the
//     real dimensions, a content hash and a perceptual hash, and marks duplicates. Nothing else on the page is fetched.
import { sha256, norm } from "./text.mjs";
import { decodeEntities } from "./extract.mjs";

export const IMAGES_VERSION = "images.v1";
const MIN_W = 300, MIN_H = 150, MAX_PER_ARTICLE = 8, MAX_BYTES = 8 * 1024 * 1024;
const NOT_CONTENT = /\b(logo|icon|avatar|author|byline|sprite|badge|emoji|share|whatsapp|twitter|facebook|instagram|youtube|reddit|telegram|zodiac|app[- ]download|newsguard|print|bullet|rapid ?read|advert|sponsor|banner|placeholder|blank|spacer|pixel|tracker)\b/i;
const TRACKER = /scorecardresearch|facebook\.com\/tr|doubleclick|googlesyndication|google-analytics|\/track_?1x1|pixel\.|\/beacon|bat\.bing|1x1\.(gif|png|jpe?g)/i;
const SIZE_PARAMS = /^(w|h|width|height|resize|fit|crop|quality|q|im|impolicy|imwidth|imheight|dpr|format|auto|size|ssl|strip|zoom|ver|v)$/i;

const attrsOf = (tag) => { const out = {}; for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? ""); return out; };
const abs = (u, base) => { try { return new URL(String(u).trim(), base).href; } catch { return null; } };
const textOf = (html) => norm(decodeEntities(String(html).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")));
const px = (v) => { const n = parseInt(String(v || ""), 10); return Number.isFinite(n) && n > 0 ? n : null; };
const isPlaceholder = (u) => !u || /^data:/i.test(u) || /\/1627283897|lazy[-_]?load|placeholder|blank\.(gif|png)|transparent\.(gif|png)|spacer\.|\/default[-_]?(\d+x\d+)?\.(jpe?g|png|gif)(\?|$)/i.test(u);

/** The largest candidate of a srcset ("url 640w, url 1280w" or "url 1x, url 2x"). */
export function largestFromSrcset(srcset, base) {
  let best = null;
  for (const part of String(srcset || "").split(/,\s+(?=\S)/)) {
    const [u, d] = part.trim().split(/\s+/); if (!u) continue;
    const mw = /^(\d+)w$/.exec(d || ""), mx = /^(\d+(?:\.\d+)?)x$/.exec(d || "");
    const w = mw ? +mw[1] : mx ? +mx[1] * 1000 : 1;
    const a = abs(u, base); if (a && !isPlaceholder(a) && (!best || w > best.w)) best = { url: a, w };
  }
  return best;
}

/** Same picture at another size → same id: query size parameters and WordPress "-300x200" suffixes are ignored. */
export function canonicalImageId(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (SIZE_PARAMS.test(k)) x.searchParams.delete(k);
    const pathname = x.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.\w{3,4}$)/, "").replace(/\/(?:\d{2,4}x\d{2,4}|w\d{2,4}|h\d{2,4})\//g, "/");
    const key = `${x.host.toLowerCase()}${pathname.toLowerCase()}${x.searchParams.toString() ? "?" + x.searchParams.toString() : ""}`;
    return { id: sha256(key).slice(0, 16), key };
  } catch { return { id: sha256(String(u)).slice(0, 16), key: String(u) }; }
}

/**
 * @param {string} html @param {string} url @param {Record<string, any>} article  (from extractArticle: headline, body, image)
 * @returns {{ version: string, window: { start: number, end: number, how: string }, images: any[], skipped: Record<string, number> }}
 */
export function extractImages(html, url, article) {
  /** @type {Record<string, number>} */ const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  // --- the article window: from the headline to the end of the last body paragraph
  const bodyN = norm(article.body || "").toLowerCase();
  const paras = [...html.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: textOf(m[0]) }))
    .filter((p) => p.text.length >= 40 && (!bodyN || bodyN.includes(p.text.toLowerCase().slice(0, 60))));
  const h1 = /<h1[\s>]/i.exec(html);
  const start = h1 ? h1.index : paras.length ? Math.max(0, paras[0].start - 4000) : 0;
  const end = paras.length ? paras[paras.length - 1].end + 1500 : html.length;
  const how = paras.length ? `headline → ${paras.length} article paragraph(s) matched to the article text` : "no article paragraphs found — whole page";
  // --- anchors (to spot thumbnails that link to other articles) and figures (captions)
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ start: m.index, end: m.index + m[0].length, href: attrsOf(`<a ${m[1]}>`).href || "" }));
  const figures = [...html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)].map((m) => ({ start: m.index, end: m.index + m[0].length, cap: (/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(m[0]) || [])[1] }));
  const here = (() => { try { const u = new URL(url); return u.host + u.pathname.replace(/\/$/, ""); } catch { return url; } })();
  const leadUrl = article.image?.url ? abs(article.image.url, url) : null, leadId = leadUrl ? canonicalImageId(leadUrl).id : null;

  const found = new Map();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const pos = m.index;
    if (pos < start || pos > end) { skip("outside the article"); continue; }
    const a = attrsOf(m[0]);
    const set = largestFromSrcset(a["data-srcset"] || a["data-lazy-srcset"] || a.srcset, url);
    const direct = [a["data-src"], a["data-lazy-src"], a["data-original"], a["data-url"], a.src].map((x) => (x ? abs(x, url) : null)).find((x) => x && !isPlaceholder(x));
    const src = set?.url || direct;
    if (!src) { skip("no image address (placeholder or empty)"); continue; }
    if (TRACKER.test(src)) { skip("tracking pixel"); continue; }
    if (/\.svg(\?|$)/i.test(src)) { skip("vector icon"); continue; }
    const label = `${a.alt || ""} ${a.title || ""} ${a.class || ""} ${a.id || ""}`;
    if (NOT_CONTENT.test(label) || /\/(icons?|logos?|static\/images?|themes\/[^/]+\/im)/i.test(src)) { skip("icon / logo / page furniture"); continue; }
    const w = px(a.width), h = px(a.height);
    if ((w && w < 200) || (h && h < 100)) { skip("too small (declared size)"); continue; }
    const link = anchors.find((x) => x.start < pos && x.end > pos);
    if (link && link.href && !/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(link.href) && !link.href.startsWith("#")) {
      const lu = (() => { try { const u = new URL(link.href, url); return u.host + u.pathname.replace(/\/$/, ""); } catch { return ""; } })();
      if (lu && lu !== here) { skip("links to another article (related story)"); continue; }
    }
    const { id, key } = canonicalImageId(src);
    if (found.has(id)) { found.get(id).seen++; skip("duplicate in the article"); continue; }
    const fig = figures.find((f) => f.start < pos && f.end > pos);
    let caption = fig?.cap ? textOf(fig.cap) : null;
    if (!caption) {   // the next caption-like element within a short distance (sites without <figcaption>)
      const after = html.slice(pos + m[0].length, pos + m[0].length + 1500);
      const c = /<(?:p|div|span)[^>]*class=["'][^"']*(?:caption|wp-caption-text|img-desc|photo-?credit)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|span)>/i.exec(after);
      if (c) caption = textOf(c[1]) || null;
    }
    const before = paras.filter((p) => p.end <= pos).pop(), next = paras.find((p) => p.start >= pos);
    found.set(id, { id, key, src, srcset: set ? "largest srcset candidate" : null, alt: norm(a.alt || "") || null, title: norm(a.title || "") || null,
      caption, declared: { width: w, height: h }, lazy: !!(a["data-src"] || a["data-srcset"] || a["data-lazy-src"] || /lazy/i.test(a.loading || "") || /lazy/i.test(a.class || "")),
      context: { before: before?.text.slice(0, 600) || null, after: next?.text.slice(0, 600) || null, paragraphIndex: before ? paras.indexOf(before) + 1 : 0 },
      lead: id === leadId, htmlPos: pos, seen: 1 });
  }
  let images = [...found.values()].sort((x, y) => x.htmlPos - y.htmlPos);
  // the declared lead image is always a candidate (some sites place it outside the article markup)
  if (leadUrl && !images.some((i) => i.lead) && !TRACKER.test(leadUrl)) {
    const { id, key } = canonicalImageId(leadUrl);
    images.unshift({ id, key, src: leadUrl, srcset: null, alt: null, title: null, caption: null, declared: { width: article.image.width || null, height: article.image.height || null }, lazy: false,
      context: { before: null, after: paras[0]?.text.slice(0, 600) || null, paragraphIndex: 0 }, lead: true, htmlPos: -1, seen: 1, declaredOnly: true });
  }
  if (images.length > MAX_PER_ARTICLE) { skip(`over ${MAX_PER_ARTICLE} images (kept the first ${MAX_PER_ARTICLE})`); images = images.slice(0, MAX_PER_ARTICLE); }
  images.forEach((im, i) => { im.index = i + 1; delete im.htmlPos; });
  return { version: IMAGES_VERSION, window: { start, end, how }, images, skipped };
}

// --- image bytes → real dimensions (JPEG / PNG / WebP / GIF headers; no image library needed)
/** @param {Buffer} b */
export function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { type: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString("ascii", 0, 3) === "GIF") return { type: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const f = b.toString("ascii", 12, 16);
    if (f === "VP8X") return { type: "webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (f === "VP8 ") return { type: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (f === "VP8L") { const v = b.readUInt32LE(21); return { type: "webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  }
  if (b.length > 24 && b.toString("ascii", 4, 8) === "ftyp" && /avif|avis|heic|mif1/.test(b.toString("ascii", 8, 32))) {   // AVIF / HEIF: the "ispe" box
    const i = b.indexOf("ispe");
    if (i > 0 && i + 16 <= b.length) return { type: "avif", width: b.readUInt32BE(i + 8), height: b.readUInt32BE(i + 12) };
    return { type: "avif", width: null, height: null };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1], len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: "jpeg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { type: "jpeg", width: null, height: null };
  }
  return { type: null, width: null, height: null };
}

/** 64-bit difference hash from a 9×8 grayscale thumbnail (72 bytes) → 16 hex chars. */
export function dHash(gray9x8) {
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray9x8[y * 9 + x] > gray9x8[y * 9 + x + 1] ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}
export const hamming = (a, b) => { let x = BigInt("0x" + a) ^ BigInt("0x" + b), n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

/**
 * Downloads the extracted images (only those) and records status, real size, content hash and perceptual hash.
 * @param {any[]} images @param {{ fetchImpl?: any, allowed?: (url: string) => Promise<boolean>, gray9x8?: ((file: string) => Promise<ArrayLike<number>|null>) | null, tmpDir?: string | null, fs?: any, path?: any, timeoutMs?: number }} o
 */
export async function fetchImages(images, { fetchImpl = globalThis.fetch, allowed = async () => true, gray9x8 = null, tmpDir = null, fs = null, path = null, timeoutMs = 15000 } = {}) {
  for (const im of images) {
    im.fetchedAt = new Date().toISOString();
    try {
      if (!(await allowed(im.src))) { im.status = "blocked"; im.statusDetail = "robots.txt disallows this image"; continue; }
      const r = await fetchImpl(im.src, { headers: { Accept: "image/jpeg,image/png,image/webp;q=0.9,image/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      im.finalUrl = r.url || im.src;
      if (r.status === 403 || r.status === 429) { im.status = "blocked"; im.statusDetail = `HTTP ${r.status}`; continue; }
      if (!r.ok) { im.status = "unavailable"; im.statusDetail = `HTTP ${r.status}`; continue; }
      const type = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!/^image\//.test(type)) { im.status = "not_image"; im.statusDetail = type || "no content type"; continue; }
      const len = +(r.headers.get("content-length") || 0);
      if (len > MAX_BYTES) { im.status = "too_large"; im.statusDetail = `${len} bytes`; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) { im.status = "too_large"; im.statusDetail = `${buf.length} bytes`; continue; }
      const sz = imageSize(buf);
      Object.assign(im, { contentType: type, bytes: buf.length, bytesHash: sha256(buf.toString("base64")), width: sz.width, height: sz.height });
      if (!sz.width || !sz.height) { im.status = "unreadable"; im.statusDetail = "could not read the image size"; continue; }
      if (sz.width < MIN_W || sz.height < MIN_H) { im.status = "too_small"; im.statusDetail = `${sz.width}×${sz.height} < ${MIN_W}×${MIN_H}`; continue; }
      im.status = "ok";
      if (gray9x8 && tmpDir && fs && path) {   // perceptual hash (finds the same picture re-encoded or resized)
        fs.mkdirSync(tmpDir, { recursive: true }); const f = path.join(tmpDir, `${im.id}.${sz.type === "jpeg" ? "jpg" : sz.type || "img"}`);
        fs.writeFileSync(f, buf);
        try { const g = await gray9x8(f); if (g && g.length >= 72) im.pHash = dHash(g); } catch { /* perceptual hash is optional */ }
        try { fs.unlinkSync(f); } catch { /* temp file */ }
      }
    } catch (e) { im.status = "unavailable"; im.statusDetail = String(/** @type {any} */ (e).cause?.code || /** @type {any} */ (e).message || e).slice(0, 160); }
  }
  // duplicates: identical bytes, or a near-identical picture (perceptual hash within 6 of 64 bits)
  const ok = images.filter((i) => i.status === "ok");
  for (let i = 0; i < ok.length; i++) for (let j = 0; j < i; j++) {
    if (ok[j].status !== "ok") continue;
    if (ok[i].bytesHash === ok[j].bytesHash || (ok[i].pHash && ok[j].pHash && hamming(ok[i].pHash, ok[j].pHash) <= 6)) { ok[i].status = "duplicate"; ok[i].dupOf = ok[j].id; break; }
  }
  return images;
}
