// Meaning (semantic) matching: campaigns with a brief are matched by embedding similarity; campaigns without a brief
// score exactly as before; negative-tone articles go to review; vectors are computed once and reused.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recommend } from "../../openweb/lib/rank.mjs";
import { ensureVectors, similarity, articleKey, campaignKey } from "../../openweb/lib/semantic.mjs";
import { makeStore } from "../../openweb/lib/store.mjs";
import { normaliseCampaign } from "../../openweb/lib/campaigns.mjs";
import { cfg, article, campaign, pub, aiOk, NOW, FILLER } from "./helpers.mjs";

const SM = cfg.scoring.semantic;
const GROCERY = ["Batch-prep on Sunday: stock up on vegetables, dal, rice and paneer so weekday dinners take ten minutes.", "Keep a list of the staples you run out of most often.", FILLER, FILLER];
const briefCampaign = (over = {}) => campaign({ brand: "QuickGrocer", brief: "Groceries delivered in minutes for people cooking at home.", targeting: { iab: [], keywords: [], objects: [] }, ...over });
const rec = (a, c, sim, review = null) => recommend({ article: a, campaign: c, creative: c.creatives[0], publisher: pub(a.publisherId), cfg, now: NOW, review, sim });
const safeArticle = (over = {}) => article({ headline: "For working couples who batch-prep twice a week", paras: GROCERY, ai: aiOk({ sentiment: "positive" }), ...over });

test("scoring.v2: the semantic policy is valid (weights add up to 100, floor < minAlone < full)", () => {
  assert.equal(cfg.versions.scoring, "scoring.v2");
  assert.equal(Object.values(cfg.scoring.semanticWeights).reduce((a, b) => a + b, 0), 100);
  assert.ok(SM.floor < SM.minAlone && SM.minAlone < SM.full);
});

test("brief + strong meaning match → recommended with no IAB target, with MEANING evidence", () => {
  const r = rec(safeArticle(), briefCampaign(), 0.63);
  assert.equal(r.status, "recommended");
  assert.ok(r.reasons.includes("MEANING:0.63"));
  assert.ok(r.evidence.some((e) => e.kind === "semantic"));
  assert.ok(r.score >= cfg.scoring.minScoreToRecommend);
  assert.equal(r.score, Math.round(Object.values(r.parts).reduce((x, y) => x + y, 0)), "score is still the sum of its parts");
});

test("brief with no keywords / objects / IAB: meaning carries those weights (the score can still reach 100)", () => {
  const r = rec(safeArticle(), briefCampaign(), SM.full);
  const W = cfg.scoring.semanticWeights;
  assert.equal(r.parts.semantic, W.semantic + W.category + W.keywords + W.headline + W.object);
  assert.equal(r.parts.category, 0);
});

test("weak meaning and no category → excluded NO_CATEGORY_OR_MEANING_MATCH; missing vector → MEANING_PENDING", () => {
  assert.equal(rec(safeArticle(), briefCampaign(), SM.minAlone - 0.01).reasons[0], "NO_CATEGORY_OR_MEANING_MATCH");
  assert.equal(rec(safeArticle(), briefCampaign(), null).reasons[0], "MEANING_PENDING");
});

test("unrelated article (sport) scored like the live calibration run stays out", () => {
  const a = article({ headline: "India beat Australia by 5 wickets", paras: ["India chased the target with two overs to spare.", FILLER, FILLER], ai: aiOk({ sentiment: "positive" }) });
  assert.equal(rec(a, briefCampaign(), 0.47).status, "excluded");
});

test("gates still come first: a competitor mention excludes even a perfect meaning match", () => {
  const a = safeArticle({ paras: ["We compared RivalMart with other apps for vegetables and dal.", ...GROCERY] });
  const r = rec(a, briefCampaign({ exclusions: { competitors: ["RivalMart"], keywords: [], iab: [] } }), 0.7);
  assert.equal(r.status, "excluded"); assert.equal(r.score, null); assert.match(r.reasons[0], /^COMPETITOR_MENTION/);
});

test("negative-tone article → needs_review (NEGATIVE_TONE), for campaigns with or without a brief", () => {
  const neg = safeArticle({ ai: aiOk({ sentiment: "negative" }) });
  const r = rec(neg, briefCampaign(), 0.64);
  assert.equal(r.status, "needs_review"); assert.ok(r.reasons.includes("NEGATIVE_TONE"));
  const FOOD = ["Oats adai is a savoury breakfast recipe: mix oats, paneer and vegetables, then cook the batter on a hot pan.", "The ingredients are simple and the flavour is excellent for a healthy breakfast.", FILLER, FILLER];
  const negFood = article({ headline: "Oats adai recipe", paras: FOOD, ai: aiOk({ sentiment: "negative", categories: [{ iab: "216", quote: "Oats adai is a savoury breakfast recipe" }] }) });
  const r2 = recommend({ article: negFood, campaign: campaign({ targeting: { iab: ["210"], keywords: ["recipe"] } }), creative: campaign().creatives[0], publisher: pub(), cfg, now: NOW });
  assert.equal(r2.status, "needs_review"); assert.ok(r2.reasons.includes("NEGATIVE_TONE"));
});

test("campaign without a brief: no semantic part and a similarity value is ignored (v1 behaviour)", () => {
  const c = campaign({ targeting: { iab: ["210"], keywords: ["recipe"] } });
  const FOOD = ["Oats adai is a savoury breakfast recipe: mix oats, paneer and vegetables, then cook the batter on a hot pan.", FILLER, FILLER];
  const a = article({ headline: "Oats adai recipe", paras: FOOD, ai: aiOk({ categories: [{ iab: "216", quote: "Oats adai is a savoury breakfast recipe" }] }) });
  const r1 = recommend({ article: a, campaign: c, creative: c.creatives[0], publisher: pub(), cfg, now: NOW, sim: 0.9 });
  const r2 = recommend({ article: a, campaign: c, creative: c.creatives[0], publisher: pub(), cfg, now: NOW });
  assert.deepEqual(r1, r2); assert.equal(r1.parts.semantic, undefined);
});

test("a campaign may use a brief instead of IAB categories (one of the two is required)", () => {
  const base = { brand: "B", status: "active", start: "2026-10-01", end: "2026-10-31", creatives: [{ format: "in-image" }] };
  assert.ok(normaliseCampaign({ ...base }, cfg).problems.some((x) => /IAB category|brief/.test(x)));
  assert.deepEqual(normaliseCampaign({ ...base, brief: "Groceries in minutes" }, cfg).problems, []);
});

test("vectors: computed once per text, stored, reused; similarity is the cosine of unit vectors", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-sem-")), store = makeStore(dir);
  const c = briefCampaign(); store.saveCampaigns([c]);
  const a = safeArticle(); store.saveArticle(a);
  const calls = [];
  const embed = async (texts, task) => { calls.push({ n: texts.length, task }); return texts.map(() => (task === "RETRIEVAL_QUERY" ? [3, 4, 0] : [4, 3, 0])); };
  const r1 = await ensureVectors({ store, cfg, embed });
  assert.deepEqual([r1.added, r1.missing, r1.error], [2, 0, null]);
  const r2 = await ensureVectors({ store, cfg, embed });
  assert.equal(r2.added, 0); assert.equal(calls.length, 2, "second run embeds nothing");
  const vecs = store.getVectors();
  assert.ok(vecs[articleKey(a, cfg)] && vecs[campaignKey(c, cfg)]);
  assert.equal(similarity(vecs, a, c, cfg), 0.96);   // (3·4 + 4·3) / 25
  assert.equal(similarity(vecs, a, { ...c, brief: "" }, cfg), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("vectors: an embedding failure is reported, not thrown, and what was done is kept", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-sem-")), store = makeStore(dir);
  store.saveCampaigns([briefCampaign()]); store.saveArticle(safeArticle());
  const r = await ensureVectors({ store, cfg, embed: async (t, task) => { if (task === "RETRIEVAL_DOCUMENT") throw new Error("quota"); return t.map(() => [1, 0]); } });
  assert.equal(r.added, 1); assert.equal(r.missing, 1); assert.match(r.error, /quota/);
  fs.rmSync(dir, { recursive: true, force: true });
});
