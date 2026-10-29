// Discovery with Firecrawl Search: for a brand (+ product), recent articles on the media-plan publishers that suit an
// in-image placement, and — kept separate — the brand's recent advertising campaigns, each verified on its own page.
//   1. Firecrawl Search (web + news), a configurable recent range, queries built from the product's topics (articles)
//      or the brand's campaign words (campaigns), restricted to the publisher / trade-press domains
//   2. every promising result is read and checked: headline, publication date, article text, address, pictures — with
//      the app's article reader (the page itself, then Trafilatura, then Firecrawl's rendered page for JavaScript pages)
//   3. ranked by topical relevance, recency, source reliability, contextual fit and brand safety; a page that merely
//      mentions the brand, a stale page, a rival's or the brand's own news, an unreadable page is left out with the reason
//   4. a campaign counts as verified only on a dated page that names the brand and a campaign, with the sentence quoted;
//      anything else is listed as unverified, never claimed
// Bounded: one retry for a search or a page, a time limit on everything, results de-duplicated and cached on disk.
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./text.mjs";
import { pageSafety } from "./safety.mjs";
import { lexicalFeatures } from "./analyse.mjs";
import { extractImages } from "./images.mjs";

export const DISCOVER_VERSION = "discover.v1";
const DAY = 864e5;
export const urlKey = (u) => String(u || "").replace(/[#?].*$/, "").replace(/\/amp(?=\/)/, "").replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ");
const reEsc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "street food" found also finds "food": the longer topic counts once
const distinct = (hits) => hits.filter((w) => !hits.some((o) => o !== w && o.includes(w)));
const has = (text, w) => new RegExp(`(^|[^a-z0-9])${reEsc(String(w).toLowerCase())}s?($|[^a-z0-9])`).test(words(text));

// ---------- Firecrawl: search and scrape with one retry, a time limit and a disk cache ----------
/**
 * @param {{ key: string|null, fetchImpl?: any, cacheDir?: string|null, timeoutMs?: number, retries?: number, searchTtlH?: number, scrapeTtlH?: number, sleep?: (ms: number) => Promise<any> }} o
 */
export function makeFirecrawl({ key, fetchImpl = globalThis.fetch, cacheDir = null, timeoutMs = 25000, retries = 1, searchTtlH = 6, scrapeTtlH = 48, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const cached = (kind, id, ttlH, make) => async () => {
    const f = cacheDir && path.join(cacheDir, `${kind}_${sha256(id).slice(0, 24)}.json`);
    if (f) { try { const c = JSON.parse(fs.readFileSync(f, "utf8")); if (Date.now() - c.t < ttlH * 3600e3) return { ...c.v, cached: true }; } catch { /* not cached */ } }
    const v = await make();
    if (f && v && !v.error) { try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ t: Date.now(), v })); } catch { /* cache only */ } }
    return v;
  };
  async function call(endpoint, body) {
    let last = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const r = await fetchImpl(`https://api.firecrawl.dev/v2/${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.success !== false) return j;
        last = `HTTP ${r.status}${j.error ? ": " + String(j.error).slice(0, 120) : ""}`;
        if (!(r.status === 429 || r.status >= 500)) break;   // only a busy or failing service is retried
      } catch (e) { last = String(e.message || e).slice(0, 160); }
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
    return { error: last || "no answer" };
  }
  return {
    enabled: !!key,
    /** web + news results: [{ url, title, description, source }] */
    search: (query, { tbs = "qdr:m", limit = 10, sources = ["web", "news"] } = {}) => cached("search", JSON.stringify([query, tbs, limit, sources]), searchTtlH, async () => {
      if (!key) return { error: "no Firecrawl key", results: [] };
      const j = await call("search", { query, limit, tbs, sources: sources.map((type) => ({ type })) });
      if (j.error) return { error: j.error, results: [] };
      const d = j.data || {};
      return { results: [...(d.web || []).map((x) => ({ ...x, source: "web" })), ...(d.news || []).map((x) => ({ ...x, description: x.snippet || x.description, source: "news" }))].filter((x) => x.url) };
    })(),
    /** a page's markdown + metadata (for pages the plain reader can't read) */
    scrape: (url) => cached("scrape", url, scrapeTtlH, async () => {
      if (!key) return { error: "no Firecrawl key" };
      const j = await call("scrape", { url, formats: ["markdown"], onlyMainContent: true, proxy: "basic" });
      return j.error ? { error: j.error } : { markdown: j.data?.markdown || "", metadata: j.data?.metadata || {} };
    })(),
  };
}

// ---------- dates ----------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** The publication date of a page and where it was found: page metadata, the text near the top, or the address.
 * @param {{ published?: any, metadata?: Record<string, any>, text?: string, url?: string }} [o] */
export function dateOf({ published = null, metadata = {}, text = "", url = "" } = {}) {
  const ok = (d) => d && !isNaN(d) && d.getFullYear() > 2000 && d.getTime() < Date.now() + DAY;
  for (const v of [published, metadata.publishedTime, metadata["article:published_time"], metadata.datePublished, metadata["og:article:published_time"], metadata.date]) {
    const d = v && new Date(Array.isArray(v) ? v[0] : v); if (ok(d)) return { date: d.toISOString(), from: v === published ? "page" : "metadata" };
  }
  const head = String(text || "").slice(0, 2500);
  let m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d\d)\b/i.exec(head);
  if (m) { const d = new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1])); if (ok(d)) return { date: d.toISOString(), from: "text" }; }
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d\d)\b/i.exec(head);
  if (m) { const d = new Date(Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2])); if (ok(d)) return { date: d.toISOString(), from: "text" }; }
  m = /\/(20\d\d)\/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|0?[1-9]|1[0-2])\/(\d{1,2})\//i.exec(url);
  if (m) { const mo = isNaN(+m[2]) ? MONTHS[m[2].slice(0, 3).toLowerCase()] : +m[2] - 1; const d = new Date(Date.UTC(+m[1], mo, +m[3])); if (ok(d)) return { date: d.toISOString(), from: "address" }; }
  return { date: null, from: null };
}
// the search's date range: exactly the last `days` days (Google's custom range; checked live with one site: per query)
const mdy = (t) => { const d = new Date(t); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`; };
export const tbsFor = (days, now = Date.now()) => `cdr:1,cd_min:${mdy(now - days * DAY)},cd_max:${mdy(now)}`;

// ---------- page types that never carry an article for placement or a campaign story ----------
const NOT_ARTICLE = /\/(tag|tags|topic|topics|author|authors|agencypro|category|section|search|videos?|photos?|gallery|web-stories?|live-updates?|liveblog)\/|\/(tag|topic)s?\/?$|\/page\/\d+/i;
const ROUNDUP = /\b(top \d+|\d+ (best|top|ads|campaigns)|these (ads|campaigns)|best ads|ads of the (week|month|year)|controversial ads|ads that|campaigns that|round-?up|week in ads|what's new in ads)\b/i;
// a headline about trouble (courts, raids, deaths, bans) is a poor place for an ad even when it names the product's topic
const NEGATIVE = /\b(court|hc|sc|police|arrest(s|ed)?|raids?|seize[sd]?|seizures?|bans?|banned|fined|penalty|violations?|lawsuit|fraud|scam|deaths?|dead|dies|died|killed|murder|attack(s|ed)?|accident|protests?|strike|cctvs?|extortion|poisoning|infestation|fda|fssai|probe|crackdown|controversy|row|politic(s|al)|elections?|bjp|congress|india bloc|minister|urine|vomit|rats?|cockroach(es)?|harass(ment|ed)?|assault(ed)?|abuse[sd]?)\b/i;
// the section in the address: lifestyle, food, travel, entertainment suit an ad; hard news, opinion and legal pages less
const SOFT = /\/(lifestyle|life-style|food|food-wine|recipes?|travel|health|fitness|wellness|beauty|fashion|entertainment|bollywood|parenting|auto|technology|tech|mumbai-guide|sunday-mid-day|trending)\//i;
const HARD = /\/(legal-news|opinion|columns?|editorial|politics|crime|explained|world|world-news|business|markets?|economy|india-news|elections?)\//i;
export const sectionFit = (u) => (SOFT.test(u) ? 1 : HARD.test(u) ? 0.4 : 0.7);
const CAMPAIGN_WORDS = /\b(campaign|ad film|tvc|(?<!chief )commercial(?!\s+(vehicles?|officer|operations|business))|new ad|anthem|jingle|micro-?drama|ad spot|advert|brand film|film|print ad|ooh|billboard|digital film|launches .{0,40}\bad\b|rolls out)\b/i;

// a campaign is verified on a sentence that says the brand launched it (not one that recalls an old ad)
const LAUNCH = /\b(launch(es|ed)?|unveil(s|ed)?|release[sd]?|roll(s|ed) out|rolled-out|introduce[sd]?|debut(s|ed)?|premiere[sd]?|drop(s|ped)|kick(s|ed) off|ran|runs|published|new|latest|fronts?|stars?|starring|featuring)\b/i;
// headlines that are about an ad but not the brand's own new campaign
const NOT_OWN_AD = /\b(fake|ai-made|ai-generated|spoof|parody|hoax|fan-made|deepfake|unofficial)\b/i;
const NOT_NEW = /\b(inside|at \d{2,3}|\d+ years of|history of|the history|legacy|throwback|looks? back|looking back|remembering|classic ads?|the story of|turnover|sales (up|down|rise|fall)|q[1-4] fy\d*|appoint(s|ed)?|named (cmo|ceo)|renamed|demerger|results)\b/i;

// ---------- articles for in-image placement ----------
/**
 * @param {{ brand: string, product?: string, topics: string[], rivals?: (t: string) => any, ownNews?: (t: string) => boolean,
 *   publishers: { domain: string, id: string, reliability?: number }[], days?: number, fc: any, reader?: any, cfg?: any, maxRead?: number, limit?: number,
 *   now?: number, log?: (m: string) => void, searchOnly?: boolean, perPublisher?: number }} o
 */
export async function discoverArticles(o) {
  const { brand, product = "", topics, fc, publishers, days = 45, maxRead = 8, limit = 5, now = Date.now(), log = () => {} } = o;
  const out = { version: DISCOVER_VERSION, enabled: !!fc?.enabled, queries: /** @type {any[]} */ ([]), candidates: /** @type {any[]} */ ([]), excluded: /** @type {any[]} */ ([]), flags: /** @type {string[]} */ ([]) };
  if (!fc?.enabled) { out.flags.push("Firecrawl key not set — search-based discovery is off (feeds and sitemaps are used instead)"); return out; }
  const domains = [...new Set(publishers.map((p) => p.domain.replace(/^www\./, "")))];
  const t = [...new Set([...topics, product].map((x) => String(x).toLowerCase().trim()).filter((x) => x.length > 2))];
  const seen = new Map();
  // one publisher and one topic per query: Firecrawl often answers "site:a OR site:b" or "x OR y OR z" with nothing
  // (checked live, Oct 2026); web results only: its news results ignore site: and bring e-paper and shop pages
  await Promise.all(domains.flatMap((dom) => t.slice(0, o.perPublisher || 3).map((w) => [dom, w])).map(async ([dom, w]) => {
    const query = `site:${dom} ${w.includes(" ") ? `"${w}"` : w}`;
    const r = await fc.search(query, { tbs: tbsFor(days, now), limit: 10, sources: ["web"] });
    out.queries.push({ query, results: r.results.length, cached: !!r.cached, error: r.error || null });
    for (const x of r.results) { const k = urlKey(x.url); if (!seen.has(k)) seen.set(k, x); }
  }));
  if (out.queries.every((q) => q.error)) out.flags.push("Firecrawl search failed: " + out.queries.map((q) => q.error).join("; "));
  // before reading: on the publishers, an article page, not a rival's or the brand's own story, about the product's topics
  const pre = [];
  for (const x of seen.values()) {
    const h = hostOf(x.url), pub = publishers.find((p) => h === p.domain.replace(/^www\./, ""));   // not gujarati.indianexpress.com etc.
    const text = `${x.title} ${x.description || ""}`;
    const why = !pub ? "not on a media-plan publisher" : NOT_ARTICLE.test(x.url) ? "not an article page (tag, section, video or live page)"
      : NEGATIVE.test(x.title || "") ? `negative news (${NEGATIVE.exec(x.title)[0]}) — a poor place for the ad`
      : o.rivals?.(x.title) ? `names a rival (${[].concat(o.rivals(x.title)).join(", ")})` : o.ownNews?.(x.title) ? "the brand's own news" : null;
    if (why) { out.excluded.push({ url: x.url, title: x.title, why }); continue; }
    const hits = t.filter((w) => has(text, w));
    if (!hits.length) { out.excluded.push({ url: x.url, title: x.title, why: has(text, brand) ? "only mentions the brand — not about the product's topics" : "none of the product's topics" }); continue; }
    pre.push({ ...x, pub, hits, rank: distinct(t.filter((w) => has(x.title, w))).length * 2 + distinct(hits).length + sectionFit(x.url) * 2 });
  }
  pre.sort((a, b) => b.rank - a.rank);   // the best are read first: topics in the headline, then in the snippet, a soft section
  if (o.searchOnly) { out.found = pre.map((x) => ({ url: x.url, title: x.title, description: x.description || "", publisher: x.pub.id, hits: x.hits })); return out; }
  // reading and checking: headline, date, text, pictures; stale, unreadable, paywalled or unsafe pages are left out
  for (const x of pre.slice(maxRead)) out.excluded.push({ url: x.url, title: x.title, why: `not read — only the best ${maxRead} results are read` });
  const read = await Promise.all(pre.slice(0, maxRead).map(async (x) => {
    try {
      const r = await o.reader.read(x.url);
      return { x, r };
    } catch (e) { return { x, err: `${e.code || "ERROR"}: ${String(e.message).slice(0, 120)}` }; }
  }));
  for (const { x, r, err } of read) {
    if (err) { out.excluded.push({ url: x.url, title: x.title, why: `could not be read (${err})` }); continue; }
    const a = r.article, body = String(a.body || "");
    const d = dateOf({ published: a.published, text: body, url: r.finalUrl });
    const age = d.date ? (now - Date.parse(d.date)) / DAY : null;
    if (a.free === false) { out.excluded.push({ url: x.url, title: a.headline || x.title, why: "subscription article" }); continue; }
    if (age !== null && age > days) { out.excluded.push({ url: x.url, title: a.headline || x.title, why: `stale — published ${d.date.slice(0, 10)}, older than ${days} days` }); continue; }
    if (body.length < 400) { out.excluded.push({ url: x.url, title: a.headline || x.title, why: "the article text could not be read" }); continue; }
    const headline = a.headline || x.title;
    if (o.rivals?.(headline) || o.ownNews?.(headline)) { out.excluded.push({ url: x.url, title: headline, why: "names a rival or is the brand's own news" }); continue; }
    if (NEGATIVE.test(headline)) { out.excluded.push({ url: x.url, title: headline, why: `negative news (${NEGATIVE.exec(headline)[0]}) — a poor place for the ad` }); continue; }
    const inTitle = distinct(t.filter((w) => has(headline, w))), inBody = distinct(t.filter((w) => has(body, w)));
    const onTopic = (body.match(/[^.!?]+[.!?]/g) || []).filter((s) => t.some((w) => has(s, w))).length;   // sentences about the topics
    // direct fits only: the headline names one of the product's topics and the text is about it, not a passing mention
    if (!inTitle.length || onTopic < 2) { out.excluded.push({ url: x.url, title: headline, why: `the headline is not about the product's topics (${inBody.length ? "a passing mention in the text" : "not in the text either"})` }); continue; }
    let safety = null;
    if (o.cfg) { try { safety = pageSafety(a, { lexical: lexicalFeatures(a, o.cfg), ai: { status: "unavailable", sensitive: [] } }, o.cfg.safety); } catch { safety = null; } }
    if (safety && (safety.state === "unsafe" || safety.reasons.some((rr) => !/SAFETY_AI_UNAVAILABLE|SAFETY_CLEAR/.test(rr)))) { out.excluded.push({ url: x.url, title: headline, why: `brand safety: ${safety.reasons.join(", ")}` }); continue; }
    const pics = (() => { try { return extractImages(r.html, r.finalUrl, a).images.filter((im) => !im.status || im.status === "ok"); } catch { return []; } })();
    // scores 0–1: relevance (topics in the headline count double), recency, source reliability, contextual fit, safety
    const relevance = Math.min(1, (inTitle.length * 2 + Math.min(inBody.length, 6)) / 8);
    const recency = age === null ? 0.4 : Math.max(0, 1 - age / days);
    const reliability = x.pub.reliability ?? 1;
    const fit = sectionFit(r.finalUrl);   // a lifestyle, food or travel section suits an ad better than hard news
    const score = +(0.35 * relevance + 0.25 * recency + 0.15 * reliability + 0.25 * fit).toFixed(3);
    const sentence = (body.match(/[^.!?]{20,240}[.!?]/g) || []).find((s) => t.some((w) => has(s, w))) || "";
    const flags = [];
    if (!d.date) flags.push("publication date not found — recency unverified");
    else if (d.from === "address" || d.from === "text") flags.push(`date read from the ${d.from === "text" ? "article text" : "address"}`);
    if (!pics.length) flags.push("no in-article picture found");
    if (a.extraction?.status === "partial") flags.push("only part of the article text could be read");
    if (!safety) flags.push("brand-safety word check not run");
    out.candidates.push({ title: headline, url: r.finalUrl, publisher: x.pub.id, date: d.date, dateFrom: d.from, score, scores: { relevance: +relevance.toFixed(2), recency: +recency.toFixed(2), reliability, fit, safe: !!safety },
      evidence: { topicsInHeadline: inTitle, topicsInText: inBody.slice(0, 8), sentence: sentence.trim().slice(0, 240), via: a.extraction?.method || null },
      reason: `The headline is about ${inTitle.join(", ")}${inBody.length > inTitle.length ? ` and the text covers ${inBody.filter((w) => !inTitle.includes(w)).slice(0, 3).join(", ")}` : ""}${d.date ? `; published ${d.date.slice(0, 10)}` : ""}${fit < 1 ? ` (a ${fit < 0.5 ? "news/opinion" : "general"} section)` : ""}.`,
      pictures: pics.slice(0, 3).map((im) => im.src), flags });
    log(`  ✓ ${headline.slice(0, 70)}`);
  }
  out.candidates.sort((a, b) => b.score - a.score);
  out.candidates = out.candidates.slice(0, limit);
  if (!out.candidates.length) out.flags.push("no recent, relevant article found on the media-plan publishers in this range");
  return out;
}

// ---------- the brand's recent campaigns (separate from placement) ----------
/** The campaign's own name when the headline (or the quoted sentence) gives it in quotes: 'Hunger Ka Dosti', “Get Set Go” */
export const campaignName = (...texts) => { for (const s of texts) { const m = /(?:^|[\s(])[‘'"“]([^‘’'"“”]{3,48})[’'"”](?=$|[\s,.:;!?)])/.exec(String(s || "")); if (m) return m[1].trim(); } return null; };
/**
 * @param {{ brand: string, product?: string, aliases?: string[], months?: number, fc: any, reader?: any, tradePress: string[], maxRead?: number, now?: number }} o
 */
export async function discoverCampaigns(o) {
  const { brand, fc, tradePress, months = 12, maxRead = 6, now = Date.now() } = o;
  const oldestYear = new Date(now - months * 30.5 * DAY).getUTCFullYear();
  const checkHeadline = (t) => (NOT_OWN_AD.test(t || "") ? `about a fake or unofficial ad (${NOT_OWN_AD.exec(t)[0]}), not the brand's campaign` : NOT_NEW.test(t || "") ? `a feature or business story (${NOT_NEW.exec(t)[0]}), not a new campaign` : null);
  // the sentence that says the brand launched it: names the brand, a campaign word and a launch word, and no older year
  const sentences = (text) => String(text).replace(/\s+/g, " ").match(/[^.!?]{20,300}[.!?]/g) || [];
  const recentOnly = (s) => !(s.match(/\b(19|20)\d\d\b/g) || []).some((y) => +y < oldestYear);
  const launchSentence = (text) => sentences(text).find((s) => names.some((n) => has(s, n)) && CAMPAIGN_WORDS.test(s) && LAUNCH.test(s) && recentOnly(s)) || "";
  const campaignSentence = (text) => sentences(text).find((s) => CAMPAIGN_WORDS.test(s) && recentOnly(s)) || "";
  const names = [...new Set([brand, ...(o.aliases || [])].map((n) => String(n).toLowerCase()).filter((n) => n.length > 2))];
  const productWords = String(o.product || "").split(/[^A-Za-z0-9]+/).filter((w) => /[A-Z0-9]/.test(w) && w.length > 1).map((w) => w.toLowerCase()).filter((w) => !names.some((n) => n.includes(w)));
  const out = { version: DISCOVER_VERSION, enabled: !!fc?.enabled, verified: /** @type {any[]} */ ([]), unverified: /** @type {any[]} */ ([]), excluded: /** @type {any[]} */ ([]), queries: /** @type {any[]} */ ([]), flags: /** @type {string[]} */ ([]) };
  if (!fc?.enabled) { out.flags.push("Firecrawl key not set — campaign discovery is off"); return out; }
  const query = `"${brand}" (campaign OR "ad film" OR TVC OR commercial OR "new ad") (${tradePress.map((d) => `site:${d}`).join(" OR ")})`;
  const r = await fc.search(query, { tbs: tbsFor(Math.round(months * 30.5), now), limit: 12, sources: ["web"] });
  out.queries.push({ query, results: r.results.length, cached: !!r.cached, error: r.error || null });
  if (r.error) { out.flags.push("Firecrawl search failed: " + r.error); return out; }
  const seen = new Set(), pre = [];
  for (const x of r.results) {
    const k = urlKey(x.url); if (seen.has(k)) continue; seen.add(k);
    const why = NOT_ARTICLE.test(x.url) ? "not an article (tag, agency or listing page)" : !names.some((n) => has(x.title || "", n)) ? "the headline does not name the brand"
      : ROUNDUP.test(x.title || "") ? "a round-up of many brands' ads, not this brand's campaign" : checkHeadline(x.title);
    if (why) { out.excluded.push({ url: x.url, title: x.title, why }); continue; }
    pre.push(x);
  }
  for (const x of pre.slice(maxRead)) out.unverified.push({ title: x.title, url: x.url, why: `not read — only ${maxRead} pages are checked` });
  const read = await Promise.all(pre.slice(0, maxRead).map(async (x) => {
    try { const p = await o.reader.read(x.url); return { x, title: p.article.headline || x.title, text: p.article.body || "", published: p.article.published, url: p.finalUrl, metadata: {} }; }
    catch (e) {   // the trade site could not be read directly: Firecrawl's copy of the page
      const s = await fc.scrape(x.url);
      if (s.error) return { x, err: `${e.code || "ERROR"} / Firecrawl: ${s.error}` };
      return { x, title: String(s.metadata?.ogTitle || s.metadata?.title || x.title).trim(), text: s.markdown, published: null, url: x.url, metadata: s.metadata || {} };
    }
  }));
  for (const p of read) {
    if (p.err) { out.unverified.push({ title: p.x.title, url: p.x.url, why: `the page could not be read (${p.err})` }); continue; }
    const d = dateOf({ published: p.published, metadata: p.metadata, text: p.text, url: p.url });
    const age = d.date ? (now - Date.parse(d.date)) / DAY : null;
    const titleLaunch = names.some((n) => has(p.title, n)) && LAUNCH.test(p.title) && CAMPAIGN_WORDS.test(`${p.title} ${String(p.text).slice(0, 1500)}`);
    const sentence = launchSentence(p.text) || (titleLaunch ? campaignSentence(p.text) : "");
    const item = { title: p.title, name: campaignName(p.title, sentence), url: p.url, date: d.date, dateFrom: d.from, evidence: sentence.trim().slice(0, 300),
      forProduct: productWords.length ? productWords.some((w) => has(`${p.title} ${sentence}`, w)) : null };
    const headlineWhy = checkHeadline(p.title);
    if (headlineWhy) { out.excluded.push({ ...item, why: headlineWhy }); continue; }
    if (!sentence) { out.excluded.push({ ...item, why: "no sentence says the brand launched a campaign (only mentions, or an older ad)" }); continue; }
    if (!d.date) { out.unverified.push({ ...item, why: "publication date not found — not claimed as recent" }); continue; }
    if (age > months * 30.5) { out.excluded.push({ ...item, why: `older than ${months} months (${d.date.slice(0, 10)})` }); continue; }
    out.verified.push(item);
  }
  out.verified.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const byName = new Map();
  out.verified = out.verified.filter((c) => { const k = c.name?.toLowerCase() || c.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 48);
    const first = byName.get(k); if (!first) { byName.set(k, c); c.alsoReported = []; return true; }
    first.alsoReported.push(c.url); if (c.forProduct) first.forProduct = true; return false; });
  if (!out.verified.length) out.flags.push(`no verified campaign for ${brand} in the last ${months} months`);
  else if (productWords.length && !out.verified.some((c) => c.forProduct)) out.flags.push(`none of the verified campaigns names ${o.product} — they are the brand's campaigns for other products or lines`);
  return out;
}
