// Product pictures found online: Bing image search (the public results page, read like a browser would; nothing is
// bypassed — a bot-check page is reported as an error). When Bing answers with pictures that have nothing to do with the query
// (it does that to scripted requests, whatever was asked — Nov 2026: Ali G posters for "Maaza juice"), DuckDuckGo's public image
// results are used instead. Each result keeps the page it came from, so every picture
// used in a mock can be traced back to its source.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const unent = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Parses the results page: every tile carries a JSON `m` attribute with the full-size picture (murl), Bing's
// thumbnail (turl), the page it is on (purl) and that page's title (t).
export function parseBingImages(html) {
  const out = [], seen = new Set();
  for (const x of html.matchAll(/ m="(\{[^"]*\})"/g)) {
    let m; try { m = JSON.parse(unent(x[1])); } catch { continue; }
    if (!m.murl || !m.purl || seen.has(m.murl)) continue;
    let host; try { host = new URL(m.purl).host.replace(/^www\./, ""); } catch { continue; }
    seen.add(m.murl);
    out.push({ url: m.murl, thumb: m.turl || null, page: m.purl, host, title: String(m.t || "").replace(/[\u{E000}-\u{F8FF}]/gu, "").trim() });
  }
  return out;
}

// Does this result list answer the query at all? Words of the query (4+ letters) must appear in the titles, pages or addresses of
// several of the first results. A list of unrelated pictures is worse than none: the AI would reject every one of them.
const GENERIC = new Set(["with", "from", "india", "indian", "product", "photo", "image", "pack", "packshot", "official", "png", "logo", "transparent", "new"]);
export function relevantResults(results, q) {
  const words = [...new Set(String(q).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 4 && !GENERIC.has(w)))];
  if (!words.length) return results.length > 0;
  const hit = results.slice(0, 12).filter((r) => { const t = `${r.title} ${r.page} ${r.url}`.toLowerCase(); return words.some((w) => t.includes(w)); }).length;
  return hit >= Math.min(3, Math.max(1, results.length));
}

// DuckDuckGo images: the page gives a token (vqd), the JSON endpoint gives the pictures — the same two requests its own page makes.
export async function ddgImages(q, { transparent = false, fetchImpl = globalThis.fetch } = {}) {
  const ua = { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9" };
  const page = await (await fetchImpl("https://duckduckgo.com/?" + new URLSearchParams({ q, iax: "images", ia: "images" }), { headers: ua, signal: AbortSignal.timeout(20000) })).text();
  const vqd = (/vqd=["']?([\d-]+)/.exec(page) || [])[1];
  if (!vqd) throw new Error("DuckDuckGo gave no token");
  const r = await fetchImpl("https://duckduckgo.com/i.js?" + new URLSearchParams({ l: "in-en", o: "json", q, vqd, f: transparent ? ",,,transparent,," : ",,,,,", p: "1" }), { headers: { ...ua, Referer: "https://duckduckgo.com/", Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`DuckDuckGo images → HTTP ${r.status}`);
  const out = [], seen = new Set();
  for (const x of (await r.json()).results || []) {
    if (!x.image || !x.url || seen.has(x.image)) continue;
    let host; try { host = new URL(x.url).host.replace(/^www\./, ""); } catch { continue; }
    seen.add(x.image); out.push({ url: x.image, thumb: x.thumbnail || null, page: x.url, host, title: String(x.title || "").trim() });
  }
  return out;
}

// Google's Programmable Search (the official image search; a free key and search-engine id give 100 searches a day). Set with
// setImageSearchConfig(() => ({ googleKey, googleCx })) — or GOOGLE_CSE_KEY / GOOGLE_CSE_CX in the environment.
/** @type {() => { googleKey?: string, googleCx?: string }} */
let searchConfig = () => ({ googleKey: process.env.GOOGLE_CSE_KEY || "", googleCx: process.env.GOOGLE_CSE_CX || "" });
export const setImageSearchConfig = (/** @type {() => { googleKey?: string, googleCx?: string }} */ fn) => { searchConfig = fn; };

/** @param {string} q @param {{ key: string, cx: string, transparent?: boolean, fetchImpl?: typeof fetch }} o */
export async function googleImages(q, { key, cx, transparent = false, fetchImpl = globalThis.fetch }) {
  const qs = new URLSearchParams({ key, cx, q, searchType: "image", num: "10", gl: "in", safe: "active", ...(transparent ? { imgColorType: "trans" } : {}) });
  const r = await fetchImpl("https://www.googleapis.com/customsearch/v1?" + qs, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google image search → ${String(j.error?.message || "HTTP " + r.status).slice(0, 120)}`);
  const out = [], seen = new Set();
  for (const x of j.items || []) {
    if (!x.link || seen.has(x.link)) continue;
    const page = x.image?.contextLink || x.link; let host; try { host = new URL(page).host.replace(/^www\./, ""); } catch { continue; }
    seen.add(x.link); out.push({ url: x.link, thumb: x.image?.thumbnailLink || null, page, host, title: String(x.title || "").trim() });
  }
  return out;
}

// mkt: the market whose results are wanted — Indian packs and Indian shops (en-IN), not the US / EU versions
export async function imageSearch(q, { transparent = false, fetchImpl = globalThis.fetch, count = 35, mkt = "en-IN" } = {}) {
  const g = searchConfig();
  if (g.googleKey && g.googleCx) { try { const r = await googleImages(q, { key: g.googleKey, cx: g.googleCx, transparent, fetchImpl }); if (r.length && relevantResults(r, q)) return r; } catch { /* the scraped pages below */ } }
  const qs = new URLSearchParams({ q, form: "IRFLTR", first: "1", count: String(count), mkt, cc: mkt.split("-")[1] || "IN" });
  if (transparent) qs.set("qft", "+filterui:photo-transparent");
  const r = await fetchImpl("https://www.bing.com/images/search?" + qs, { headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9" }, signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  if (!r.ok) throw new Error(`Image search → HTTP ${r.status}`);
  if (/captcha|unusual traffic/i.test(html.slice(0, 20000)) && !/ m="\{/.test(html)) throw new Error("Image search asked for a bot check — not bypassed");
  const found = parseBingImages(html);
  if (relevantResults(found, q)) return found;
  try { const d = await ddgImages(q, { transparent, fetchImpl }); if (d.length && relevantResults(d, q)) return d; } catch { /* nothing better */ }
  return [];   // unrelated pictures are worse than none: the ad is then made without a product picture, and says so
}

// The brand's own sites rank first (bata.com, maggi.in …), then the rest in search order.
export function brandHost(host, brand) {
  const b = String(brand).toLowerCase().replace(/[^a-z0-9]/g, "");
  const h = String(host || "").toLowerCase().replace(/^www\./, "").split(".");   // a search result can come without a host
  return b.length >= 3 && h.some((part) => part.replace(/[^a-z0-9]/g, "") === b || (part.length > 4 && part.replace(/[^a-z0-9]/g, "").startsWith(b)));
}

// Downloads one picture (JPEG / PNG / WebP only), at most 12 MB.
/** @param {string} url @param {string} file @param {{ fetchImpl?: any, fs: typeof import("node:fs") }} o */
// Free-licence stock photographs (Unsplash, Pexels) for a query: the image search with a site: filter (Bing ignores
// site:, DuckDuckGo keeps it). Only pictures hosted by the two sites are returned; `page` is the photo page (attribution).
export async function stockPhotos(q, { fetchImpl = globalThis.fetch } = {}) {
  const out = [];
  for (const site of ["unsplash.com", "pexels.com"]) {
    const r = await ddgImages(`site:${site} ${q}`, { fetchImpl }).catch(() => []);
    out.push(...r.filter((x) => x.host.endsWith(site) && /^https:\/\/images\.(unsplash|pexels)\.com\//.test(x.url) && !/\/(plus|premium)[-_]/.test(x.url)));
  }
  return out;
}

export async function downloadImage(url, file, { fetchImpl = globalThis.fetch, fs }) {
  const r = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "image/png,image/jpeg,image/webp;q=0.9,image/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
  const type = (r.headers.get("content-type") || "").split(";")[0];
  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/webp": ".webp" }[type];
  if (!r.ok || !ext) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1500 || buf.length > 12e6) return null;
  fs.writeFileSync(file + ext, buf);
  return file + ext;
}
