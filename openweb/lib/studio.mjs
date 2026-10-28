// In-Image Studio: type a brand and a product → the product is found online, an in-image creative is built in the
// MediaKart strip style, a relevant article image on a media-plan publisher is chosen, and a phone-view mock video
// of the unit on that article is recorded. Mock previews only: nothing is sent to a publisher or an ad server.
// Every picture keeps the page it came from; every AI decision is kept with its reasons in result.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { imageSearch, brandHost, downloadImage } from "./websearch.mjs";
import { makeFetcher } from "./fetcher.mjs";
import { parseFeed, notAnArticle } from "./feeds.mjs";
import { analyseUrl } from "./pipeline.mjs";
import { renderMock, ASSET_URL } from "./mock.mjs";
import { stripHtml, fitStrip, STRIP_VERSION, STYLES, styleFontsUrl, styleFontFaces } from "./strip.mjs";
import { norm } from "./text.mjs";
import { findBrand, brandBrief, bannedReason, namesBrand } from "./brands.mjs";

// Why a run must not start (a product that may not be advertised, e.g. infant formula under India's IMS Act), or null
export function studioRefusal(brands, brand, product) {
  const k = brands ? findBrand(brands, brand, product) : null;
  const why = bannedReason(k, product, brand);
  return why ? `${k.name}: ${why}` : null;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STUDIO_PROMPTS = "inimage-prompts.v1";
const WIKI_UA = { "User-Agent": "ContextualAdStudio/1.0 (Mediakart contextual-ad demo tool)" };
const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "brand";

export function loadStudioConfig(dir = path.join(HERE, "..", "config")) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, "inimage-studio.v1.json"), "utf8"));
  if (!c.version || !Array.isArray(c.sections) || !c.sections.length) throw new Error("inimage-studio.v1.json: sections missing");
  for (const s of c.sections) if (!s.id || !s.domain || !s.feeds?.length || !s.formats?.["in-image"]) throw new Error(`inimage-studio.v1.json: section ${s.id || "?"} needs id, domain, feeds and an in-image source`);
  return c;
}

// ---------- logo candidates: Wikimedia Commons files named "<brand> … logo", then the web ----------
async function commonsLogos(brand, fetchImpl) {
  const q = new URLSearchParams({ action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "10", gsrsearch: `${brand} logo`, prop: "imageinfo", iiprop: "url|size|mime", iiurlwidth: "600" });
  try {
    const r = await fetchImpl("https://commons.wikimedia.org/w/api.php?" + q, { headers: WIKI_UA, signal: AbortSignal.timeout(10000) });
    const t = await r.text(); if (!r.ok || !t.startsWith("{")) return [];
    const b = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
    return Object.values(JSON.parse(t).query?.pages || {}).sort((x, y) => x.index - y.index)
      .filter((p) => /logo/i.test(p.title) && p.title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(b) && /image\/(png|svg|jpeg)/.test(p.imageinfo?.[0]?.mime || ""))
      .slice(0, 5).map((p) => ({ url: p.imageinfo[0].thumburl, thumb: p.imageinfo[0].thumburl, page: p.imageinfo[0].descriptionurl, host: "commons.wikimedia.org", title: p.title.replace(/^File:/, "") }));
  } catch { return []; }
}

// ---------- article candidates from the media-plan sections (feeds cached for a few minutes) ----------
// Feeds are small XML files meant for readers: a shorter gap between them than between article pages.
export const feedFetcher = (fetchImpl) => makeFetcher({ fetchImpl, gapMs: 600 });
const feedCache = new Map();
export async function sectionItems(studio, fetcher, { now = Date.now() } = {}) {
  const maxAge = studio.feeds.maxAgeDays * 864e5, ttl = studio.feeds.cacheMinutes * 60e3;
  const per = await Promise.all(studio.sections.map(async (sec) => {
    const hit = feedCache.get(sec.id); if (hit && now - hit.t < ttl) return hit.items;
    const items = [];
    for (const f of sec.feeds) {
      try { for (const it of parseFeed((await fetcher.get(f, "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5")).text)) {
        let host; try { host = new URL(it.url).host; } catch { continue; }
        if (host !== sec.domain || notAnArticle(it.url) || (sec.exclude && new RegExp(sec.exclude).test(it.url)) || (it.published && now - Date.parse(it.published) > maxAge)) continue;
        items.push({ url: it.url, title: norm(it.title || "").replace(/&#\d+;/g, (m) => String.fromCharCode(+m.slice(2, -1))), published: it.published, section: sec.id });
      } } catch { /* a section whose feed is down just adds nothing */ }
    }
    items.sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));   // newest first
    const out = items.slice(0, studio.feeds.perSection);
    feedCache.set(sec.id, { t: now, items: out });
    return out;
  }));
  const seen = new Set(), all = [];
  for (const x of per.flat()) if (!seen.has(x.url)) { seen.add(x.url); all.push(x); }
  return all;
}

// ---------- older articles on the product's own topic: the publisher's daily sitemaps, kept as a local index ----------
// A sitemap lists every article URL a publisher puts out; Indian Express URLs carry the story's words
// (…/food-wine/easy-noodle-recipes-for-monsoon-10812345/), so a product's topic words find matching stories from the
// last few weeks. Days already read are kept on disk; only today and yesterday are read again (at most every 30 min).
const day = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);   // IST date
export const slugTitle = (url) => decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "").replace(/-\d{5,}$/, "").replace(/-/g, " ");
export async function sitemapIndex(sm, fetcher, file, { now = Date.now(), budget = 12 } = {}) {
  let idx = { days: {}, checked: {} }; try { idx = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  const want = Array.from({ length: sm.days }, (_, i) => day(now - i * 864e5));
  const keep = (u) => sm.paths.some((pre) => u.startsWith(`https://${sm.domain}${pre}`)) && !/\/(live-updates?|liveblog|web-stories?|videos?|photos?)\//.test(u);
  let reads = 0;
  for (const d of want) {   // newest first; a slow first build is spread over several runs (budget per call)
    const fresh = d === want[0] || d === want[1];
    if (idx.days[d] && !(fresh && now - (idx.checked[d] || 0) > 30 * 60e3)) continue;
    if (reads++ >= budget) break;
    const [yyyy, mm, dd] = d.split("-");
    const url = d === want[0] ? sm.today : d === want[1] ? sm.yesterday : sm.daily.replace("{yyyy}", yyyy).replace("{mm}", mm).replace("{dd}", dd);
    try {
      const xml = (await fetcher.get(url, "application/xml,text/xml;q=0.9,*/*;q=0.5")).text;
      idx.days[d] = [...new Set([...xml.matchAll(/<loc>(?:<!\[CDATA\[)?([^<\]]+)/g)].map((m) => m[1].trim()).filter(keep))];
      idx.checked[d] = now;
    } catch { reads = budget; }   // the sitemap is down or refused: stop for now, try again on the next run
  }
  for (const d of Object.keys(idx.days)) if (!want.includes(d)) { delete idx.days[d]; delete idx.checked[d]; }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(idx));
  return Object.entries(idx.days).flatMap(([d, urls]) => urls.map((url) => ({ url, title: slugTitle(url), published: d, section: sm.id })));
}
// URLs whose words match the product's topic words, most matches first, then newest
export function matchSlugs(entries, words, limit = 80) {
  const phrases = words.map((w) => String(w).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim());
  const ws = [...new Set([...phrases, ...phrases.flatMap((w) => w.split(" "))].filter((w) => w.length >= 3))];   // a phrase counts double; its words count too
  return entries.map((e) => ({ e, hits: ws.reduce((n, w) => n + (new RegExp(`(^| )${w}( |$)`).test(e.title) ? (w.includes(" ") ? 2 : 1) : 0), 0) }))
    .filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits || String(b.e.published).localeCompare(String(a.e.published))).slice(0, limit).map((x) => x.e);
}

// Articles that already carry another brand's mock (every result.json in the studio folder that was not withdrawn):
// one article, one advertiser — the same road-trip story must not show IndiGo, Airbnb and Motorola.
const urlKey = (u) => String(u || "").replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
export function usedArticles(root, brand) {
  const used = new Map(), me = String(brand).trim().toLowerCase();
  let dirs = []; try { dirs = fs.readdirSync(root).filter((x) => !x.startsWith("_")); } catch { return used; }
  for (const b of dirs) {
    let runs = []; try { runs = fs.readdirSync(path.join(root, b)); } catch { continue; }
    for (const t of runs) {
      let r; try { r = JSON.parse(fs.readFileSync(path.join(root, b, t, "result.json"), "utf8")); } catch { continue; }
      const url = r?.placement?.article?.url;
      if (!url || r.error || String(r.brand).trim().toLowerCase() === me) continue;
      used.set(urlKey(url), `${r.brand} · ${typeof r.product === "string" ? r.product : r.product?.name || ""}`);
    }
  }
  return used;
}

// Which rival names (or the brand's own) a headline or URL title mentions — whole words, case-insensitive
export function rivalMatcher(names) {
  const list = [...new Set(names.flatMap((n) => [String(n).trim(), String(n).trim().replace(/\s+/g, "")]).filter((n) => n.length >= 2))];   // "One Plus" also as "OnePlus"
  const res = list.map((n) => [n, new RegExp(`(^|[^a-z0-9])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+")}($|[^a-z0-9])`, "i")]);
  return (text) => { const t = String(text || "").toLowerCase(), hit = res.filter(([, re]) => re.test(t)).map(([n]) => n); return hit.length ? hit : null; };
}

const VERIFY_SCHEMA = { type: "object", properties: {
  ok: { type: "boolean" }, problem: { type: "string", description: "what is wrong with the product PNG, empty if ok" },
  logo_ok: { type: "boolean" }, logo_problem: { type: "string" },
}, required: ["ok", "problem"] };

// A design's display font, fetched once from Google Fonts into a local cache and then served with the ad from local
// files (publisher pages may block outside fonts). Returns { css, files } for the mock renderer, or null.
export async function styleFonts(style, dir, fetchImpl = globalThis.fetch) {
  const url = styleFontsUrl(style); if (!url) return null;
  const cssFile = path.join(dir, style + ".css"); let css;
  if (fs.existsSync(cssFile)) css = fs.readFileSync(cssFile, "utf8");
  else {
    const r = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    css = await r.text(); fs.mkdirSync(dir, { recursive: true });
    let k = 0;
    for (const m of [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)]) {
      const name = `gf-${style}-${k++}.woff2`, f = await fetchImpl(m[1], { signal: AbortSignal.timeout(10000) });
      if (!f.ok) return null;
      fs.writeFileSync(path.join(dir, name), Buffer.from(await f.arrayBuffer())); css = css.replace(m[1], name);
    }
    fs.writeFileSync(cssFile, css);
  }
  const files = {};
  css = css.replace(/url\((gf-[\w-]+\.woff2)\)/g, (_, name) => { files[name] = path.join(dir, name); return `url(${ASSET_URL}${name})`; });
  return { css, files };
}

// The first topic word (or phrase) found in a headline / URL, by word stem ("walking" finds "walk", "recipes" finds
// "recipe"); null when none is there
export function topicHit(text, topics) {
  const toks = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  const stem = (w) => w.length > 5 ? w.slice(0, Math.max(4, w.length - 3)) : w;
  const has = (w) => toks.some((t) => t === w || (w.length >= 4 && (t.startsWith(stem(w)) || w.startsWith(stem(t)) && t.length >= 4)));
  for (const raw of topics) {
    const ws = String(raw || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length >= 3 && !["and", "the", "for", "with"].includes(w));
    if (ws.length && ws.every(has)) return raw;
  }
  return null;
}

const TOPIC_SCHEMA = { type: "object", properties: { words: { type: "array", items: { type: "string" } }, competitors: { type: "array", items: { type: "string" } } }, required: ["words"] };

// ---------- AI prompts (versioned: STUDIO_PROMPTS) ----------
const PICK_SCHEMA = { type: "object", properties: {
  packshot: { type: "integer", description: "number of the best product picture, 0 if none is acceptable" },
  packshot_ranked: { type: "array", items: { type: "integer" }, description: "every acceptable product picture, best first (up to 4)" },
  packshot_why: { type: "string", description: "what the chosen picture shows (brand, exact variant, pack design, market) and why the others were rejected" },
  product_name: { type: "string" },
  is_service: { type: "boolean", description: "true for a service / app / place (travel, stays, delivery, banking) rather than a physical product" },
  logo: { type: "integer", description: "number of the logo candidate that is this brand's real logo, 0 if none" },
  logo_why: { type: "string" },
  brand_colour: { type: "string", description: "the brand's main colour as #rrggbb" },
  accent_colour: { type: "string", description: "a second brand colour as #rrggbb that contrasts with brand_colour and with the product's pack" },
  style: { type: "string", enum: STYLES, description: "the ad design that suits this brand and product" },
  motif: { type: "string", enum: ["none", "bubbles", "steam", "sparkle", "speed", "flight", "pin"] },
}, required: ["style", "motif", "accent_colour", "packshot", "packshot_ranked", "packshot_why", "product_name", "is_service", "logo", "logo_why", "brand_colour"] };

const PLAN_SCHEMA = (ctas) => ({ type: "object", properties: {
  category: { type: "string" },
  audience: { type: "string" },
  contexts: { type: "array", items: { type: "string" } },
  avoid: { type: "array", items: { type: "string" } },
  competitors: { type: "array", items: { type: "string" }, description: "rival brands AND their product line names (e.g. Apple, iPhone, Samsung, Galaxy, Google, Pixel)" },
  headline: { type: "string" }, subline: { type: "string" }, cta: { type: "string", enum: ctas },
  shortlist: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, why: { type: "string" } }, required: ["n", "why"] } },
}, required: ["category", "audience", "contexts", "avoid", "competitors", "headline", "subline", "cta", "shortlist"] });

const FINAL_SCHEMA = { type: "object", properties: {
  candidates: { type: "array", items: { type: "object", properties: {
    k: { type: "integer" }, context_fit: { type: "integer", description: "0-10: 9-10 the article is about this product's category or its main use; 6-8 closely related; 0-5 only a loose link" },
    image_fit: { type: "integer", description: "0-10: the picture's scene suits this product" },
    safe: { type: "boolean" }, safe_why: { type: "string" },
    strip_ok: { type: "boolean", description: "the bottom 46% of the picture can be covered without hiding the main subject's face or key text" },
    why: { type: "string" },
  }, required: ["k", "context_fit", "image_fit", "safe", "safe_why", "strip_ok", "why"] } },
}, required: ["candidates"] };

// Bing's own copy of a search result at a larger size (used when the picture's site refuses the download)
const bingLarge = (thumb, size) => /^https:\/\/[\w.]*bing\.(net|com)\/th/.test(thumb || "") ? thumb.replace(/&(w|h|c)=\d+/g, "") + `&w=${size}&h=${size}&c=7` : null;
// what the user typed, replaced by the product's real name found online (the brand prefix left off): copy must name the real product
const reEsc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const withRealName = (text, typed, found, brand) => !found || !typed || found.toLowerCase() === typed.toLowerCase() ? text
  : String(text).replace(new RegExp(reEsc(typed), "ig"), found.replace(new RegExp(`^${reEsc(brand)}\\s+`, "i"), ""));
// copy kept to about n words without cutting a phrase in half: up to two extra words are allowed (the strip fits text
// by size); a longer line is shortened and never left ending on "for", "your", "the" …
export const words = (s, n) => {
  const t = String(s || "").trim().split(/\s+/).filter(Boolean);
  if (t.length <= n + 2) return t.join(" ");
  const cut = t.slice(0, n);
  while (cut.length > 2 && /^(for|every|the|a|an|and|or|with|your|to|of|in|on|at|by|from|our|its|is|are)$/i.test(cut.at(-1).replace(/[^a-z]/gi, ""))) cut.pop();
  return cut.join(" ");
};

/**
 * @param {{ brand: string, product: string, offer?: string, productImage?: string, style?: string, brands?: any, clientAd?: { file: string, type: "image"|"video", name?: string, seconds?: number }|null, workDir: string, indexDir?: string, studio: any, cfg: any, store: any,
 *   ask: Function, fetchImpl?: any, py: (args: string[]) => Promise<string>, ffmpeg: (args: string[]) => Promise<any>, chromium?: any,
 *   say?: (pct: number, stage: string, msg?: string) => void }} o
 */
export async function makeInImage(o) {
  const { brand, product, studio, cfg, store, ask, py, ffmpeg, workDir } = o;
  const fetchImpl = o.fetchImpl || globalThis.fetch, say = o.say || (() => {});
  const offer = String(o.offer || "").trim();
  const cand = path.join(workDir, "candidates"); fs.mkdirSync(cand, { recursive: true });
  const fetcher = makeFetcher({ fetchImpl, gapMs: 1000 }), feeds = feedFetcher(fetchImpl);   // a handful of article pages, a second apart per site
  const t0 = Date.now(), timing = {}; const lap = (k) => { timing[k] = +((Date.now() - t0) / 1000).toFixed(1); };
  // every AI step must leave time for the rest (the recording needs ~30 s): when Gemini is overloaded the run stops
  // with a clear message inside the 2-minute budget instead of waiting on busy models
  const timed = (p, reserveMs) => { let t; const left = studio.budgetSeconds * 1000 - (Date.now() - t0) - reserveMs;
    return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error("The AI (Gemini) is overloaded right now and did not answer in time. Try again in a minute.")), Math.max(8000, left)); })]).finally(() => clearTimeout(t)); };
  /** @type {Record<string, any>} */
  const result = { version: studio.version, prompts: STUDIO_PROMPTS, strip: STRIP_VERSION, brand, product, offer: offer || null, mock: true,
    label: "MOCK — not a live placement. Nothing was served.", createdAt: new Date().toISOString() };

  // what MediaKart knows about this brand (brands.v1.json): official sites, colours, design, rivals, sister brands
  const known = o.brands ? findBrand(o.brands, brand, product) : null, brief = brandBrief(known);
  const refusal = studioRefusal(o.brands, brand, product);
  if (refusal) throw new Error(refusal);
  // "the brand's own news": its names, sub-brands and sister brands; an everyday-word name (Yatra, Galaxy, boAt …)
  // counts only next to one of its product words (so "Char Dham Yatra" stories stay available to Yatra)
  const ownNews = (t) => known ? namesBrand(known, t) : !!rivalMatcher([brand])(t);
  if (known) result.brandProfile = { id: known.id, name: known.name, sub: known.sub, category: known.category };
  const official = (h) => brandHost(h, brand) || (known?.domains || []).some((d) => { const x = d.replace(/^www\./, ""); return h === x || h.endsWith("." + x); });
  const client = o.clientAd || null;   // the client's own creative (image or video file): placed as it is, nothing is generated
  if (client) result.creative = { source: "client", file: path.basename(client.file), type: client.type, name: client.name || null };
  try {
    // 1) product pictures, logo candidates and the latest articles — all at once
    say(4, "search", `Searching online for ${brand} ${product}…`);
    const topicP = ask("You help find articles for contextual ads.",
      `Brand: ${brand}. Product: ${product}.\n${brief ? brief + "\n" : ""}Give 15-25 lowercase single words (a few two-word phrases at most) that would appear in the web address of a news or lifestyle article that is a natural place for this ad — the product type, how and where it is used, occasions, activities, dishes, places (e.g. for running shoes: running, marathon, jogging, walking, workout, fitness, steps, cardio, sneakers; for instant noodles: noodles, recipe, snack, ramen, hostel, monsoon, chai, breakfast). Never the brand name or competitor names.\nAlso competitors: 8-20 rival brands of ${brand} for this product and their product line names (e.g. for a phone: Apple, iPhone, Samsung, Galaxy, Google, Pixel, OnePlus, Xiaomi, Redmi, Vivo, Oppo, Realme).`,
      TOPIC_SCHEMA, [], "medium").catch(() => ({ words: [], competitors: [] }));
    const [web, webClear, webIn, commons, webLogos, feedItems, older] = await Promise.all([
      client ? [] : imageSearch(`${brand} ${product}`, { fetchImpl }).catch(() => []),
      client ? [] : imageSearch(`${brand} ${product}`, { fetchImpl, transparent: true }).catch(() => []),
      client ? [] : imageSearch(`${brand} ${product} India`, { fetchImpl }).catch(() => []),
      client ? [] : commonsLogos(brand, fetchImpl),
      client ? [] : imageSearch(`${brand} logo png`, { fetchImpl }).catch(() => []),   // "png" steers the search to logo files (plain "Bata logo" finds Hindi "beta" photos)
      sectionItems(studio, feeds),
      Promise.all((studio.sitemaps || []).map((sm) => sitemapIndex(sm, feeds, path.join(o.indexDir || path.join(workDir, "..", ".."), "_index", sm.id + ".json")).catch(() => []))).then((x) => x.flat()),
    ]);
    const topic = await topicP;
    const seenUrl = new Set(feedItems.map((x) => x.url));
    const taken = usedArticles(o.indexDir || path.join(workDir, "..", ".."), brand);
    const topicWords = [...new Set([...(topic.words || []), ...(known?.topics || [])])];
    const all = [...feedItems, ...matchSlugs(older.filter((x) => !seenUrl.has(x.url)), topicWords)];
    // speed and focus: rival headlines out before any AI reads the list, topic matches first, at most studio.listMax lines
    const early0 = rivalMatcher([...(topic.competitors || []), ...(known?.competitors || [])]), early = (t) => early0(t) || (ownNews(t) ? ["the brand itself"] : null), hits = new Set(matchSlugs(all, topicWords, 1e9).map((x) => x.url));
    const items = all.filter((x) => !taken.has(urlKey(x.url)) && !early(x.title)).sort((a, b) => Number(hits.has(b.url)) - Number(hits.has(a.url))).slice(0, studio.listMax);
    result.articlesTakenByOtherBrands = all.filter((x) => taken.has(urlKey(x.url))).map((x) => ({ url: x.url, title: x.title, usedBy: taken.get(urlKey(x.url)) }));
    result.topicWords = topicWords;
    lap("search");
    // the product as sold in India: the brand's own sites first, then Indian shops, then the rest; shops abroad never
    // (a US 20 fl oz Sprite bottle or a German page is not the product Indian readers buy)
    const shop = (list, h) => list.some((d) => h === d || h.endsWith("." + d));
    const where = (h) => shop(studio.product.foreignShops, h) ? -1 : official(h) ? 3 : shop(studio.product.indianShops, h) || /\.in$/.test(h) ? 2 : 0;
    const seen = new Set(), products = [];
    const ranked = [...web, ...webIn, ...webClear].map((x, i) => ({ x, i, w: where(x.host) })).filter((r) => r.w >= 0).sort((a, b) => b.w - a.w || a.i - b.i).map((r) => r.x);
    for (const x of ranked) if (!seen.has(x.url) && x.thumb) { seen.add(x.url); products.push(x); }
    result.productSearch = { found: web.length + webIn.length + webClear.length, kept: products.length, foreignShopsLeftOut: [...web, ...webIn, ...webClear].filter((x) => where(x.host) < 0).length };
    // the official logo file found in the brand research comes first; the web results stay as fallbacks (the AI pick and
    // the PNG check still apply to it)
    const researched = known?.logo?.png ? [{ url: known.logo.png, thumb: known.logo.png, page: known.logo.file || known.logo.png, host: "upload.wikimedia.org", title: `${known.name} official logo (MediaKart brand knowledge)` }] : [];
    const logos = [...researched, ...webLogos.filter((x) => x.thumb).slice(0, 5), ...commons.slice(0, 3)].slice(0, 8);
    if (!client && !products.length) throw new Error(`No pictures of “${brand} ${product}” were found online. Check the spelling, or add a word (e.g. the product type).`);
    if (!all.length) throw new Error("None of the media-plan publisher feeds answered just now. Try again in a minute.");
    say(12, "search", `${client ? "Client's ad: " + (client.name || "uploaded file") + " · " : `${products.length} product picture(s), ${logos.length} logo candidate(s), `}${items.length} recent articles from ${new Set(items.map((i) => i.section)).size} sections (${items.filter((x) => hits.has(x.url)).length} of them matched by topic: ${(topic.words || []).slice(0, 6).join(", ")}…).`);

    // small copies for the AI (JPEG / PNG only: a WebP — Wikimedia serves logos that way — is converted, not dropped)
    const thumbs = async (list, pre, n = 8) => (await Promise.all(list.slice(0, n).map(async (x, i) => {
      let f = await downloadImage(x.thumb, path.join(cand, `${pre}${i + 1}`), { fetchImpl, fs }).catch(() => null);
      if (f && f.endsWith(".webp")) { const png = f.replace(/\.webp$/, ".png"); f = await ffmpeg(["-loglevel", "error", "-y", "-i", f, png]).then(() => png, () => null); }
      return f && /\.(jpg|png)$/.test(f) ? { ...x, file: f, n: i + 1 } : null; }))).filter(Boolean);
    let [pThumbs, lThumbs] = client ? [[], []] : await Promise.all([thumbs(products, "p", 10), thumbs(logos, "l")]);
    // the image host sometimes refuses a burst of parallel requests: one calmer retry, a few at a time
    const calm = async (list, pre, n) => { const out = []; for (let i = 0; i < Math.min(n, list.length); i += 3) out.push(...await thumbs(list.slice(i, i + 3).map((x, j) => ({ ...x, _i: i + j })), pre + "r" + i + "_", 3)); return out.map((x, k) => ({ ...x, n: k + 1 })); };
    if (!client && !pThumbs.length && products.length) pThumbs = await calm(products, "p", 10);
    if (!client && !lThumbs.length && logos.length) lThumbs = await calm(logos, "l", 8);
    if (!client && !pThumbs.length) throw new Error("The product pictures found online could not be downloaded just now (the image host refused). Try again in a minute.");

    // 2) AI: the packshot + logo (vision) and the plan — copy, targeting, article shortlist (text) — in parallel
    say(16, "understand", client ? "Planning where the ad fits best…" : "Choosing the product photo, logo and style, and writing the copy…");
    const list = items.map((x, i) => `${i + 1}. [${x.section}] ${x.title}`).join("\n");
    const pickP = client ? Promise.resolve({ packshot: 0, packshot_ranked: [], packshot_why: "client's own ad", product_name: product, is_service: false, logo: 0, logo_why: "", brand_colour: "", accent_colour: "", style: "bold", motif: "none" }) : ask(
      "You prepare assets for a display ad. You only choose among the pictures shown; you never describe a picture you were not shown.",
      `Brand: ${brand}\nProduct: ${product}\n${brief ? brief + "\n" : ""}\nP pictures are product photos found online, with the page they are on. L pictures are logo candidates.\n` +
      `1. packshot: the number of the P picture that shows EXACTLY this product as sold in India today. Check, on the pack or item itself: the brand; the exact variant asked for (e.g. "Zero Sugar" vs regular, "Masala" vs another flavour, the model name or number, silver vs gold, size); the current design and logo (not an old pack); Indian packaging (not a US or European pack — fl oz labels, foreign-language text or foreign prices mean a foreign pack). Reject a picture that shows a different variant, a related product, an old design, a foreign pack, several different products, a person or model wearing or holding it, a promotional banner or poster with headline text, a collage or comparison chart, a big text/price overlay, a watermark, or the product cropped or blurred. Prefer the brand's own site and Indian shops, and a plain or transparent background. For a service (stays, flights, delivery, apps) pick the photo that best shows the experience. If no picture is exactly right, return 0 — never a near miss. packshot_ranked: every picture that passes all these checks, best first.\n` +
      `2. product_name: the product's name as written on its page (short).\n3. is_service.\n4. logo: the number of the L picture that is ${brand}'s real current logo on its own — the company that sells ${product}, not another organisation with a similar name. Never a picture with several logos (a logo history / evolution chart, a collage, a sheet of brands), a photo of a shop sign, or a logo inside a larger photo. If several are right, the newest version. 0 if none.\n5. brand_colour: ${brand}'s main brand colour as #rrggbb (as used in its ads and logo). accent_colour: a second colour from ${brand}'s identity that contrasts with brand_colour and with the chosen product's own colours (the product will stand on it).\n6. style — the ad design that suits ${brand} and this product: bold (FMCG, everyday goods, sales, snacks), luxe (jewellery, beauty, premium fashion, watches), sport (shoes, sportswear, fitness gear), fresh (drinks, food, groceries), tech (phones, electronics, gadgets, apps), journey (travel, stays, airlines, delivery and other services). motif: bubbles (fizzy or cold drinks), steam (hot food), sparkle (jewellery, beauty), speed (sport), flight (airlines, travel), pin (stays, places, delivery), none.`,
      PICK_SCHEMA, [...pThumbs.map((x) => ({ label: `P${x.n} — "${x.title}" on ${x.host}`, file: x.file })), ...lThumbs.map((x) => ({ label: `L${x.n} — "${x.title}" (${x.host})`, file: x.file }))], "medium");
    const planP = ask(
      "You plan contextual in-image ads for an Indian digital publisher network. You write short, honest ad copy and pick articles only from the list given.",
      `Brand: ${brand}\nProduct: ${product}\n${brief ? brief + "\n" : ""}Product pages found: ${[...new Set(products.slice(0, 6).map((x) => x.title))].join(" | ")}\n${offer ? `Offer typed by the user (may be used word for word): ${offer}\n` : ""}\n` +
      `1. category, audience, contexts (topics and moments where a reader naturally thinks of this product), avoid (topics this ad must never appear next to), competitors (brands that compete with ${brand} on this product, and their product line names — e.g. for a phone: Apple, iPhone, Samsung, Galaxy, Google, Pixel, OnePlus, Xiaomi, Redmi, Vivo, Oppo, Realme; 8-20 names).\n` +
      `2. Ad copy for a strip over an article photo: headline at most ${studio.copy.maxHeadlineWords} words; subline at most ${studio.copy.maxSublineWords} words, naming the product; cta from the list. ${studio.copy.noClaims} No superlatives like "best" or "No.1". English.\n` +
      `3. shortlist: up to ${studio.shortlist} article numbers from the list below whose topic is a DIRECT fit for this product, best first, each with why. A direct fit is an article about this product's category or about the main thing people buy it for: for a phone — phones, phone features, apps, mobile photography tips, gadgets; for running shoes — running, walking, workouts; for noodles — quick meals, snacks, recipes; for flights or stays — travel and destinations. A loose link ("people take photos on trips", "everyone uses a phone") is NOT a fit: leave such articles out, and return fewer (even none) rather than weak ones. Never: articles about ${brand} itself or any competitor — a review, launch or price story about another company's product of the same kind (another phone, shoe, noodle brand…) is competitor content, even if the product type matches; prefer stories about how people use this kind of product (tips, how-tos, guides, shopping guides without rival brands); death, crime, accidents, disasters, war, illness scares, politics, controversy or negative stories about this kind of product; hard news. The topic must fit the product first. Among fitting stories, prefer ones that do not centre on a named celebrity or politician (an ad over a recognisable face reads as an endorsement, so such pictures are rejected later). Prefer service and lifestyle stories (how-tos, guides, recipes, trips, trends) published recently.\n\nARTICLES:\n${list}`,
      PLAN_SCHEMA(studio.copy.ctas), [], "medium");
    const [pick, plan] = await timed(Promise.all([pickP, planP]), 65000);
    lap("ai_assets_plan");
    result.ai = { pick, plan };

    // 3) product picture → cut-out (or scene photo); logo; brand colour
    const assets = path.join(workDir, "assets"); fs.mkdirSync(assets, { recursive: true });
    let logoFile = null, productMode = /** @type {"alpha"|"plain-bg"|"photo"|"scene"} */ ("photo"), copy = { headline: "", subline: "", cta: "" };
    const style = STYLES.includes(o.style) ? o.style : STYLES.includes(known?.style) ? known.style : STYLES.includes(pick.style) ? pick.style : "bold";
    const motif = known?.motif || pick.motif || "none";
    if (!client) {
    say(30, "assets", "Preparing the product cut-out and the logo…");
    const userPic = String(o.productImage || "").trim();
    if (!pick.packshot && !userPic) throw new Error(`None of the pictures found online is exactly ${brand} ${product} as sold in India (${pick.packshot_why}). Try the exact product name, or paste a link to the product photo.`);
    // pictures to try, best first: the user's own photo link, else only pictures the AI accepted
    let candidates = [...new Set([pick.packshot, ...(pick.packshot_ranked || [])])].map((n) => pThumbs.find((x) => x.n === n)).filter(Boolean).slice(0, 4);
    if (userPic) {
      let host = ""; try { host = new URL(userPic).host.replace(/^www\./, ""); } catch { throw new Error("The product photo link is not a web address (it should start with https://)."); }
      candidates = [{ url: userPic, page: userPic, host, title: "photo link given by the user", n: -1, user: true }];
    }
    // full-size files fetched together; a shop that refuses → Bing's enlarged copy of the same picture (source page kept)
    const fetched = await Promise.all(candidates.map(async (x, i) => {
      let f = await downloadImage(x.url, path.join(assets, `product_src${i}`), { fetchImpl, fs }).catch(() => null), via = x.user ? "the link you gave" : "the picture's own site";
      if (!f && !x.user && bingLarge(x.thumb, 900)) { f = await downloadImage(bingLarge(x.thumb, 900), path.join(assets, `product_src${i}b`), { fetchImpl, fs }).catch(() => null); via = "Bing's copy (the site refused the download)"; }
      return f && { x, f, via };
    }));
    if (!fetched.some(Boolean)) throw new Error(userPic ? "The product photo link could not be downloaded as a JPEG, PNG or WebP picture." : "The chosen product pictures could not be downloaded from their sites.");

    // the logo file (checked together with the first product PNG)
    let logoInfo = null;
    const lx = lThumbs.find((x) => x.n === pick.logo);
    if (lx) {
      let f = await downloadImage(lx.url, path.join(assets, "logo"), { fetchImpl, fs }).catch(() => null), via = "the logo's own site";
      if (!f && bingLarge(lx.thumb, 600)) { f = await downloadImage(bingLarge(lx.thumb, 600), path.join(assets, "logo"), { fetchImpl, fs }).catch(() => null); via = "Bing's copy (the site refused the download)"; }
      if (f) { logoFile = f; logoInfo = { url: lx.url, page: lx.page, site: lx.host, title: lx.title, chosenBecause: pick.logo_why, downloadedFrom: via };
        await py(["trim_logo.py", f]).catch(() => {});
        // background keyed out (also inside letters), so the logo sits directly on the ad — no white patch behind it
        const lg = await py(["cutout.py", "logo", f, path.join(assets, "logo_clean.png")]).then((t) => JSON.parse(t.trim().split(/\r?\n/).pop())).catch(() => null);
        if (lg) { logoFile = path.join(assets, "logo_clean.png"); Object.assign(logoInfo, { kind: lg.kind, ink: lg.ink, light: lg.light, keyed: lg.keyed }); } }
    }

    // every finished PNG is checked by AI before it goes into the ad: the exact product, whole and undamaged, nothing
    // else in it (no banner text, model, other products, leftover background); the logo complete and legible.
    // A failed product PNG → the original photo of the same picture (when the cut-out was the problem) → the next picture.
    const checkDir = path.join(workDir, "checks"); fs.mkdirSync(checkDir, { recursive: true });
    const checks = [];
    let cut = null, prodSrc = null, via = "", logoChecked = !logoFile;
    for (const [i, got] of fetched.entries()) {
      if (!got) continue;
      for (const mode of ["auto", "photo"]) {
        if (mode === "photo" && checks.at(-1)?.method === "photo") break;   // the first try was already the original photo
        const out = path.join(assets, "product.png");
        const c = JSON.parse((await py(["cutout.py", "product", got.f, out, ...(mode === "photo" ? ["--photo"] : [])])).trim().split("\n").pop());
        const pv = path.join(checkDir, `product_${i}_${mode}.jpg`); await py(["cutout.py", "preview", out, pv]);
        const imgs = [{ label: "PRODUCT PNG to check (shown on a grey checkerboard: checkerboard = transparent)", file: pv }];
        if (got.x.file) imgs.push({ label: `Reference: the search thumbnail it came from ("${got.x.title}" on ${got.x.host})`, file: got.x.file });
        let lpv = null; if (!logoChecked) { lpv = path.join(checkDir, "logo.jpg"); await py(["cutout.py", "preview", logoFile, lpv]); imgs.push({ label: "LOGO PNG to check", file: lpv }); }
        const v = await timed(ask("You check the finished pictures of a display ad before it is published. Judge only what you see.",
          `Ad for ${brand} — ${pick.product_name || product} (asked for: "${product}"), as sold in India.\n` +
          `PRODUCT PNG: ok only if it shows exactly this product (right brand, the variant asked for, current pack) — complete, not cut off or damaged, and nothing else: no people or models, no banner or headline text, no other products, no price stickers, no leftover background blocks${c.method === "photo" ? " (it is the original photo: a plain background is fine)" : ""}.` +
          (lpv ? `\nLOGO PNG: logo_ok only if it is ${brand}'s own logo, complete and legible, and nothing else (no other logos, no photo around it).` : ""),
          VERIFY_SCHEMA, imgs, "medium"), 50000).catch((e) => { if (/overloaded/.test(e.message)) throw e; return { ok: false, problem: "the check could not run: " + e.message, logo_ok: false }; });
        checks.push({ picture: got.x.url, method: c.method, ok: !!v.ok, problem: v.problem || "", preview: path.relative(workDir, pv).replace(/\\/g, "/") });
        if (lpv) { logoChecked = true; if (!v.logo_ok) { result.logoRejected = { ...logoInfo, why: v.logo_problem || "the logo check failed" }; logoFile = null; logoInfo = null; } }
        if (v.ok) { cut = c; prodSrc = got.x; via = got.via; break; }
        if (c.method === "photo" || pick.is_service) break;   // the photo itself is wrong: next picture
      }
      if (cut) break;
    }
    result.pngChecks = checks;
    if (!cut) throw new Error(`No product picture passed the final check (${checks.map((c) => c.problem).filter(Boolean).slice(0, 3).join("; ")}). Paste a link to the exact product photo to use it instead.`);
    productMode = pick.is_service && cut.method === "photo" ? "scene" : cut.method;
    result.productInfo = { name: pick.product_name, picture: { url: prodSrc.url, page: prodSrc.page, site: prodSrc.host, title: prodSrc.title, official: official(prodSrc.host), chosenBecause: prodSrc.user ? "given by the user" : pick.packshot_why, aiChoice: prodSrc.n === pick.packshot, downloadedFrom: via }, cutout: cut.method, layout: productMode, checked: true };
    let colour = known?.colours.primary || (/^#[0-9a-f]{6}$/i.test(pick.brand_colour || "") ? pick.brand_colour : null);
    if (!colour && logoFile) colour = JSON.parse((await py(["cutout.py", "colour", logoFile])).trim()).hex;
    result.brandLook = { logo: logoInfo || { note: result.logoRejected ? "The logo found online failed the check — the brand name is shown as text." : "No logo was confirmed online — the brand name is shown as text." }, colour: colour || "#1d2b53", accent: known?.colours.accent || (/^#[0-9a-f]{6}$/i.test(pick.accent_colour || "") ? pick.accent_colour : null), colourFrom: known?.colours.primary ? "MediaKart brand knowledge" : pick.brand_colour ? "AI (brand colour)" : logoFile ? "logo pixels" : "default" };
    // the product's real name (as found on its page) replaces what was typed, e.g. "V70 edge plus" → "Edge 70 Pro Plus"
    const found = String(pick.product_name || "").trim(), typed = product.trim();
    const named = (t) => withRealName(t, typed, found, brand);
    if (found && found.toLowerCase() !== typed.toLowerCase()) result.nameNote = `Typed “${typed}”; the product found online is “${found}”.`;
    copy = { headline: words(named(plan.headline), studio.copy.maxHeadlineWords), subline: words(offer || named(plan.subline), offer ? 12 : studio.copy.maxSublineWords), cta: plan.cta };
    result.copy = copy;
    result.design = { style, motif, chosenBy: STYLES.includes(o.style) ? "you" : STYLES.includes(known?.style) ? "brand knowledge" : "AI" };
    }
    lap("assets");

    // 4) shortlisted articles → fetched, safety-checked, their in-article images listed
    // a hard rule, not left to the AI: a headline naming a rival (or the brand itself) is never used
    const rivals0 = rivalMatcher([...(plan.competitors || []), ...(known?.competitors || [])]), rivals = (t) => rivals0(t) || (ownNews(t) ? ["the brand itself"] : null);
    const picked = (plan.shortlist || []).map((s) => ({ ...items[s.n - 1], why: s.why })).filter((x) => x.url);
    result.rivalHeadlinesDropped = picked.filter((x) => rivals(x.title)).map((x) => ({ url: x.url, title: x.title, names: rivals(x.title) }));
    const short = picked.filter((x) => !rivals(x.title)).slice(0, studio.fetchArticles);
    if (!short.length) throw new Error(`No recent article on the media-plan publishers is a good context for ${brand} ${product} right now.`);
    say(38, "articles", `Reading ${short.length} shortlisted articles…`);
    const secOf = new Map([...studio.sections, ...(studio.sitemaps || [])].map((s) => [s.id, s]));
    const got = await Promise.all(short.map(async (s) => {
      const old = store.listArticles().find((a) => a.url === s.url && !a.error && a.images && !a.images.some((im) => im.status === "unavailable") && "free" in a && Date.now() - Date.parse(a.fetchedAt) < 6 * 3600e3);
      const a = old || await analyseUrl({ url: s.url, publisher: secOf.get(s.section), fetcher, cfg, store, ask: null, fetchImpl, tmpDir: path.join(store.root, "tmp", "img") });
      return { s, a };
    }));
    lap("articles");
    const rejected = [], images = /** @type {any[]} */ ([]);
    for (const { s, a } of got) {
      if (a.error) { rejected.push({ url: s.url, title: s.title, why: `could not be read (${a.error.code})` }); continue; }
      if (a.free === false) { rejected.push({ url: s.url, title: s.title, why: "subscription article (the page marks it isAccessibleForFree: false)" }); continue; }
      // page safety (word lists, safety policy): only pages where nothing was flagged; the AI check below sees the text too
      if (a.safety.state === "unsafe" || a.safety.reasons.some((r) => r !== "SAFETY_AI_UNAVAILABLE" && r !== "SAFETY_CLEAR")) { rejected.push({ url: s.url, title: s.title, why: `page safety: ${a.safety.reasons.join(", ")}`, evidence: a.safety.evidence?.slice(0, 3) }); continue; }
      const usable = (a.images || []).filter((im) => im.status === "ok" && im.width >= studio.image.minWidth && im.width / im.height >= studio.image.minAspect && im.width / im.height <= studio.image.maxAspect).slice(0, studio.image.perArticle);
      if (!usable.length) { rejected.push({ url: s.url, title: s.title, why: "no landscape picture big enough for an in-image unit" }); continue; }
      for (const im of usable) { const rec = store.getImage(im.id); if (rec) images.push({ a, s, im: { ...rec, ...(rec.uses?.[a.id] || {}) } }); }
    }
    const rank = new Map(); for (const c of images) { const n = (rank.get(c.a.id) || 0); c.nth = n; rank.set(c.a.id, n + 1); }
    const pool = images.sort((x, y) => x.nth - y.nth).slice(0, studio.image.maxCandidates);
    if (!pool.length) throw new Error(`The shortlisted articles have no usable pictures (${rejected.map((r) => r.why).join("; ")}).`);
    say(52, "images", `Checking ${pool.length} article picture(s)…`);
    await Promise.all(pool.map(async (c, i) => {   // small JPEG copies for the AI check
      const raw = await downloadImage(c.im.finalUrl || c.im.src, path.join(cand, `a${i + 1}_src`), { fetchImpl, fs }).catch(() => null);
      if (raw) { c.file = path.join(cand, `a${i + 1}.jpg`); await ffmpeg(["-loglevel", "error", "-y", "-i", raw, "-vf", "scale=640:-2", "-frames:v", "1", c.file]).catch(() => { c.file = null; }); }
    }));
    const shown = pool.filter((c) => c.file && fs.existsSync(c.file)).map((c, i) => ({ ...c, k: i + 1 }));
    if (!shown.length) throw new Error("The article pictures could not be downloaded for the check.");

    // 5) AI: which picture, with the three checks
    say(60, "match", "Matching the ad to article photos (context · image · brand safety)…");
    let adRef = null;   // the client's creative as the AI sees it (a frame of a video)
    if (client) { adRef = path.join(cand, "client_ad.jpg"); await ffmpeg(["-loglevel", "error", "-y", ...(client.type === "video" ? ["-ss", "1.5"] : []), "-i", client.file, "-vf", "scale=640:-2", "-frames:v", "1", adRef]).catch(() => { adRef = null; }); }
    const fin = await timed(ask(
      `You place contextual in-image ads. ${client ? "The client's own ad (shown as AD) will be laid over the lower part of the chosen picture." : "A branded strip will cover the bottom 46% of the chosen picture."} You judge only what the article text and the pictures shown actually contain.`,
      `${brief ? brief + "\n" : ""}Ad: ${brand} — ${pick.product_name || product} (${plan.category}). ${client ? "The ad is the client's own creative (picture AD)." : `Strip copy: "${copy.headline}" / "${copy.subline}".`}\nCompetitors: ${[...new Set([...(known?.competitors || []), ...(plan.competitors || [])])].join(", ") || "-"}\nAvoid: ${(plan.avoid || []).join(", ") || "-"}\n\n` +
      // the article (first ~1,400 characters) and the paragraphs right around each picture: what a reader sees next to the ad
      shown.map((c) => `[${c.k}] Article: "${c.a.headline}"\n   Article text: ${norm(c.a.body || "").slice(0, 1400)}\n   Picture alt/caption: ${c.im.alt || c.im.caption || "-"}\n   Text just above the picture: ${norm(c.im.context?.before || "").slice(-450) || "-"}\n   Text just below the picture: ${norm(c.im.context?.after || "").slice(0, 450) || "-"}`).join("\n") +
      `\n\nFor every picture k give: context_fit (0-10: 9-10 only when the article is about this product's category or the main thing it is bought for; 6-8 closely related; 5 or less when the link is loose or indirect — e.g. a phone on a road-trip or travel story, shoes on a motorbike trip, noodles on a dal recipe), image_fit (0-10, does the picture's scene suit the product — the right setting or activity), safe (false if the article or picture involves anything in Avoid, tragedy, crime, illness, a negative view of this kind of product (health warnings, "unhealthy", calories, sodium, additives, junk, addiction, safety problems — anywhere in the article text, not only the headline), a competitor's product or logo (an article that reviews, launches, prices or reports on a specific product from another company in the same or a neighbouring category counts — for a phone that includes other tablets, smartwatches, earbuds and laptops), a recognisable celebrity or politician whose face next to the ad could look like an endorsement, or children as the focus for an adult product), safe_why, strip_ok, why (one sentence).`,
      FINAL_SCHEMA, [...(adRef ? [{ label: "AD — the client's own creative (for reference; do not score it)", file: adRef }] : []), ...shown.map((c) => ({ label: `Picture [${c.k}] (from article ${c.a.headline.slice(0, 70)})`, file: c.file }))], "high"), 32000);
    lap("ai_match");
    // a hard check next to the AI's score: the headline or section must name at least one of the product's topic words
    // (an article about alarms and deep sleep is not an earbuds article, whatever score it gets)
    const scored = shown.map((c) => { const v = { ...((fin.candidates || []).find((x) => x.k === c.k) || {}) };
      const hit = topicHit(`${c.a.headline} ${c.a.url}`, [...topicWords, ...(known?.category ? [known.category] : [])]);
      if (!hit && v.context_fit > 6) { v.context_fit_ai = v.context_fit; v.context_fit = 6; v.why = `${v.why || ""} (Capped at 6/10: the headline and section name none of the product's topics.)`.trim(); }
      v.topic = hit;
      return { ...c, v, score: (v.context_fit || 0) * 0.55 + (v.image_fit || 0) * 0.45 }; })
      .sort((x, y) => (Number(y.v.safe && y.v.strip_ok) - Number(x.v.safe && x.v.strip_ok)) || y.score - x.score);
    const ok = scored.filter((c) => c.v.safe && c.v.strip_ok && c.score >= studio.minScore && c.v.context_fit >= studio.minContext);
    result.candidates = scored.map((c) => ({ article: c.a.headline, url: c.a.url, image: c.im.finalUrl || c.im.src, ...c.v, score: +c.score.toFixed(1) }));
    result.rejectedArticles = rejected;
    if (!ok.length) throw new Error(`No article picture passed all three checks right now (best: “${scored[0]?.a.headline}” — ${scored[0]?.v.why || ""} ${scored[0]?.v.safe ? "" : scored[0]?.v.safe_why || ""}).`);

    // 6) the creative on the chosen picture, recorded on a phone
    const FONTS = path.join(HERE, "..", "..", "pipeline", "template", "fonts");
    let fontsCss = fs.readFileSync(path.join(FONTS, "fonts.css"), "utf8").replace(/url\((f\d+\.woff2)\)/g, `url(${ASSET_URL}$1)`);
    const files = client ? {} : { ["product.png"]: path.join(assets, "product.png") };
    if (logoFile) files["logo" + path.extname(logoFile)] = logoFile;
    for (const f of fs.readdirSync(FONTS).filter((x) => x.endsWith(".woff2"))) files[f] = path.join(FONTS, f);
    let html = null;
    if (!client) {
      const extra = await styleFonts(style, path.join(o.indexDir || path.join(workDir, "..", ".."), "_fonts"), fetchImpl).catch(() => null);   // no font → the design's fallback font
      if (extra) { fontsCss += "\n" + extra.css; Object.assign(files, extra.files); }
      html = stripHtml({ brand, ...copy, colour: result.brandLook.colour, accent: result.brandLook.accent, productUrl: ASSET_URL + "product.png", productMode, logoUrl: logoFile ? ASSET_URL + "logo" + path.extname(logoFile) : null, logoKind: result.brandLook.logo?.kind, logoInk: result.brandLook.logo?.ink, logoLight: result.brandLook.logo?.light, style, motif });
      fs.writeFileSync(path.join(workDir, "creative.html"), `<!doctype html><meta charset="utf-8"><!-- ${STRIP_VERSION} (${style}): open inside the mock renderer (assets are served from ${ASSET_URL}) -->\n${html}`);
    }
    const clientHold = client ? Math.min(9000, Math.max(5000, Math.round((client.seconds || 6) * 1000))) : 0;
    const base = `${slug(brand)}_${slug(product)}_inimage`;
    let out = null, chosen = null;
    const refused = new Set();   // an article refused for its page (wall, no phone layout, blanked) is not tried again with another picture
    for (const c of ok.filter((x, i, all) => all.findIndex((y) => y.a.url === x.a.url && y.im.id === x.im.id) === i).slice(0, 4)) {
      if (refused.has(c.a.url)) continue;
      if (out === null && result.renderProblems?.length && (Date.now() - t0) / 1000 > studio.budgetSeconds - 32) { result.renderProblems.push({ url: c.a.url, error: "not tried: the time budget was used up" }); break; }
      say(72, "render", `Recording the ad on “${c.a.headline.slice(0, 70)}”…`);
      try {
        out = client
          ? await renderMock({ articleUrl: c.a.url, leadImage: c.im.finalUrl || c.im.src, format: "in-image", outBase: path.join(workDir, base), video: true, strict: true,
            creativeFile: client.file, holdMs: clientHold, navTimeoutMs: 25000, ffmpeg, chromium: o.chromium })
          : await renderMock({ articleUrl: c.a.url, leadImage: c.im.finalUrl || c.im.src, format: "in-image", outBase: path.join(workDir, base), video: true, strict: true,
            creativeHtml: html, assets: files, fontsCss, fontFaces: styleFontFaces(style), fit: fitStrip, holdMs: studio.creative.seconds * 1000, navTimeoutMs: 25000, ffmpeg, chromium: o.chromium });
        chosen = c; break;
      } catch (e) { (result.renderProblems ||= []).push({ url: c.a.url, error: e.message }); if (/PAYWALL|NOT_MOBILE|NOT_VISIBLE|PAGE_LOAD/.test(e.code || "")) refused.add(c.a.url); }
    }
    lap("render");
    if (!out) throw new Error("The article page would not render the mock: " + (result.renderProblems || []).map((p) => p.error).join("; "));
    const sec = secOf.get(chosen.s.section) || {};
    result.placement = {
      article: { url: chosen.a.url, headline: chosen.a.headline, publisher: sec.name, published: chosen.a.published || chosen.s.published || null, fetchedAt: chosen.a.fetchedAt, contentHash: chosen.a.contentHash },
      image: { url: chosen.im.finalUrl || chosen.im.src, width: chosen.im.width, height: chosen.im.height, alt: chosen.im.alt || null, caption: chosen.im.caption || null, lead: !!chosen.im.lead },
      inventory: { section: sec.id, mediaPlan: sec.formats?.["in-image"] },
      slot: out.slot,
      checks: [
        { name: "Context match", pass: true, detail: `${chosen.v.context_fit}/10 — ${chosen.s.why || chosen.v.why}` },
        { name: "Image match", pass: true, detail: `${chosen.v.image_fit}/10 — ${chosen.v.why}` },
        { name: "Brand safety", pass: true, detail: `Page check: ${chosen.a.safety.reasons.filter((r) => !/AI_UNAVAILABLE/.test(r)).join(", ") || "no sensitive terms"}. Picture: ${chosen.v.safe_why}` },
      ],
    };
    result.files = { video: path.basename(out.mp4 || ""), still: path.basename(out.png), creative: client ? "assets/" + path.basename(client.file) : "creative.html", product: client ? null : "assets/product.png", logo: logoFile ? "assets/" + path.basename(logoFile) : null };
    result.timing = timing; result.seconds = timing.render;
    fs.writeFileSync(path.join(workDir, "result.json"), JSON.stringify(result, null, 1));
    say(100, "done", "Done.");
    return result;
  } catch (e) {   // a stopped run keeps what it found and why it stopped, for review
    try { fs.writeFileSync(path.join(workDir, "result.json"), JSON.stringify({ ...result, error: e.message, timing }, null, 1)); } catch { /* the error itself is what matters */ }
    throw e;
  }
}
