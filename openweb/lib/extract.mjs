// Article HTML → structured fields. Prefers the publisher's own schema.org JSON-LD (NewsArticle / Article);
// falls back to <meta> tags and <p> text. Only the headline and article body are analysed later — never
// navigation, footers or related-story lists.
import { norm } from "./text.mjs";

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

export function extractArticle(html, url) {
  const ld = jsonLd(html).find((x) => [x["@type"]].flat().some((t) => ARTICLE_TYPES.test(String(t))) && (x.articleBody || x.headline));
  const paras = [...html.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)].map((m) => norm(stripTags(m[0]))).filter((t) => t.length >= 80);
  const ldBody = ld?.articleBody ? stripTags(ld.articleBody) : "";
  const body = norm(ldBody) || paras.join(" ");
  const ldParas = ldBody.split(/\n\s*\n|(?<=[.!?])\s{2,}/).map(norm).filter((t) => t.length >= 80);
  const headline = norm(decodeEntities(ld?.headline || meta(html, "og:title") || (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1]?.replace(/<[^>]+>/g, "") || ""));
  const published = ld?.datePublished || meta(html, "article:published_time") || null;
  const image = imageOf(ld?.image) || (meta(html, "og:image") ? { url: meta(html, "og:image"), width: +meta(html, "og:image:width") || null, height: +meta(html, "og:image:height") || null } : null);
  let pathSections = []; try { pathSections = new URL(url).pathname.toLowerCase().split("/").filter((s) => s && !/\d{3,}/.test(s) && s.length <= 30); } catch { /* not a valid URL: no path sections */ }
  return {
    url,
    canonical: (/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html) || [])[1] || url,
    source: ld ? "json-ld" : paras.length ? "html-paragraphs" : "none",
    lang: (/<html[^>]*\slang=["']([\w-]+)["']/i.exec(html) || [])[1] || null,
    headline,
    body,
    paragraphs: Math.max(paras.length, ldParas.length),
    published: published && !isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
    sections: [...new Set([...list(ld?.articleSection).map((s) => s.toLowerCase()), ...pathSections])],
    keywords: list(ld?.keywords || meta(html, "news_keywords") || meta(html, "keywords")).slice(0, 30),
    image,
    // subscription articles: schema.org isAccessibleForFree (false → behind a paywall; null → the page doesn't say)
    free: /"isAccessibleForFree"\s*:\s*"?false"?/i.test(html) ? false : /"isAccessibleForFree"\s*:\s*"?true"?/i.test(html) ? true : null,
  };
}
