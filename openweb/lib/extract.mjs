// Article HTML → structured fields. Prefers the publisher's own schema.org JSON-LD (NewsArticle / Article) — the
// object that belongs to this page, not a related story's; falls back to the page's Next.js data, then Trafilatura's
// clean text (when the reader supplies it), then <p> text. Only the headline and article body are analysed later —
// never navigation, footers, cookie banners or related-story lists. Nothing is filled in that the page doesn't say.
import { norm } from "./text.mjs";

export const EXTRACT_VERSION = "extract.v2";

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", rupee: "₹" };
export const decodeEntities = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : NAMED[e.toLowerCase()] ?? m);
const stripTags = (s) => decodeEntities(String(s || "").replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, " "));

const ARTICLE_TYPES = /^(NewsArticle|Article|BlogPosting|ReportageNewsArticle|AnalysisNewsArticle|OpinionNewsArticle|Recipe|TechArticle|LiveBlogPosting)$/;

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim().replace(/[\u0000-\u001f]+/g, " ")); } catch { continue; }
    for (const x of [j].flat()) for (const y of x?.["@graph"] || [x]) if (y && typeof y === "object") out.push(y);
  }
  return out;
}
const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"), m = re.exec(html);
  return m ? decodeEntities((/content=["']([^"']*)["']/i.exec(m[0]) || [])[1] || "").trim() : "";
};
const imageOf = (img) => {
  if (!img) return null;
  if (Array.isArray(img)) return imageOf(img[0]);
  if (typeof img === "string") return { url: img, width: null, height: null };
  return img.url ? { url: String(img.url), width: +img.width || null, height: +img.height || null } : null;
};
const list = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((x) => norm(x)).filter(Boolean);

const urlKey = (u) => String(u || "").replace(/[#?].*$/, "").replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
// letters and digits only — and entity names left behind as words by a garbled feed ("Indiarsquos" → "indias")
const letters = (s) => String(s || "").toLowerCase().replace(/rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip|nbsp/g, "").replace(/[^a-z0-9]+/g, "");

// The page's own article object: the one whose url / @id / mainEntityOfPage is this page, else the one whose headline is
// the page's og:title, else the first with a body. (Pages also carry related stories and lists as JSON-LD.)
function pickLd(objs, pageUrls, ogTitle) {
  const arts = objs.filter((x) => [x["@type"]].flat().some((t) => ARTICLE_TYPES.test(String(t))) && (x.articleBody || x.headline));
  const want = new Set(pageUrls.filter(Boolean).map(urlKey));
  const own = arts.find((x) => [x.url, x["@id"], x.mainEntityOfPage?.["@id"] ?? x.mainEntityOfPage].some((u) => typeof u === "string" && want.has(urlKey(u))));
  return own || (ogTitle && arts.find((x) => letters(x.headline) === letters(ogTitle))) || arts.find((x) => x.articleBody) || arts[0] || null;
}

// A JSON-LD body that lost its punctuation on the publisher's side ("…ahead of DiwaliInterestingly festive travel…",
// "Indiarsquos"): sentences run together, so quotes, word matches and paragraphs can't be checked against it.
export function garbled(text) {
  const t = String(text || ""); if (t.length < 400) return false;
  return (t.match(/[.!?।](\s|$)/g) || []).length < t.length / 600 || /[a-z](?:rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip)/i.test(t);
}

// Publisher sign-offs that end the article text; on some sites the related-story headlines run straight on after them in
// the JSON-LD body ("…YouTube channels..AR Rahman responds to …"). Cut there, but only in the last part of the text.
// (Asianet ends every story with a "Catch all / Explore the latest … News … Download the … App" promo paragraph.)
const SIGN_OFFS = [/For more updates,? join\/follow our [^.]{0,80}channels\.?/i, /(?:Catch all|Explore) the latest .{0,500}?Download the [\w ]{2,40} App from the/i,
  /Download the [\w ]{2,40} App from the [^.]{0,120}(\.|$)/i];
export function cutSignOff(text) {
  let t = String(text || "");
  for (const re of SIGN_OFFS) { const m = re.exec(t); if (m && m.index >= t.length * 0.6) t = t.slice(0, m.index); }
  return norm(t);
}

// Next.js sites (mid-day) keep the whole story in the page's __NEXT_DATA__ JSON while the page itself shows only the
// first paragraphs until "Read More". The longest HTML text there that starts like this article (checked against the
// page's own metadata) is the body; when nothing can be checked, nothing is taken.
function nextDataBody(html, probe) {
  const m = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html); if (!m) return "";
  const p = letters(probe).slice(0, 80); if (p.length < 40) return "";
  let j; try { j = JSON.parse(m[1]); } catch { return ""; }
  let best = "";
  const walk = (v, depth) => {
    if (!v || depth > 14) return;
    if (typeof v === "string") { if (v.length > best.length && /<p[\s>]/i.test(v)) { const t = norm(stripTags(v)); if (letters(t).includes(p)) best = t; } return; }
    if (typeof v === "object") for (const k of Object.keys(v)) walk(v[k], depth + 1);
  };
  walk(j, 0);
  return best;
}

// Trafilatura's main text (from the reader), minus lines that are links to other pages (related-story lists) and the
// headline repeated at the top
function cleanText(clean, html, headline) {
  if (!clean?.ok || !clean.text) return "";
  const links = new Set([...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => letters(stripTags(m[1]))).filter((t) => t.length >= 20));
  return norm(String(clean.text).split(/\n+/).map((l) => l.replace(/^\s*[-*•]\s+/, "").trim())
    .filter((l) => l && !links.has(letters(l)) && letters(l) !== letters(headline)).join("\n"));
}

/**
 * @param {string} html @param {string} url
 * @param {{ clean?: { ok: boolean, text?: string, title?: string|null } | null, via?: string }} [o]  clean = Trafilatura's output for this HTML
 */
export function extractArticle(html, url, { clean = null, via = "" } = {}) {
  const canonical = (/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html) || [])[1] || url;
  const ogTitle = meta(html, "og:title");
  const ld = pickLd(jsonLd(html), [url, canonical, meta(html, "og:url")], ogTitle);
  const paras = [...html.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)].map((m) => norm(stripTags(m[0]))).filter((t) => t.length >= 80);
  const ldRaw = ld?.articleBody ? stripTags(ld.articleBody) : "";
  const headline = norm(decodeEntities(ld?.headline || ogTitle || (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1]?.replace(/<[^>]+>/g, "") || clean?.title || ""));
  // the body, from the best source this page offers (see the file header); notes say what was wrong with the others
  const notes = [];
  const ldBad = garbled(ldRaw); if (ldBad) notes.push("the page's JSON-LD article text has lost its punctuation — not used");
  const fromLd = ldRaw && !ldBad ? cutSignOff(ldRaw) : "";
  const fromNext = fromLd ? "" : nextDataBody(html, ldRaw || meta(html, "og:description") || meta(html, "description") || paras[1] || paras[0] || "");
  const fromClean = fromLd || fromNext.length >= 400 ? "" : cutSignOff(cleanText(clean, html, headline));
  const fromParas = cutSignOff(paras.join(" "));
  const [body, source] = fromLd ? [fromLd, "json-ld"] : fromNext.length >= 400 ? [cutSignOff(fromNext), "next-data"] : fromClean.length >= 200 ? [fromClean, "trafilatura"]
    : fromParas ? [fromParas, "html-paragraphs"] : ["", "none"];
  const ldParas = ldRaw.split(/\n\s*\n|(?<=[.!?])\s{2,}/).map(norm).filter((t) => t.length >= 80);
  const published = ld?.datePublished || meta(html, "article:published_time") || null;
  const image = imageOf(ld?.image) || (meta(html, "og:image") ? { url: meta(html, "og:image"), width: +meta(html, "og:image:width") || null, height: +meta(html, "og:image:height") || null } : null);
  let pathSections = []; try { pathSections = new URL(url).pathname.toLowerCase().split("/").filter((s) => s && !/\d{3,}/.test(s) && s.length <= 30); } catch { /* not a valid URL: no path sections */ }
  // how much of the article could be read: complete, partial (a teaser, or less than the page's own metadata shows),
  // headline only, or nothing — the studio decides what each allows (it never fills in what is missing)
  const truncated = ldBad && letters(body).length < letters(ldRaw).length * 0.6;
  if (truncated) notes.push(`only ${body.length} of about ${ldRaw.length} characters of the article could be read`);
  const status = !headline && !body ? "none" : body.length < 200 ? "headline_only" : body.length < 800 || truncated ? "partial" : "complete";
  const freeLd = ld && "isAccessibleForFree" in ld ? !/^false$/i.test(String(ld.isAccessibleForFree)) : null;
  return {
    url,
    canonical,
    source,
    extraction: { version: EXTRACT_VERSION, status, method: (via ? via + "+" : "") + source, chars: body.length, notes },
    lang: (/<html[^>]*\slang=["']([\w-]+)["']/i.exec(html) || [])[1] || null,
    headline,
    body,
    paragraphs: Math.max(paras.length, ldParas.length),
    published: published && !isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
    sections: [...new Set([...list(ld?.articleSection).map((s) => s.toLowerCase()), ...pathSections])],
    keywords: list(ld?.keywords || meta(html, "news_keywords") || meta(html, "keywords")).slice(0, 30),
    image,
    // subscription articles: schema.org isAccessibleForFree (false → behind a paywall; null → the page doesn't say)
    free: freeLd ?? (/"isAccessibleForFree"\s*:\s*"?false"?/i.test(html) ? false : /"isAccessibleForFree"\s*:\s*"?true"?/i.test(html) ? true : null),
  };
}
