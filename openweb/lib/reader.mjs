// Article reader: a page URL → its HTML and the extracted article, with fallbacks that only run when needed.
//  1. the publisher's page, fetched once (robots.txt and the polite gap honoured), one retry after a network hiccup or a
//     5xx; never retried or worked around when the site refuses (403 / 429 / bot check), robots.txt disallows, or the
//     page is gone
//  2. the page's own metadata (JSON-LD, Next.js data) — see extract.mjs
//  3. Trafilatura (pipeline/scripts/article_text.py) for clean main text, when the metadata has no usable article text
//  4. Firecrawl (rendered page, basic proxy only), when a key is set and the plain HTML carries no article text at all —
//     a page built by JavaScript. Pages the publisher refused, paywalled pages and robots-refused pages never go there.
// Each URL is read once at a time (a second caller waits for the same read), and every read has a time limit.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractArticle } from "./extract.mjs";
import { FetchError } from "./fetcher.mjs";
import { sha256 } from "./text.mjs";

const RETRY = /^(NETWORK|HTTP_5\d\d)$/;
const urlKey = (u) => String(u || "").replace(/#.*$/, "").replace(/\/$/, "").toLowerCase();

/** @param {Promise<any>} p @param {number} ms @param {string} what */
export function withTimeout(p, ms, what) {
  let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new FetchError("TIMEOUT", `${what} took longer than ${Math.round(ms / 1000)} s`)), ms); })]).finally(() => clearTimeout(t));
}

// Firecrawl's rendered HTML of a page (v2 scrape API). Basic proxy only: Firecrawl must not be used to get past a
// publisher's bot protection. Returns null when Firecrawl can't render it.
export async function firecrawlHtml(url, { key, fetchImpl = globalThis.fetch, timeoutMs = 30000, endpoint = "https://api.firecrawl.dev/v2/scrape" }) {
  const r = await fetchImpl(endpoint, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs + 5000),
    body: JSON.stringify({ url, formats: ["rawHtml"], onlyMainContent: false, proxy: "basic", timeout: timeoutMs, maxAge: 6 * 3600e3, blockAds: true }) });
  const j = await r.json().catch(() => ({}));
  const status = j?.data?.metadata?.statusCode;
  if (!r.ok || !j?.success || !j.data?.rawHtml || (status && status >= 400)) return null;
  return { html: String(j.data.rawHtml), finalUrl: j.data.metadata?.url || j.data.metadata?.sourceURL || url };
}

/**
 * @param {{ fetcher: { get: (url: string, accept?: string) => Promise<{ text: string, finalUrl: string }> }, py?: ((args: string[]) => Promise<string>)|null,
 *   firecrawl?: { key: string }|null, fetchImpl?: any, timeoutMs?: number, tmpDir?: string, sleep?: (ms: number) => Promise<any> }} o
 */
export function makeReader({ fetcher, py = null, firecrawl = null, fetchImpl = globalThis.fetch, timeoutMs = 45000, tmpDir = path.join(os.tmpdir(), "mk-reader"), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const inflight = new Map();

  async function page(url) {
    try { return await fetcher.get(url); }
    catch (e) { if (!RETRY.test(e.code || "")) throw e; await sleep(1500); return fetcher.get(url); }
  }
  // Trafilatura's text for this HTML (null when Python / Trafilatura is not available or finds nothing)
  async function trafilatura(html, url) {
    if (!py) return null;
    fs.mkdirSync(tmpDir, { recursive: true });
    const f = path.join(tmpDir, sha256(url + html.length).slice(0, 16) + ".html");
    fs.writeFileSync(f, html);
    try { const out = await withTimeout(py(["article_text.py", f, url]), 20000, "Trafilatura"); return JSON.parse(String(out).trim().split(/\r?\n/).pop() || "{}"); }
    catch { return null; }
    finally { try { fs.unlinkSync(f); } catch { /* temp file */ } }
  }
  async function readOnce(url) {
    let html, finalUrl, alt = null;
    try { ({ text: html, finalUrl } = await page(url)); }
    catch (e) {
      // mid-day's RSS links "Health & Fitness" stories as …/health-&-fitness/…, which is a 404; the site's own address is
      // …/health-and-fitness/…. Tried once, and kept only when that page names itself by that address (canonical link).
      alt = e.code === "HTTP_404" && /-(&|&amp;|%26)-/i.test(url) ? url.replace(/-(&|&amp;|%26)-/gi, "-and-") : null;
      if (!alt) throw e;
      ({ text: html, finalUrl } = await page(alt).catch(() => { throw e; }));
    }
    const done = (/** @type {any} */ r) => { if (alt) r.article.extraction.notes.push(`the feed's link is a 404; read at the site's own address ${alt}`); return r; };
    let a = extractArticle(html, finalUrl);
    if (alt && urlKey(a.canonical).replace(/^https?:\/\/(www\.)?/, "") !== urlKey(alt).replace(/^https?:\/\/(www\.)?/, "")) throw new FetchError("HTTP_404", `${url} → HTTP 404 (and ${alt} is a different page)`);
    if (a.extraction.status !== "complete" || a.source === "html-paragraphs") {   // no complete text in the metadata: Trafilatura's clean text
      const clean = await trafilatura(html, finalUrl);
      if (clean?.ok) a = extractArticle(html, finalUrl, { clean });
    }
    if (firecrawl?.key && a.free !== false && (a.extraction.status === "none" || a.extraction.status === "headline_only")) {   // built by JavaScript: render it
      const r = await firecrawlHtml(finalUrl, { key: firecrawl.key, fetchImpl }).catch(() => null);
      if (r) {
        let b = extractArticle(r.html, finalUrl, { via: "firecrawl" });
        if (b.extraction.status !== "complete") { const clean = await trafilatura(r.html, finalUrl); if (clean?.ok) b = extractArticle(r.html, finalUrl, { clean, via: "firecrawl" }); }
        if (b.extraction.chars > a.extraction.chars) return done({ html: r.html, finalUrl, article: b });
      }
      a.extraction.notes.push("Firecrawl could not render more of the page");
    }
    return done({ html, finalUrl, article: a });
  }
  return {
    /** @param {string} url @returns {Promise<{ html: string, finalUrl: string, article: Record<string, any> }>} */
    read(url) {
      const k = urlKey(url);
      if (!inflight.has(k)) inflight.set(k, withTimeout(readOnce(url), timeoutMs, "Reading the article").finally(() => inflight.delete(k)));
      return inflight.get(k);
    },
  };
}
