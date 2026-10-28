// Orchestration: discover articles from publisher feeds → fetch → extract → analyse → page safety → store;
// and recommendations for every stored article × live campaign creative.
import fs from "node:fs";
import path from "node:path";
import { parseFeed, notAnArticle } from "./feeds.mjs";
import { makeReader } from "./reader.mjs";
import { lexicalFeatures, aiFeatures } from "./analyse.mjs";
import { pageSafety } from "./safety.mjs";
import { recommend, rankRecs, recKey } from "./rank.mjs";
import { articleId } from "./store.mjs";
import { sha256 } from "./text.mjs";
import { similarity } from "./semantic.mjs";
import { extractImages, fetchImages, IMAGES_VERSION } from "./images.mjs";

export async function discover({ publisher, fetcher, limit = 10 }) {
  const found = [], errors = [];
  for (const feed of publisher.feeds) {
    try {
      const { text } = await fetcher.get(feed, "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5");
      for (const it of parseFeed(text)) {
        let host; try { host = new URL(it.url).host; } catch { continue; }
        if (host !== publisher.domain || notAnArticle(it.url) || found.some((f) => f.url === it.url)) continue;
        found.push({ ...it, publisherId: publisher.id, feed });
      }
    } catch (e) { errors.push({ feed, code: e.code || "ERROR", message: e.message }); }
  }
  return { articles: found.slice(0, limit), errors };
}

// Lead image to a local file for the AI image check (JPEG / PNG only — what the AI helpers accept).
async function leadImageFile(url, dir, fetchImpl) {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(15000), headers: { Accept: "image/jpeg,image/png" } });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !/image\/(jpeg|png)/.test(type)) return null;
    const f = path.join(dir, "lead." + (type.includes("png") ? "png" : "jpg"));
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    return f;
  } catch { return null; }
}

/** @returns {Promise<Record<string, any>>} the stored article record */
// reader: makeReader(...) with the app's Trafilatura / Firecrawl set up (one is made from the fetcher when not given)
export async function analyseUrl({ url, publisher, fetcher, cfg, store, ask, fetchImpl = globalThis.fetch, tmpDir = null, gray9x8 = null, reader = null, imageTimeoutMs = 15000 }) {
  const id = articleId(url), fetchedAt = new Date().toISOString();
  let rec;
  try {
    const { html, finalUrl, article: a } = await (reader || makeReader({ fetcher, fetchImpl })).read(url);
    const contentHash = sha256(`${a.headline}\n${a.body}`);
    const lexical = lexicalFeatures(a, cfg);
    let imageFile = null;
    if (ask && a.image?.url && tmpDir) { fs.mkdirSync(tmpDir, { recursive: true }); imageFile = await leadImageFile(a.image.url, tmpDir, fetchImpl); }
    const ai = await aiFeatures(a, cfg, ask, { imageFile });
    const features = { lexical, ai };
    // in-article images (for in-image placements): extracted from the same HTML, then only those images are fetched
    const ex = extractImages(html, finalUrl, a);
    await fetchImages(ex.images, { fetchImpl, allowed: fetcher.allowed || (async () => true), gray9x8, tmpDir: tmpDir && path.join(tmpDir, "..", "imghash"), fs, path, timeoutMs: imageTimeoutMs });
    for (const im of ex.images) store.saveImage(im, id);
    const images = ex.images.map((im) => ({ id: im.id, index: im.index, lead: im.lead, status: im.status, width: im.width || null, height: im.height || null, dupOf: im.dupOf || null }));
    rec = { id, url, publisherId: publisher.id, fetchedAt, contentHash, ...a, features, safety: pageSafety(a, features, cfg.safety), images, imagesInfo: { window: ex.window, skipped: ex.skipped },
      versions: { ...cfg.versions, images: IMAGES_VERSION } };
  } catch (e) {
    rec = { id, url, publisherId: publisher.id, fetchedAt, error: { code: e.code || "ERROR", message: String(e.message).slice(0, 300) }, versions: cfg.versions };
  }
  store.saveArticle(rec);
  return rec;
}

// Stored articles keep their fetched text and AI features; the deterministic parts (lexicon features, page safety)
// are re-derived when the lexicon or safety policy version changes, so every verdict matches the current policy.
export function refreshDerived(article, cfg) {
  if (article.error || !article.features) return false;
  if (article.versions?.lexicon === cfg.versions.lexicon && article.versions?.safety === cfg.versions.safety) return false;
  article.features.lexical = lexicalFeatures(article, cfg);
  article.safety = pageSafety(article, article.features, cfg.safety);
  article.versions = { ...article.versions, lexicon: cfg.versions.lexicon, safety: cfg.versions.safety, rederivedAt: new Date().toISOString() };
  return true;
}

// The live review decision for a recommendation key (latest wins).
const latestReviews = (store) => { const m = new Map(); for (const r of store.getReviews()) m.set(r.key, r); return m; };

export function recommendAll({ store, cfg, now = new Date() }) {
  const pubs = new Map(cfg.publishers.publishers.map((p) => [p.id, p]));
  const campaigns = store.getCampaigns(), reviews = latestReviews(store), vecs = store.getVectors();
  const byArticle = [];
  for (const article of store.listArticles()) {
    if (refreshDerived(article, cfg)) store.saveArticle(article);
    const recs = [];
    for (const campaign of campaigns) for (const creative of campaign.creatives) {
      recs.push(recommend({ article, campaign, creative, publisher: pubs.get(article.publisherId), cfg, now, review: reviews.get(recKey(article.id, campaign.id, creative.id)) || null, sim: similarity(vecs, article, campaign, cfg) }));
    }
    byArticle.push({ articleId: article.id, recommendations: rankRecs(recs) });
  }
  const run = { ranAt: now.toISOString(), versions: cfg.versions, campaigns: campaigns.length, articles: byArticle.length, results: byArticle };
  store.saveRecommendations(run);
  return run;
}
