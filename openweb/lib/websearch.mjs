// Product pictures found online: Bing image search (the public results page, read like a browser would; nothing is
// bypassed — a bot-check page is reported as an error). Each result keeps the page it came from, so every picture
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

export async function imageSearch(q, { transparent = false, fetchImpl = globalThis.fetch, count = 35 } = {}) {
  const qs = new URLSearchParams({ q, form: "IRFLTR", first: "1", count: String(count) });
  if (transparent) qs.set("qft", "+filterui:photo-transparent");
  const r = await fetchImpl("https://www.bing.com/images/search?" + qs, { headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9" }, signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  if (!r.ok) throw new Error(`Image search → HTTP ${r.status}`);
  if (/captcha|unusual traffic/i.test(html.slice(0, 20000)) && !/ m="\{/.test(html)) throw new Error("Image search asked for a bot check — not bypassed");
  return parseBingImages(html);
}

// The brand's own sites rank first (bata.com, maggi.in …), then the rest in search order.
export function brandHost(host, brand) {
  const b = String(brand).toLowerCase().replace(/[^a-z0-9]/g, "");
  const h = host.toLowerCase().replace(/^www\./, "").split(".");
  return b.length >= 3 && h.some((part) => part.replace(/[^a-z0-9]/g, "") === b || (part.length > 4 && part.replace(/[^a-z0-9]/g, "").startsWith(b)));
}

// Downloads one picture (JPEG / PNG / WebP only), at most 12 MB.
/** @param {string} url @param {string} file @param {{ fetchImpl?: any, fs: typeof import("node:fs") }} o */
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
