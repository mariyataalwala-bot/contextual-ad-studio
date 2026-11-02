// 2-in-1 contextual ads: a brand's video ad (supplied by the client, or found on YouTube) is matched to a recent,
// brand-safe article on the media-plan publishers and shown as a 2-in-1 unit — video strip + display panel — over that
// article. Preview only: nothing is served live.
//
// Reuses the studio's pieces rather than copying them: the publisher feeds, sitemaps and Firecrawl discovery
// (studio.mjs, discover.mjs), the article reader + page safety (pipeline.mjs → reader.mjs → safety.mjs), the rival
// matcher, the brand knowledge and the one-advertiser-per-article rule. Video checks and the explainable match score
// are new and live here, as pure functions that can be tested without a network.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import dns from "node:dns/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { ownNames, brandBrief } from "./brands.mjs";
import { makeFetcher } from "./fetcher.mjs";
import { discoverArticles, urlKey } from "./discover.mjs";
import { analyseUrl } from "./pipeline.mjs";
import { makeReader, withTimeout } from "./reader.mjs";
import { EXTRACT_VERSION } from "./extract.mjs";
import { downloadImage } from "./websearch.mjs";
import { styleFonts, StudioStop, sectionItems, sitemapIndex, matchSlugs, rivalMatcher, usedArticles, topicHit, feedFetcher } from "./studio.mjs";
import { previewHtml, unitParts, INTRO_SECONDS } from "./twoinone-preview.mjs";
import { recordTwoInOne } from "./twoinone-export.mjs";
import { ASSET_URL } from "./mock.mjs";
import { runQa } from "./qa.mjs";
import { preparePanel } from "./panel-assets.mjs";

export const TWO_VERSION = "twoinone.v1";
export const DEFAULTS = {
  minSeconds: 5, maxSeconds: 120,     // length of the video ad
  minAspect: 1.5,                     // the unit's video strip is 16:9: vertical and square videos do not fit it
  maxAdAgeMonths: 30,                 // a YouTube ad published longer ago than this is treated as an expired campaign
  minContext: 6, minScore: 6.5,       // product relevance and overall score needed to place
  articleDays: 45, maxCandidates: 6, candidateCacheHours: 6, maxClientBytes: 80e6,
  budgetSeconds: 250,                // the run, then the recording of the video
};
export const cfgOf = (studio) => ({ ...DEFAULTS, ...(studio?.twoInOne || {}) });

const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const squish = (s) => norm(s).replace(/\s/g, "");
const GENERIC = /\b(india|indian|official|tv|ltd|limited|pvt|private|group|global|channel|inc|co|company|brand|brands|store|shop|world|hq)\b/g;
const clean = (s) => norm(s).replace(GENERIC, " ").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const youtubeId = (s) => (String(s || "").match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || String(s || "").trim().match(/^([A-Za-z0-9_-]{11})$/) || [])[1] || null;
const secs = (l) => { if (typeof l === "number") return l; if (!l) return null; const p = String(l).split(":").map(Number); return p.some(isNaN) ? null : p.reduce((a, b) => a * 60 + b, 0); };

// ---------- who is the brand: every name that means it ----------
export function brandNames({ brand, known }) {
  const out = new Set(ownNames(known));
  const typed = clean(brand); if (typed.length >= 3) out.add(typed);
  const first = typed.split(" ")[0]; if (typed.includes(" ") && first.length >= 4) out.add(first);
  return [...out];
}
const mentions = (text, names) => { const t = ` ${norm(text)} `, sq = t.replace(/\s/g, ""); return names.some((n) => t.includes(` ${n} `) || (n.replace(/\s/g, "").length >= 5 && sq.includes(n.replace(/\s/g, "")))); };
const channelIsBrand = (channel, names) => { const sq = squish(channel); return names.some((n) => n.replace(/\s/g, "").length >= 3 && sq.includes(n.replace(/\s/g, ""))); };

// Titles that are about the brand but are not its advertising
const NOT_AN_AD = /\b(reviews?|unboxing|unboxed|reaction|reacts?|first look|hands[- ]on|vs\.?|versus|comparison|compared|tutorial|how to|explained|podcast|interview|parody|spoof|fan[- ]?made|meme|tier list|top \d+|best \d+|compilation|live ?stream|news|scam|complaint)\b/i;
// A brand's channel for another country (Xiaomi Philippines, Xiaomi Deutschland): its ad is real but not what an Indian publisher's readers see
const OTHER_COUNTRY = /\b(philippines|deutschland|germany|france|espa[nñ]a|spain|italia|italy|indonesia|vietnam|thailand|malaysia|singapore|mexico|brasil|brazil|russia|turkiye|t[uü]rkiye|turkey|arabia|egypt|pakistan|bangladesh|nepal|sri lanka|japan|korea|china|uk|usa|canada|australia|poland|polska|nederland|ukraine)\b/i;
const AD_WORDS = /\b(tvc|ad film|ad|commercial|campaign|film|official|ft\.|launch)\b/i;

// ---------- YouTube: can this video be shown? ----------
// oEmbed is public and needs no key: 200 = playable and embeddable, 401 = the owner turned embedding off,
// 404 = removed or private. A network failure is retried once and then reported as "unknown" — never as a pass.
export async function youtubeProbe(id, { fetchImpl = globalThis.fetch, timeoutMs = 8000, retries = 1 } = {}) {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "ContextualAdStudio/1.0 (Mediakart demo tool)" } });
      if (r.status === 200) { const j = await r.json(); return { status: "ok", title: j.title || null, author: j.author_name || null, width: +j.width || null, height: +j.height || null }; }
      if (r.status === 401 || r.status === 403) return { status: "embed_off" };
      if (r.status === 404 || r.status === 400) return { status: "gone" };
    } catch { /* retried below */ }
    if (i < retries) await sleep(700);
  }
  return { status: "unknown" };
}

/**
 * Is this YouTube video a real, current, embeddable ad of this brand that fits the 2-in-1 video strip?
 * Pure: the caller supplies what YouTube said (search record, API details, oEmbed probe).
 * @param {{ brand: string, product?: string, known?: any, video: any, details?: any, probe?: any, now?: number, cfg?: typeof DEFAULTS, clientSupplied?: boolean }} o
 */
export function verifyYoutubeAd({ brand, product = "", known = null, video, details = null, probe = null, now = Date.now(), cfg = DEFAULTS, clientSupplied = false }) {
  const names = brandNames({ brand, known });
  const title = video.title || probe?.title || "", channel = video.channel || probe?.author || "", desc = details?.description || video.description || "";
  const checks = [], flags = [];
  const add = (name, pass, detail, hard = true) => checks.push({ name, pass, detail, hard });

  add("Available", probe ? (probe.status === "gone" ? false : probe.status === "unknown" ? null : true) : null,
    probe?.status === "gone" ? "YouTube says the video is removed or private" : probe?.status === "unknown" ? "YouTube could not be reached to confirm it is still available" : probe ? "YouTube confirms the video is public" : "not checked");
  add("Can be embedded", details?.embeddable === false || probe?.status === "embed_off" ? false : details?.embeddable === true || probe?.status === "ok" ? true : null,
    details?.embeddable === false || probe?.status === "embed_off" ? "the owner turned embedding off — it cannot be shown inside a page" : details?.embeddable === true || probe?.status === "ok" ? "the owner allows embedding" : "embedding could not be confirmed");
  const named = mentions(`${title} ${desc}`, names) || channelIsBrand(channel, names);
  add("Names the brand", named, named ? `“${brand}” appears in the title, description or channel` : `neither the title, the description nor the channel names ${brand}`);
  const own = channelIsBrand(channel, names);
  add("Brand's own channel", own || clientSupplied, own ? `${channel} is the brand's channel` : clientSupplied ? "supplied by the client as their own ad" : `${channel || "this channel"} is not the brand's own channel — it could be a review, a fan upload or a reseller`);
  const abroad = OTHER_COUNTRY.test(channel);
  add("For Indian readers", !abroad, abroad ? `${channel} is the brand's channel for another country — an India channel is preferred` : "not a channel for another country", false);
  add("A real ad", !NOT_AN_AD.test(title), NOT_AN_AD.test(title) ? "the title reads like a review, reaction, tutorial or news item, not an advertisement" : "the title does not read like a review or fan upload");
  const asp = video.aspect ?? (probe?.width && probe?.height ? probe.width / probe.height : null);
  add("16:9 format", asp == null ? null : asp >= cfg.minAspect && !/#shorts?\b|\bshorts\b|\breels?\b|vertical/i.test(title), asp == null ? "shape unknown" : asp >= cfg.minAspect ? `landscape (${asp.toFixed(2)}:1)` : `not landscape (${asp.toFixed(2)}:1) — the video strip is 16:9`);
  const len = secs(video.length ?? video.seconds);
  add("Length", len == null ? null : len >= cfg.minSeconds && len <= cfg.maxSeconds, len == null ? "length unknown" : `${len} s${len < cfg.minSeconds || len > cfg.maxSeconds ? ` — outside ${cfg.minSeconds}–${cfg.maxSeconds} s` : ""}`);
  const pub = details?.publishedAt || video.publishedAt || null;
  const months = pub ? (now - Date.parse(pub)) / (30.44 * 864e5) : null;
  add("Current campaign", months == null ? null : months <= cfg.maxAdAgeMonths, months == null ? "the publication date is not available (not invented)" : months <= cfg.maxAdAgeMonths ? `published ${String(pub).slice(0, 10)}` : `published ${String(pub).slice(0, 10)} — older than ${cfg.maxAdAgeMonths} months, an expired campaign`);

  const pw = norm(product).split(" ").filter((w) => w.length >= 3 && !names.some((n) => n.includes(w)));
  const hasProduct = pw.length && pw.some((w) => norm(`${title} ${desc}`).includes(w));
  add("Names the product", hasProduct || null, hasProduct ? "the title or description names the product" : "the product is not named in the title or description (a brand-level film can still fit)", false);

  const reasons = checks.filter((c) => c.hard && c.pass === false).map((c) => `${c.name}: ${c.detail}`);
  for (const c of checks) if (c.pass === null) flags.push(`${c.name}: ${c.detail}`);
  const score = (abroad ? -40 : 0) + (own ? 50 : 0) + (hasProduct ? 20 : 0) + (AD_WORDS.test(title) ? 10 : 0) + (months != null ? Math.max(0, 10 - months / 3) : 0) + (details?.embeddable === true || probe?.status === "ok" ? 10 : 0);
  return { ok: !reasons.length, official: own, score: Math.round(score), checks, reasons, flags };
}

/** The brand's YouTube ads, verified, best first — plus the ones that were turned away and why. */
/** @param {{ brand: string, product: string, known?: any, findAds: any, details?: any, probe?: any, cfg?: typeof DEFAULTS, now?: number, cacheFile?: string|null, say?: (m: string) => void }} o */
export async function discoverVideoCandidates({ brand, product, known = null, findAds, details = null, probe = youtubeProbe, cfg = DEFAULTS, now = Date.now(), cacheFile = null, say = () => {} }) {
  const key = norm(`${brand}|${product}`) + "|v3";   // bump when the ranking rules change, so an old list is not served
  let cache = {}; try { if (cacheFile) cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { /* none yet */ }
  const hit = cache[key];
  if (hit && now - hit.t < cfg.candidateCacheHours * 3600e3 && hit.r.candidates.length) return { ...hit.r, cached: true };   // one search per brand per few hours
  if (!findAds) throw new Error("YouTube search is not available in this app.");
  say(`Searching YouTube for ${brand}'s own advertisements…`);
  const found = await findAds({ brand, product });
  const out = { candidates: [], rejected: [], flags: [], cached: false };
  if (!found.length) { out.flags.push(`YouTube returned no official 16:9 ads for “${brand}${product ? " " + product : ""}”. Check the spelling, or upload the client's video instead.`); return out; }
  const ids = found.map((v) => v.id);
  const det = details ? await details(ids).catch((e) => { out.flags.push("YouTube details unavailable (" + String(e.message).slice(0, 80) + ") — publication dates not checked"); return null; }) : null;
  if (!details) out.flags.push("No YouTube API key — publication dates and embedding flags are not available; availability is checked through YouTube's public oEmbed.");
  const probes = await Promise.all(ids.map((id) => probe(id)));
  found.forEach((v, i) => {
    const d = det?.get?.(v.id) || null;
    const r = verifyYoutubeAd({ brand, product, known, video: v, details: d, probe: probes[i], now, cfg });
    const row = { id: v.id, title: v.title, channel: v.channel, url: `https://www.youtube.com/watch?v=${v.id}`, thumb: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, length: v.length || null,
      published: d?.publishedAt ? String(d.publishedAt).slice(0, 10) : null, official: r.official, score: r.score, checks: r.checks, flags: r.flags, why: v.why || null };
    if (r.ok) out.candidates.push(row); else out.rejected.push({ ...row, reasons: r.reasons });
  });
  out.candidates.sort((a, b) => b.score - a.score); out.candidates = out.candidates.slice(0, cfg.maxCandidates);
  if (!out.candidates.length) out.flags.push("None of the YouTube results passed the checks (own channel, real ad, 16:9, current, embeddable).");
  if (cacheFile && out.candidates.length) { try { cache[key] = { t: now, r: out }; fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch { /* a cache that cannot be written only costs a search */ } }
  return out;
}

// ---------- the client's own video file ----------
export function probeFile(file, { run = execFile } = {}) {
  return new Promise((resolve, reject) => run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeout: 30000, maxBuffer: 4e6 }, (e, out) => {
    if (e) return reject(new Error(e.code === "ENOENT" ? "ffprobe is needed on the computer running the app." : "The video file could not be read (damaged or not a video)."));
    try { resolve(JSON.parse(out)); } catch { reject(new Error("The video file could not be read.")); }
  }));
}

/** @param {{ probe: any, bytes?: number }} o @param {typeof DEFAULTS} cfg */
export function checkClientVideo({ probe, bytes = 0 }, cfg = DEFAULTS) {
  const v = (probe.streams || []).find((s) => s.codec_type === "video"), a = (probe.streams || []).find((s) => s.codec_type === "audio");
  const problems = [];
  if (!v) return { ok: false, facts: null, problems: ["The file has no video picture."] };
  const rot = Math.abs(+(v.tags?.rotate ?? v.side_data_list?.find((x) => "rotation" in x)?.rotation ?? 0)) % 180 === 90;
  const w = rot ? v.height : v.width, h = rot ? v.width : v.height, aspect = h ? +(w / h).toFixed(3) : null;
  const duration = +(+probe.format?.duration || +v.duration || 0).toFixed(1), format = String(probe.format?.format_name || "");
  if (!/mp4|mov|webm|matroska/.test(format)) problems.push(`Format “${format || "unknown"}” is not supported — use MP4, MOV or WebM.`);
  if (!/^(h264|vp8|vp9|av1|hevc)$/.test(v.codec_name || "")) problems.push(`The video codec “${v.codec_name}” cannot be played in a browser — export it as H.264.`);
  if (v.codec_name === "hevc") problems.push("H.265 (HEVC) does not play in every browser — export it as H.264.");
  if (!aspect || aspect < cfg.minAspect) problems.push(`The video is ${w}×${h} (${aspect}:1). The 2-in-1 video strip is landscape 16:9 — use the brand's TV / CTV commercial, not a vertical or square cut.`);
  if (duration < cfg.minSeconds || duration > cfg.maxSeconds) problems.push(`The video is ${duration} s long; the 2-in-1 unit takes ${cfg.minSeconds}–${cfg.maxSeconds} s.`);
  return { ok: !problems.length, problems, facts: { format: format.split(",")[0], codec: v.codec_name, width: w, height: h, aspect, duration, audio: !!a, bytes } };
}

const IDENTIFY_SCHEMA = { type: "object", additionalProperties: false, required: ["brand_seen", "matches_brand", "other_brand", "is_ad", "product_seen", "campaign", "evidence"],
  properties: { brand_seen: { type: "string" }, matches_brand: { type: "boolean" }, other_brand: { type: "string" }, is_ad: { type: "boolean" }, product_seen: { type: "string" }, campaign: { type: "string" }, evidence: { type: "string" } } };

/** Frames of a video ad → who advertises what (the AI sees only the frames; it never guesses a campaign). */
export async function identifyClientVideo({ ask, ffmpeg, file, duration, brand, product, known, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  for (const [i, t] of [duration * 0.08, duration * 0.3, duration * 0.5, duration * 0.7, duration * 0.9, Math.max(0, duration - 0.7)].entries()) {   // the last frame is usually the end card with the logo
    const out = path.join(dir, `frame${i + 1}.jpg`);
    await ffmpeg(["-loglevel", "error", "-y", "-ss", String(+t.toFixed(2)), "-i", file, "-vf", "scale=640:-2", "-frames:v", "1", out]).catch(() => {});
    if (fs.existsSync(out)) frames.push({ label: `Frame ${i + 1} at ${t.toFixed(1)} s`, file: out });
  }
  if (!frames.length) throw new Error("No frames could be read from the video.");
  const v = await ask("You identify who a video advertisement is for from still frames. Judge only what you can see (logos, packs, on-screen text, products); never guess.",
    `${known ? brandBrief(known) + "\n" : ""}The client says this video is an ad for brand “${brand}”, product “${product}”.\n` +
    `brand_seen: the brand name(s) you can actually see or read in the frames ("" if none). matches_brand: true only if what you see is clearly ${brand} (or its sub-brand or parent company). other_brand: a DIFFERENT advertiser's brand that is clearly shown as the advertiser ("" if none — an absence of any logo is not a different brand). is_ad: true if it looks like a commercial. product_seen: the product you can see ("" if unclear). campaign: a campaign name or tagline that is READABLE on screen ("" if none is — never invent one). evidence: one sentence on what you saw.`,
    IDENTIFY_SCHEMA, frames, "medium");
  return { ...v, frames: frames.map((f) => path.basename(f.file)) };
}

/**
 * What the frames say about the brand: the video shows the brand (ok); shows a different advertiser (wrong); shows no
 * brand at all — then it is not placed until the client confirms it is theirs (review), or has confirmed (client_confirmed).
 * @param {{ matches_brand?: boolean, brand_seen?: string, other_brand?: string, evidence?: string }} idn
 */
export function brandDecision(idn, { brand, confirmed = false }) {
  if (idn.matches_brand) return { action: "ok", message: "" };
  if (idn.other_brand || idn.brand_seen) return { action: "wrong", message: `This video does not show ${brand} — it shows “${idn.other_brand || idn.brand_seen}”. ${idn.evidence || ""}`.trim() };
  if (confirmed) return { action: "client_confirmed", message: `The brand could not be seen in the video's frames; the client confirmed it is ${brand}'s ad.` };
  return { action: "review", message: `The brand could not be confirmed from the video — no ${brand} logo or pack was visible in the frames, so it was not placed. Upload the full commercial with its end card, or confirm it is ${brand}'s ad.` };
}

// ---------- a video from a web address (client's file link) ----------
const privateIp = (ip) => { if (net.isIPv6(ip)) { const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); return m ? privateIp(m[1]) : /^(::1?|f[cd]|fe[89ab])/i.test(ip); }
  const [a, b] = ip.split(".").map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); };
export async function assertPublicUrl(u, lookup = dns.lookup) {
  const x = new URL(u);
  if (!/^https?:$/.test(x.protocol)) throw new Error("The video link must start with https://");
  if (x.hostname === "localhost" || x.hostname.endsWith(".local") || x.hostname.endsWith(".internal")) throw new Error("That address is not a public web address.");
  const addrs = net.isIP(x.hostname) ? [{ address: x.hostname }] : await lookup(x.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("That address is not a public web address.");
}
const VIDEO_EXT = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
export async function downloadVideo(url, destBase, { fetchImpl = globalThis.fetch, maxBytes = DEFAULTS.maxClientBytes, lookup = dns.lookup, timeoutMs = 60000 } = {}) {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(cur, lookup);
    const r = await fetchImpl(cur, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "ContextualAdStudio/1.0" } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { cur = new URL(r.headers.get("location"), cur).href; continue; }
    if (!r.ok) throw new Error(`The video link answered HTTP ${r.status}.`);
    const type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = VIDEO_EXT[type] || (/\.(mp4|webm|mov)(\?|$)/i.exec(cur)?.[1] || "").toLowerCase();
    if (!ext || (type && !/^video\/|application\/octet-stream/.test(type))) throw new Error("That link is not a video file (MP4, MOV or WebM). For a YouTube video paste its YouTube link.");
    if (+r.headers.get("content-length") > maxBytes) throw new Error(`The video is larger than ${Math.round(maxBytes / 1e6)} MB.`);
    const file = `${destBase}.${ext}`; let n = 0;
    const cap = async function* (src) { for await (const c of src) { n += c.length; if (n > maxBytes) throw new Error(`The video is larger than ${Math.round(maxBytes / 1e6)} MB.`); yield c; } };
    try { await pipeline(Readable.fromWeb(/** @type {any} */ (r.body)), cap, fs.createWriteStream(file)); } catch (e) { fs.rmSync(file, { force: true }); throw e; }
    return { file, ext, bytes: n };
  }
  throw new Error("The video link redirects too many times.");
}

// ---------- the contextual match: video ad × article ----------
const JUDGE_SCHEMA = { type: "object", additionalProperties: false, required: ["articles"], properties: { articles: { type: "array", items: { type: "object", additionalProperties: false,
  required: ["n", "product_relevance", "topic_intent", "campaign_fit", "article_safe", "safety_why", "exclusion", "evidence_quote", "why"],
  properties: { n: { type: "integer" }, product_relevance: { type: "integer" }, topic_intent: { type: "integer" }, campaign_fit: { type: "integer" }, article_safe: { type: "boolean" },
    safety_why: { type: "string" }, exclusion: { type: "string" }, evidence_quote: { type: "string" }, why: { type: "string" } } } } } };

export const recencyScore = (published, now = Date.now()) => { if (!published) return null; const d = (now - Date.parse(published)) / 864e5; return d <= 7 ? 10 : d <= 21 ? 8.5 : d <= 45 ? 7 : 4; };
export const WEIGHTS = { product: 0.35, topic: 0.25, campaign: 0.15, recency: 0.15, source: 0.10 };
const clamp = (n) => Math.max(0, Math.min(10, Math.round(+n || 0)));

/**
 * Score each article against the video ad: product relevance, article topic and intent, campaign message, recency,
 * source — with the evidence (a sentence copied from the article, checked to really be in it) and brand safety.
 * An article that does not fit is reported with its reasons; nothing is forced.
 * @param {{ ask: Function, brand: string, product: string, known?: any, video: { title?: string, channel?: string, campaign?: string|null, description?: string }, items: any[], topicWords?: string[], cfg?: typeof DEFAULTS, now?: number }} o
 */
export async function judgeMatch({ ask, brand, product, known = null, video, items, topicWords = [], cfg = DEFAULTS, now = Date.now() }) {
  if (!items.length) return [];
  const list = items.map((x, i) => `[${i + 1}] Headline: “${x.a.headline}” (${x.publisher}, ${x.a.published ? String(x.a.published).slice(0, 10) : "date unknown"})\n    Text${x.a.extraction?.status === "partial" ? " (only part could be read — judge only this)" : ""}: ${String(x.a.body || "").replace(/\s+/g, " ").trim().slice(0, 1400)}`).join("\n\n");
  const ans = await ask("You decide whether a video advertisement fits next to an article on a news publisher. You judge only the article text and the ad facts given; you never invent either.",
    `${known ? brandBrief(known) + "\n" : ""}Video ad: ${brand} — ${product}. Title: “${video.title || ""}”. ${video.campaign ? `Campaign / tagline on screen: “${video.campaign}”. ` : ""}${video.description ? `Description: ${String(video.description).slice(0, 300)}\n` : ""}\n` +
    `ARTICLES:\n${list}\n\nFor each article n give: product_relevance 0-10 (9-10 only when the article is about this product's category or the main thing people buy it for; 6-8 closely related; 5 or less when the link is loose, indirect or only a keyword mention); ` +
    `topic_intent 0-10 (is the reader, reading this, in a moment where this ad is natural and welcome?); campaign_fit 0-10 (does the ad's message sit naturally with the article); ` +
    `article_safe false when the article is a poor or unsafe place for ${brand} (crime, death, disaster, conflict, scandal, politics, sensitive health or finance stories, the brand's competitors or a negative story about ${brand}); safety_why: the reason in a few words; ` +
    `exclusion: "" or the reason this ad must not appear next to this article (competitor named, brand itself in the news, sensitive subject); ` +
    `evidence_quote: ONE sentence or phrase COPIED EXACTLY from that article's text that shows the topical link ("" if there is none — then product_relevance must be 5 or less); why: one plain sentence.`,
    JUDGE_SCHEMA, [], "high");
  return items.map((x, i) => {
    const v = (ans.articles || []).find((y) => y.n === i + 1) || {};
    const flags = [];
    let P = clamp(v.product_relevance), T = clamp(v.topic_intent), C = clamp(v.campaign_fit);
    // the evidence must be in the article; an unverifiable quote is dropped and the relevance is capped
    const quote = String(v.evidence_quote || "").trim(), found = quote.length >= 20 && norm(x.a.body || "").includes(norm(quote));
    if (!found) { if (P > 5) flags.push("capped at 5: no verifiable evidence sentence from the article"); P = Math.min(P, 5); }
    // a hard check next to the AI's opinion: the headline or address must name one of the product's topics
    const hit = topicHit(`${x.a.headline} ${x.a.url}`, [...topicWords, ...(known?.category ? [known.category] : [])]);
    if (!hit && P > 6) { flags.push("capped at 6: the headline names none of the product's topics"); P = 6; }
    const R = recencyScore(x.a.published, now), S = x.sourceScore ?? 8;
    if (R == null) flags.push("publication date not available — recency counted as neutral");
    const score = +(P * WEIGHTS.product + T * WEIGHTS.topic + C * WEIGHTS.campaign + (R ?? 5) * WEIGHTS.recency + S * WEIGHTS.source).toFixed(1);
    const safe = v.article_safe !== false && !String(v.exclusion || "").trim();
    return { ...x, judge: { product_relevance: P, topic_intent: T, campaign_fit: C, recency: R, source: S, score, safe, safety_why: v.safety_why || "", exclusion: String(v.exclusion || "").trim() || null,
      evidence: found ? quote : null, topic: hit, why: v.why || "", flags,
      fits: safe && score >= cfg.minScore && P >= cfg.minContext && T >= 5 } };
  }).sort((a, b) => Number(b.judge.fits) - Number(a.judge.fits) || b.judge.score - a.judge.score);
}

// ---------- articles: the studio's discovery + reading + page safety, then the match ----------
const TOPIC_SCHEMA = { type: "object", additionalProperties: false, required: ["words", "competitors"], properties: { words: { type: "array", items: { type: "string" } }, competitors: { type: "array", items: { type: "string" } } } };
const SHORT_SCHEMA = { type: "object", additionalProperties: false, required: ["shortlist"], properties: { shortlist: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "why"], properties: { n: { type: "integer" }, why: { type: "string" } } } } } };

/** @returns {Promise<{ items: any[], rejected: any[], review: any[], topicWords: string[], flags: string[], listed: number }>} fitting, readable, safe-looking articles for the ad */
export async function findArticles(o) {
  const { brand, product, known, studio, cfg, store, ask, py, fetchImpl, fc, indexDir, roots, say, video, tcfg } = o;
  const flags = [];
  const fetcher = makeFetcher({ fetchImpl, gapMs: 1000 }), feeds = feedFetcher(fetchImpl);
  const ownNews = (t) => (known ? ownNames(known).some((n) => ` ${norm(t)} `.includes(` ${n} `)) : !!rivalMatcher([brand])(t));
  say(30, "articles", `Looking for recent articles on ${new Set([...studio.sections, ...(studio.sitemaps || [])].map((s) => s.domain)).size} publishers…`);
  const topicP = ask("You help find articles for contextual ads.", `Brand: ${brand}. Product: ${product}.\n${known ? brandBrief(known) + "\n" : ""}${video.campaign ? `Campaign on screen: ${video.campaign}.\n` : ""}Give 15-25 lowercase single words (a few two-word phrases at most) that would appear in the web address of a news or lifestyle article that is a natural place for this product's video ad, and the names of competing brands (and their product lines).`, TOPIC_SCHEMA, [], "medium").catch(() => ({ words: [], competitors: [] }));
  const [feedItems, older, topic] = await Promise.all([
    sectionItems(studio, feeds),
    Promise.all((studio.sitemaps || []).map((sm) => sitemapIndex(sm, feeds, path.join(indexDir, "_index", sm.id + ".json")).catch(() => []))).then((x) => x.flat()),
    withTimeout(topicP, 45000, "Topic words").catch(() => ({ words: [], competitors: [] })),
  ]);
  const topicWords = [...new Set([...(topic.words || []), ...(known?.topics || [])])];
  const rivals = (() => { const r0 = rivalMatcher([...(topic.competitors || []), ...(known?.competitors || [])]); return (t) => r0(t) || (ownNews(t) ? ["the brand itself"] : null); })();
  const dc = studio.discovery || {};
  let searched = [];
  if (fc?.enabled) {
    const pubs = [...studio.sections, ...(studio.sitemaps || [])].map((p) => ({ domain: p.domain, id: p.id }));
    const f = await withTimeout(discoverArticles({ brand, product, topics: topicWords, rivals: (t) => rivals(t), ownNews, publishers: pubs, days: tcfg.articleDays, perPublisher: dc.perPublisher || 3, fc, searchOnly: true }), 25000, "Article search").catch((e) => ({ found: [], flags: ["article search: " + e.message] }));
    flags.push(...(f.flags || []));
    const seen = new Set(feedItems.map((x) => x.url));
    searched = (f.found || []).filter((x) => !seen.has(x.url)).map((x) => ({ url: x.url, title: x.title, published: null, section: x.publisher, via: "search" }));
  } else flags.push("Firecrawl key not set — search-based discovery is off (publisher feeds and sitemaps were used).");
  const seenUrl = new Set([...feedItems, ...searched].map((x) => x.url));
  const all = [...feedItems, ...searched, ...matchSlugs(older.filter((x) => !seenUrl.has(x.url)), topicWords)];
  const taken = new Map(); for (const r of roots) for (const [k, v] of usedArticles(r, brand)) taken.set(k, v);
  const hits = new Set([...matchSlugs(all, topicWords, 1e9).map((x) => x.url), ...searched.map((x) => x.url)]);
  const list = all.filter((x) => !taken.has(urlKey(x.url)) && !rivals(x.title)).sort((a, b) => Number(hits.has(b.url)) - Number(hits.has(a.url))).slice(0, o.compact ? Math.min(studio.listMax, 70) : studio.listMax);   // a small free model gets a shorter list
  if (!all.length) throw new Error("None of the media-plan publisher feeds answered just now. Try again in a minute.");
  say(38, "articles", `${list.length} recent articles to choose from — shortlisting the ones that fit ${product}…`);
  const numbered = list.map((x, i) => `${i + 1}. [${x.section}] ${x.title}`).join("\n");
  const plan = await withTimeout(ask("You pick articles for contextual video ads from the list given only.",
    `Brand: ${brand}. Product: ${product}.\n${known ? brandBrief(known) + "\n" : ""}Video ad title: “${video.title || ""}”${video.campaign ? `; campaign: “${video.campaign}”` : ""}.\nPick up to ${studio.shortlist} article numbers whose topic is a DIRECT fit for this product (its category, or the main thing people buy it for), best first, with why. Never an article about ${brand} itself or a competitor, and none on crime, death, disaster, conflict or politics.\n\n${numbered}`,
    SHORT_SCHEMA, [], "medium"), 60000, "Shortlisting").catch((e) => { throw new StudioStop("failed", `The AI service could not shortlist articles: ${String(e.message).replace(/^The AI provider /, "the provider ").slice(0, 260)}`); });
  const picked = (plan.shortlist || []).map((s) => ({ ...list[s.n - 1], why: s.why })).filter((x) => x.url && !rivals(x.title));
  if (!picked.length) return { items: [], rejected: [], review: [], topicWords, flags, listed: list.length };

  const secOf = new Map([...studio.sections, ...(studio.sitemaps || [])].map((s) => [s.id, s]));
  const reader = makeReader({ fetcher, py, firecrawl: o.firecrawlOpt || null, fetchImpl, timeoutMs: 25000, tmpDir: path.join(store.root, "tmp", "read") });
  const stored = store.listArticles(), rejected = [], review = [], items = [];
  say(46, "articles", `Reading ${Math.min(picked.length, studio.fetchArticles)} shortlisted articles…`);
  const got = await Promise.all(picked.slice(0, studio.fetchArticles).map(async (s) => {
    const old = stored.find((a) => a.url === s.url && !a.error && a.images && "free" in a && a.extraction?.version === EXTRACT_VERSION && Date.now() - Date.parse(a.fetchedAt) < 6 * 3600e3);   // read once, reused for a few hours
    const a = old || await withTimeout(analyseUrl({ url: s.url, publisher: secOf.get(s.section), fetcher, cfg, store, ask: null, fetchImpl, tmpDir: path.join(store.root, "tmp", "img"), reader, imageTimeoutMs: 8000 }), 35000, "Reading the article")
      .catch((e) => ({ url: s.url, error: { code: e.code || "ERROR", message: String(e.message).slice(0, 200) } }));
    return { s, a };
  }));
  for (const { s, a } of got) {
    const no = (why) => rejected.push({ url: s.url, title: a.headline || s.title, why });
    if (a.error) { no(`could not be read (${a.error.code})`); continue; }
    if (a.free === false) { no("subscription article"); continue; }
    if (a.published && Date.now() - Date.parse(a.published) > tcfg.articleDays * 864e5) { no(`stale — published ${String(a.published).slice(0, 10)}`); continue; }
    const ex = a.extraction || { status: "complete" };
    if (ex.status === "none" || ex.status === "headline_only") { review.push({ url: s.url, title: a.headline || s.title, why: "only the headline could be read — brand safety cannot be checked without the article text" }); no("only the headline could be read"); continue; }
    if (a.canonical && taken.has(urlKey(a.canonical))) { no(`already carries another brand's ad: ${taken.get(urlKey(a.canonical))}`); continue; }
    if (a.safety.state === "unsafe" || a.safety.reasons.some((r) => r !== "SAFETY_AI_UNAVAILABLE" && r !== "SAFETY_CLEAR")) { no(`page safety: ${a.safety.reasons.join(", ")}`); continue; }
    if (rivals(a.headline)) { no(`names a rival or the brand: ${rivals(a.headline).join(", ")}`); continue; }
    const sec = secOf.get(s.section);
    items.push({ a, s, publisher: sec?.name?.replace(/\s*›.*$/, "").replace(/\s*\(.*\)$/, "") || a.publisherId || "", sourceScore: sec ? 9 : 5, section: s.section });
  }
  return { items, rejected, review, topicWords, flags, listed: list.length };
}

// ---------- the whole run ----------
/**
 * @param {Record<string, any>} o  brand, product, known, studio, cfg, store, ask, ffmpeg, py, fetchImpl, fc, firecrawlOpt, indexDir, roots, workDir, say, signal,
 *   video: { kind: "file", file, name } | { kind: "youtube", id, clientSupplied?, record?, details?, probe? }, displayFile?, fileUrl(rel), dirRel, probe?, ytDetails?
 */
const FONT_FAMILY = { luxe: "Playfair Display", sport: "Anton", fresh: "Baloo 2", tech: "Space Grotesk" };
/** The brand's text theme: the typeface of its design style (Google Fonts, cached as local files, copied next to the unit). Null: system font. */
async function panelFont(style, workDir, indexDir, fetchImpl) {
  const family = FONT_FAMILY[style]; if (!family) return null;
  const f = await styleFonts(style, path.join(indexDir, "_fonts"), fetchImpl); if (!f) return null;
  const dir = path.join(workDir, "fonts"); fs.mkdirSync(dir, { recursive: true });
  for (const [name, file] of Object.entries(f.files)) fs.copyFileSync(file, path.join(dir, name));
  return { family, css: (/** @type {(r: string) => string|null} */ at) => f.css.replace(/url\([^)]*?(gf-[\w-]+\.woff2)\)/g, (_, n) => `url(${at("fonts/" + n)})`) };
}

export async function makeTwoInOne(o) {
  const { brand, product, known, studio, workDir } = o, tcfg = cfgOf(studio), fetchImpl = o.fetchImpl || globalThis.fetch, now = o.now || Date.now();
  const say = (pct, stage, msg) => { if (o.signal?.aborted) throw new StudioStop("failed", "Stopped: the run went over its time limit."); (o.say || (() => {}))(pct, stage, msg); };
  const t0 = Date.now(), timing = {}, lap = (k) => { timing[k] = +((Date.now() - t0) / 1000).toFixed(1); };
  fs.mkdirSync(path.join(workDir, "assets"), { recursive: true });
  const result = /** @type {Record<string, any>} */ ({ version: TWO_VERSION, mock: true, label: "MOCK — not a live placement. Nothing was served.", brand, product, createdAt: new Date().toISOString(), source: o.video.kind === "file" ? "client" : o.video.clientSupplied ? "client_youtube" : "youtube" });
  result.sourceLabel = { client: "Client supplied (video file)", client_youtube: "Client supplied (YouTube link)", youtube: "YouTube discovered" }[result.source];
  const fail = (status, msg, extra = {}) => { Object.assign(result, extra); throw new StudioStop(status, msg); };
  try {
    // 1) the video: verified, never replaced
    say(5, "video", o.video.kind === "file" ? "Checking the client's video file…" : "Checking the YouTube video…");
    let player, vInfo, videoRel = null;
    if (o.video.kind === "file") {
      const pr = await probeFile(o.video.file, { run: o.probeRun });
      const chk = checkClientVideo({ probe: pr, bytes: fs.statSync(o.video.file).size }, tcfg);
      result.video = { source: "client", name: o.video.name || path.basename(o.video.file), facts: chk.facts, checks: chk.problems };
      if (!chk.ok) fail("failed", chk.problems.join(" "), { rejection: { stage: "video", reasons: chk.problems } });
      say(10, "video", "Reading frames to confirm the brand and product…");
      const idn = await withTimeout(identifyClientVideo({ ask: o.ask, ffmpeg: o.ffmpeg, file: o.video.file, duration: chk.facts.duration, brand, product, known, dir: path.join(workDir, "assets", "frames") }), 70000, "Identifying the video")
        .catch((e) => fail("needs_review", `The video could not be identified (${String(e.message).slice(0, 120)}), so it was not placed. Try again.`));
      result.video.identified = idn;
      const dec = brandDecision(idn, { brand, confirmed: !!o.confirmBrand });
      if (dec.action === "wrong") fail("failed", dec.message, { rejection: { stage: "video", reasons: ["wrong brand"], identified: idn } });
      if (dec.action === "review") fail("needs_review", dec.message, { rejection: { stage: "video", reasons: ["brand not confirmed"], identified: idn } });
      if (dec.action === "client_confirmed") { idn.unverified = true; result.video.checks.push(dec.message); }
      if (!idn.is_ad) fail("failed", `This video does not look like an advertisement. ${idn.evidence || ""}`.trim(), { rejection: { stage: "video", reasons: ["not an ad"], identified: idn } });
      const rel = "assets/client_video." + path.extname(o.video.file).slice(1);
      if (path.resolve(o.video.file) !== path.resolve(workDir, rel)) fs.copyFileSync(o.video.file, path.join(workDir, rel));
      videoRel = rel; player = { kind: "file", src: o.fileUrl(rel), title: result.video.name };
      vInfo = { title: result.video.name, campaign: idn.campaign || null, description: "" };
      result.video.campaign = idn.campaign || null; result.video.stillFile = idn.frames[1] ? "assets/frames/" + idn.frames[1] : null;
    } else {
      const id = o.video.id;
      const [det, pr] = await Promise.all([o.ytDetails ? o.ytDetails([id]).then((m) => m?.get?.(id) || null).catch(() => null) : null, (o.probe || youtubeProbe)(id, { fetchImpl })]);
      const rec = o.video.record || { id, title: pr.title || "", channel: pr.author || "", length: det?.seconds ?? null, aspect: pr.width && pr.height ? pr.width / pr.height : null };
      if (det?.seconds != null && rec.length == null) rec.length = det.seconds;
      if (!rec.title && !rec.channel) fail("failed", "YouTube did not return this video's details (it may be unavailable, or YouTube could not be reached just now). Try again in a minute.", { rejection: { stage: "video", reasons: ["no details from YouTube"] } });
      const ver = verifyYoutubeAd({ brand, product, known, video: rec, details: det, probe: pr, now, cfg: tcfg, clientSupplied: !!o.video.clientSupplied });
      result.video = { source: result.source, id, url: `https://www.youtube.com/watch?v=${id}`, title: rec.title || pr.title || null, channel: rec.channel || pr.author || null, length: rec.length ?? null, published: det?.publishedAt ? String(det.publishedAt).slice(0, 10) : null,
        official: ver.official, checks: ver.checks, flags: ver.flags, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
      if (!ver.ok) fail("failed", `This YouTube video was not accepted — ${ver.reasons.join("; ")}.`, { rejection: { stage: "video", reasons: ver.reasons } });
      player = { kind: "youtube", id, title: result.video.title || "" };
      vInfo = { title: result.video.title || "", campaign: null, description: det?.description || "", channel: result.video.channel };
    }
    lap("video");
    // the product panel (pictures + words) is prepared while the articles are searched
    const emptyPanel = { logoInk: null, highlights: [], hero: null, product: null, logo: null, colour: null, accent: null, copy: { headline: "", subline: "", cta: "" }, productInfo: null, logoInfo: null, checks: [] };
    // the ad's own key visual, kept as the panel's picture when no product picture passes its check: the YouTube ad's
    // thumbnail (the uploader's chosen frame), or a frame from the middle of the client's own video
    const adVisual = async () => {
      const base = path.join(workDir, "assets", "ad_frame");
      if (o.video.kind === "youtube") { for (const q of ["maxresdefault", "sddefault", "hqdefault"]) { const f = await downloadImage(`https://i.ytimg.com/vi/${o.video.id}/${q}.jpg`, base, { fetchImpl, fs }).catch(() => null); if (f) return f; } return null; }
      const dur = result.video?.facts?.duration || 10;
      await o.ffmpeg(["-loglevel", "error", "-y", "-ss", String(+(dur * 0.5).toFixed(2)), "-i", o.video.file, "-vf", "scale=1280:-2", "-frames:v", "1", base + ".jpg"]).catch(() => {});
      return fs.existsSync(base + ".jpg") ? base + ".jpg" : null;
    };
    const panelP = o.displayFile ? Promise.resolve(null)
      : adVisual().catch(() => null).then((heroFile) => preparePanel({ brand, product, known, studio, ask: o.ask, py: o.py, ffmpeg: o.ffmpeg, fetchImpl, workDir, video: vInfo, say: (m) => say(18, "articles", m), budgetMs: 100000, heroFile, campaigns: o.campaigns || [] }))
        .catch((e) => ({ ...emptyPanel, flags: ["The product panel could not be prepared (" + String(e.message).slice(0, 120) + ") — it shows the brand and product name only."] }));

    // 2) articles
    say(28, "articles", "Finding articles…");
    const found = await findArticles({ ...o, tcfg, say, video: vInfo, indexDir: o.indexDir, roots: o.roots });
    result.discovery = { listed: found.listed, flags: found.flags, topicWords: found.topicWords };
    result.rejectedArticles = found.rejected; result.reviewArticles = found.review;
    lap("articles");
    if (!found.items.length) fail(found.review.length ? "needs_review" : "no_match", `No recent, brand-safe article on the media-plan publishers fits ${brand} ${product} right now${found.rejected.length ? ` (${found.rejected.length} checked and left out: ${found.rejected.slice(0, 3).map((r) => r.why).join("; ")})` : ""}.`);

    // 3) the match
    say(60, "match", `Matching the video to ${found.items.length} article${found.items.length === 1 ? "" : "s"}…`);
    const scored = await withTimeout(judgeMatch({ ask: o.ask, brand, product, known, video: vInfo, items: found.items, topicWords: found.topicWords, cfg: tcfg, now }), 90000, "The match")
      .catch((e) => fail("failed", `The matching step did not finish (${String(e.message).slice(0, 140)}). Nothing was placed — try again.`));
    result.candidates = scored.map((x) => ({ article: x.a.headline, url: x.a.url, publisher: x.publisher, published: x.a.published || null, ...x.judge }));
    lap("match");
    const best = scored.find((x) => x.judge.fits);
    if (!best) {
      const top = scored[0]?.judge;
      fail("no_match", `No article fits ${brand} ${product} well enough — the closest, “${scored[0]?.a.headline}”, scored ${top?.score}/10 (product relevance ${top?.product_relevance}/10)${top && !top.safe ? `, and was not brand-safe: ${top.exclusion || top.safety_why}` : ""}. Nothing was forced.`);
    }

    // 4) the preview
    say(80, "render", "Building the 2-in-1 preview…");
    const a = best.a, j = best.judge;
    const paragraphs = String(a.body || "").split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 50 && p !== a.headline).map((p) => p.slice(0, 650)).slice(0, 9);
    let heroRel = null;
    for (const im of (a.images || []).filter((x) => x.status === "ok").slice(0, 3)) {
      const rec = o.store.getImage(im.id); const url = rec?.finalUrl || rec?.src; if (!url) continue;
      const f = await downloadImage(url, path.join(workDir, "assets", "hero"), { fetchImpl, fs }).catch(() => null);
      if (f) { heroRel = "assets/" + path.basename(f); break; }
    }
    const displayRel = o.displayFile ? "assets/" + path.basename(o.displayFile) : null;
    say(88, "render", "Finishing the product panel…");
    const pa = await panelP;
    const site = known?.domains?.[0];
    // the brand's text theme: its design style's typeface (Google Fonts, kept as local files and served with the unit)
    const brandFont = await panelFont(pa?.style, workDir, o.indexDir || path.join(workDir, '..', '..'), fetchImpl).catch(() => null);
    const relOf = (f) => (f ? "assets/" + path.basename(f) : null);
    /** the page's input, with every picture and the client's video addressed through `u` */
    const inputFor = (/** @type {(rel: string) => string} */ u) => { const at = (/** @type {string|null} */ r) => (r ? u(r) : null);
      return { brand, product, publisher: best.publisher, article: { headline: a.headline, url: a.url, published: a.published || null, paragraphs, hero: at(heroRel) },
        video: /** @type {any} */ (o.video.kind === "file" ? { kind: "file", src: u(videoRel || ""), title: result.video.name } : player),
        panel: { colour: pa?.colour || known?.colours?.primary || null, accent: pa?.accent || known?.colours?.accent || null, logo: at(relOf(pa?.logo)), logoInk: pa?.logoInk || null, chips: pa?.highlights || [], hero: at(relOf(pa?.hero)), product: at(relOf(pa?.product)),
          productMode: pa?.productInfo?.method === "photo" ? "photo" : "cut", image: at(displayRel), productName: pa?.productInfo?.name || product, opener: pa?.copy?.opener || "", fontFamily: brandFont?.family || null, fontCss: brandFont ? brandFont.css(at) : "", headline: pa?.copy?.headline || "", subline: pa?.copy?.subline || "", cta: pa?.copy?.cta || (site ? "Know more" : null), ctaUrl: site ? `https://${site}` : null } }; };
    const display = inputFor(() => "").panel, displayImg = displayRel;
    const html = previewHtml(inputFor(o.fileUrl));
    fs.writeFileSync(path.join(workDir, "preview.html"), html);
    result.panel = displayImg ? { source: "client's own display picture, shown as supplied", colour: display.colour }
      : { source: pa?.product ? "product picture found online, checked as exactly this product, cut out" : pa?.hero ? "a frame of the brand’s own video ad (no product picture passed its check)" : "brand panel (no product picture passed its check)", copy: pa?.copy, product: pa?.productInfo, logo: pa?.logoInfo, colour: display.colour, accent: display.accent, flags: pa?.flags || [], checks: pa?.checks || [], chips: pa?.highlights || [], ctaUrl: display.ctaUrl };
    result.files = { preview: "preview.html", hero: heroRel };
    result.placement = {
      article: { headline: a.headline, url: a.url, canonical: a.canonical || null, publisher: best.publisher, published: a.published || null, publishedFrom: a.published ? "page" : null },
      match: { score: j.score, breakdown: { product_relevance: j.product_relevance, topic_intent: j.topic_intent, campaign_fit: j.campaign_fit, recency: j.recency, source: j.source }, weights: WEIGHTS, evidence: j.evidence, why: j.why, flags: j.flags, minScore: tcfg.minScore, minContext: tcfg.minContext },
      brandSafety: { status: j.safe ? "safe" : "unsafe", pageSafety: a.safety?.state || null, pageSafetyReasons: a.safety?.reasons || [], aiCheck: j.safe ? "no issue found" : j.exclusion || j.safety_why, extraction: a.extraction?.status || "complete" },
      unit: { layout: "2-in-1: a 9:16 card over the dimmed article, opened from an in-article slot — a short opening, then the 16:9 video ad on top and the animated product panel in the rest of the space", disclosure: "“Advertisement” label above the unit and a mock-preview bar; close button; sound off until the viewer unmutes", live: false },
    };
    // 5) the downloadable video: the unit recorded over the real article in a phone browser (9:16)
    if (o.record === false) result.export = { status: "skipped", error: "The video is not recorded on this server: it has too little memory to open a browser. The interactive preview below shows the same unit; run the app on your PC (or a 2 GB plan) to get the MP4." };
    if (o.record !== false) {
      say(92, "render", "Recording the mobile video…");
      try {
        const vsec = result.video?.facts?.duration ?? secs(result.video?.length) ?? 20, seconds = INTRO_SECONDS + Math.min(vsec || 20, 28) + 3.5, atAsset = (/** @type {string} */ r) => ASSET_URL + r;
        const ex = await withTimeout(recordTwoInOne({ fontCss: inputFor(atAsset).panel.fontCss || "", introSeconds: INTRO_SECONDS, articleUrl: a.url, parts: unitParts(inputFor(atAsset), { fixed: true }), fallbackHtml: previewHtml(inputFor(atAsset)), assetsDir: workDir, outBase: path.join(workDir, "twoinone"),
          seconds, ffmpeg: o.ffmpeg, chromium: o.chromium, say: (m) => say(94, "render", m) }), 150000, "Recording the video");
        result.files.video = "twoinone.mp4"; result.files.still = "twoinone.png";
        // the creative guidelines' checks over the finished file: nothing is exported as approved until they pass
        say(97, "render", "Checking the video against the creative guidelines…");
        const last = ex.geometry.at(-1)?.geom, sc = 3, region = last?.video ? { x: Math.round(last.video.x * sc), y: Math.round(last.video.y * sc), w: Math.round(last.video.w * sc) & ~1, h: Math.round(last.video.h * sc) & ~1 } : null;
        const dis = inputFor(atAsset).panel, said = [{ where: "headline", text: dis.headline }, { where: "subline", text: dis.subline }, { where: "button", text: dis.cta || "" }, ...(dis.chips || []).map((c) => ({ where: "chip", text: c }))].filter((x) => x.text);
        result.qa = await withTimeout(runQa({ file: ex.mp4, kind: "2in1", ask: o.ask, workDir, brand, product, brandNames: brandNames({ brand, known }), productNames: [product, pa?.productInfo?.name || ""].filter(Boolean), texts: said,
          allowedSource: `${product} ${vInfo.title || ""} ${vInfo.description || ""} ${known ? brandBrief(known) : ""}`, expected: { width: 1080, height: 1920, minSeconds: seconds - 2.5 }, geometry: ex.geometry, transitions: [INTRO_SECONDS], introSeconds: INTRO_SECONDS, settleAt: INTRO_SECONDS + 2.5, expectProduct: !!pa?.product, region,
          refs: { logo: pa?.logo || null, product: pa?.product || null }, safety: { status: j.safe ? "safe" : "unsafe", reasons: a.safety?.reasons || [] },
          notes: [...(o.video.kind === "youtube" ? ["The original ad is shown through YouTube's official embed and recorded for a pitch preview. Confirm the brand's permission before the video is distributed or placed live."] : []), ...(pa?.product ? [] : ["No product picture passed its check, so the panel has no product animation: it animates the brand (logo, colours, words). Upload the pack photo to add the product animation. A frame of the video is never used in place of the product."])],
          reviewNotes: "Top: the original 16:9 video ad. Below it: the MediaKart panel (logo, headline, subline, button) and a strip of chips.", frames: 12 }), 170000, "The quality checks")
          .catch((e) => ({ version: "qa.v1", approved: false, status: "incomplete", checks: [], issues: [], sampled: [], notes: [], seconds: 0, summary: "The quality checks could not finish (" + String(e.message).slice(0, 120) + ") — not approved." }));
        result.approval = result.qa.status;
        result.export = { status: "ready", size: "1080×1920 (9:16)", seconds: ex.seconds, recordedOn: ex.page === "article" ? "the real article page in a phone browser" : "our own copy of the article text (" + (ex.why || "the page could not be opened") + ")" };
      } catch (e) { result.export = { status: "failed", error: String(e.message).slice(0, 240) }; }
      lap("video");
    }
    result.seconds = +((Date.now() - t0) / 1000).toFixed(1); result.timing = timing; result.status = "success";
    result.statusWhy = null;
    fs.writeFileSync(path.join(workDir, "result.json"), JSON.stringify(result, null, 1));
    return result;
  } catch (e) {
    // every ending is written down: a run that stops still leaves its reason and what it had found
    result.status = e.status || "failed"; result.error = e.message; result.seconds = +((Date.now() - t0) / 1000).toFixed(1); result.timing = timing;
    try { fs.writeFileSync(path.join(workDir, "result.json"), JSON.stringify(result, null, 1)); } catch { /* best effort */ }
    throw e;
  }
}
