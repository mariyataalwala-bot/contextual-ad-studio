// Safety gates, campaign gates, format gates, relevance — including the cases the brief calls out:
// false positives, irrelevant content, missing data, unsafe pages, expired campaigns, incompatible formats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recommend } from "../../openweb/lib/rank.mjs";
import { pageSafety } from "../../openweb/lib/safety.mjs";
import { campaignGate, normaliseCampaign, todayIST } from "../../openweb/lib/campaigns.mjs";
import { cfg, article, campaign, pub, aiOk, NOW, FILLER } from "./helpers.mjs";

const FOOD = ["Oats adai is a savoury breakfast recipe: mix oats, paneer and vegetables, then cook the batter on a hot pan.", "The dish is quick, the ingredients are simple and the flavour is excellent for a healthy breakfast.", FILLER, FILLER];
const foodAI = aiOk({ categories: [{ iab: "216", quote: "Oats adai is a savoury breakfast recipe" }] });
const foodCampaign = (over = {}) => campaign({ brand: "Catch", targeting: { iab: ["210"], keywords: ["recipe", "breakfast", "flavour"] }, ...over });
const rec = (a, c, creative = c.creatives[0], publisher = pub(a.publisherId), now = NOW, review = null) => recommend({ article: a, campaign: c, creative, publisher, cfg, now, review });

// ---------- page safety ----------
test("a relevant, safe article is recommended with evidence and reason codes", () => {
  const r = rec(article({ headline: "Oats adai recipe for a healthy breakfast", paras: FOOD, ai: foodAI }), foodCampaign());
  assert.equal(r.status, "recommended");
  assert.ok(r.score >= cfg.scoring.minScoreToRecommend);
  assert.ok(r.evidence.length > 0 && r.reasons.length > 0);
  assert.ok(r.reasons.some((x) => x.startsWith("CAT_MATCH:")));
  assert.deepEqual(r.versions, cfg.versions);
});
test("unsafe page: excluded with no score — even when relevance would be perfect", () => {
  const a = article({ headline: "5 killed as recipe show stage collapses", paras: FOOD, ai: foodAI });
  assert.equal(a.safety.verdict, "excluded");
  const r = rec(a, foodCampaign());
  assert.equal(r.status, "excluded"); assert.equal(r.score, null);
  assert.ok(r.reasons[0].startsWith("SAFETY_HEADLINE:"));
});
test("AI saying 'safe' cannot clear a mandatory lexicon exclusion", () => {
  const a = article({ headline: "Breakfast recipe", paras: ["Police said the man was murdered and two others were kidnapped near the market.", ...FOOD], ai: foodAI });
  assert.equal(a.safety.verdict, "excluded");
  assert.ok(a.safety.reasons.some((r) => r.startsWith("SAFETY_TERMS:")));
});
test("AI-only unsafe flag (term check silent) is a conflict → review; never recommended", () => {
  // from the first live run: the AI labelled a prostate-cancer explainer as 'Death, Injury, or Military Conflict'
  const a = article({ headline: "Kitchen story", paras: ["The chef's brother was found in the river after the incident last week.", ...FOOD],
    ai: aiOk({ ...foodAI, sensitive: [{ iab: "I4GWl6", quote: "was found in the river after the incident" }] }) });
  assert.equal(a.safety.state, "conflict"); assert.equal(a.safety.verdict, cfg.safety.onConflict);
  assert.ok(a.safety.reasons.includes("SAFETY_CONFLICT_AI_ONLY"));
  assert.equal(rec(a, foodCampaign()).status, "needs_review");
  assert.equal(pageSafety(a, a.features, { ...cfg.safety, aiOnlyUnsafe: "exclude" }).verdict, "excluded");
});
test("AI unsafe flag plus a term-check flag → both agree → excluded", () => {
  const a = article({ headline: "Kitchen story", paras: ["Her grandmother, who died in 1990, taught her this recipe.", ...FOOD],
    ai: aiOk({ ...foodAI, sensitive: [{ iab: "I4GWl6", quote: "Her grandmother, who died in 1990" }] }) });
  assert.equal(a.safety.verdict, "excluded");
});
test("conflicting signals (one body term, AI says safe) → needs_review, never recommended", () => {
  const a = article({ headline: "Recipe of the week", paras: ["Her grandmother, who died in 1990, taught her this recipe.", ...FOOD], ai: foodAI });
  assert.equal(a.safety.state, "conflict"); assert.equal(a.safety.verdict, "needs_review");
  const r = rec(a, foodCampaign());
  assert.equal(r.status, "needs_review"); assert.ok(r.score >= cfg.scoring.minScoreToRecommend, "high score still waits for review");
});
test("unknown safety (AI unavailable or errored) follows the review policy", () => {
  for (const status of ["unavailable", "error"]) {
    const a = article({ headline: "Oats adai recipe", paras: FOOD, ai: { ...aiOk(), status } });
    assert.equal(a.safety.state, "unknown"); assert.equal(a.safety.verdict, cfg.safety.onUnknown);
    assert.equal(rec(a, foodCampaign()).status, "needs_review");
  }
});
test("review policy is configurable: onUnknown = excluded", () => {
  const a = article({ headline: "Oats adai recipe", paras: FOOD, ai: { ...aiOk(), status: "unavailable" } });
  assert.equal(pageSafety(a, a.features, { ...cfg.safety, onUnknown: "excluded" }).verdict, "excluded");
});
test("too little text to judge → unknown → review", () => {
  const a = article({ headline: "Short", paras: ["Just a caption."], ai: foodAI });
  assert.ok(a.safety.reasons.includes("CONTENT_INSUFFICIENT")); assert.equal(a.safety.verdict, "needs_review");
});
test("a short page with an unsafe headline is still excluded (not just 'unknown')", () => {
  const a = article({ headline: "3 killed in road accident", paras: ["Caption only."], ai: aiOk() });
  assert.equal(a.safety.verdict, "excluded");
});
test("safety false positives: beauty and food idioms are not flagged", () => {
  const a = article({ headline: "This killer lipstick shade is a flavour explosion", paras: ["A shot of colour for dead-simple glam: the shade war is over and this one wins.", FILLER, FILLER], ai: aiOk() });
  assert.equal(a.safety.verdict, "safe");
});
test("a crime section in the URL excludes the page", () => {
  const a = article({ url: "https://www.news18.com/crime/story-1.html", headline: "Recipe", paras: FOOD, ai: foodAI });
  assert.ok(a.safety.reasons.includes("SAFETY_SECTION:380"));
});

// ---------- false positives & irrelevant content ----------
test("'Apple' in a fruit recipe does not match a smartphone campaign", () => {
  const a = article({ headline: "Apple crumble recipe", paras: ["Slice the apple, add cinnamon and bake the crumble until golden. This dessert recipe is a delicious snack.", FILLER], ai: aiOk({ categories: [{ iab: "217", quote: "This dessert recipe is a delicious snack" }] }) });
  const phone = campaign({ brand: "Apple", targeting: { iab: ["635"], keywords: ["apple", "iphone"] } });
  const r = rec(a, phone);
  assert.equal(r.status, "excluded"); assert.equal(r.reasons[0], "NO_CATEGORY_MATCH");
});
test("'Puma' the animal does not match a shoe campaign", () => {
  const a = article({ url: "https://indianexpress.com/article/science/puma-1/", publisherId: "indianexpress-health", headline: "A puma was spotted in the national park", paras: ["Rangers tracked the puma across the valley for three days. " + FILLER, FILLER], ai: aiOk() });
  const r = rec(a, campaign({ brand: "Puma", targeting: { iab: ["573", "589"], keywords: ["puma", "sneakers"] } }));
  assert.equal(r.status, "excluded"); assert.equal(r.reasons[0], "NO_CATEGORY_MATCH");
});
test("a keyword that appears only in navigation never counts", () => {
  const a = article({ headline: "Oats adai recipe", paras: FOOD, ai: foodAI, nav: "Garam masala deals" });
  const r = rec(a, foodCampaign({ targeting: { iab: ["210"], keywords: ["garam masala"] } }));
  assert.ok(!r.reasons.some((x) => x.startsWith("KW_HIT:garam masala")));
});
test("irrelevant content (cricket score) vs a masala creative → excluded", () => {
  const a = article({ url: "https://www.news18.com/cricket/score-1.html", headline: "India beat Australia by 5 wickets", paras: ["India chased 250 in the final over of the ODI; the innings turned on a late wicket. " + FILLER, FILLER], ai: aiOk({ categories: [{ iab: "491", quote: "India chased 250 in the final over of the ODI" }] }) });
  const r = rec(a, foodCampaign());
  assert.equal(r.status, "excluded"); assert.equal(r.reasons[0], "NO_CATEGORY_MATCH");
});
test("category match alone with no keywords and stale date stays below the threshold", () => {
  const a = article({ headline: "Food notes", paras: ["Food notes from the weekend with several dishes and a dinner.", FILLER, FILLER], date: "2025-01-01T00:00:00Z", ai: aiOk() });
  const r = rec(a, campaign({ targeting: { iab: ["210"], keywords: ["millets"] } }));
  assert.equal(r.status, "excluded"); assert.equal(r.reasons[0], "BELOW_THRESHOLD");
});

// ---------- campaign gates ----------
test("expired, not-started, paused and draft campaigns are excluded", () => {
  const a = article({ headline: "Oats adai recipe", paras: FOOD, ai: foodAI });
  assert.equal(rec(a, foodCampaign({ end: "2026-10-25" })).reasons[0], "CAMPAIGN_EXPIRED");
  assert.equal(rec(a, foodCampaign({ start: "2026-10-27" })).reasons[0], "CAMPAIGN_NOT_STARTED");
  assert.equal(rec(a, foodCampaign({ status: "paused" })).reasons[0], "CAMPAIGN_PAUSED");
  assert.equal(rec(a, foodCampaign({ status: "draft" })).reasons[0], "CAMPAIGN_DRAFT");
  assert.equal(rec(a, foodCampaign({ start: "" })).reasons[0], "CAMPAIGN_DATES_MISSING");
});
test("campaign dates are IST calendar days, inclusive", () => {
  const c = campaign({ start: "2026-10-26", end: "2026-10-26" });
  assert.equal(campaignGate(c, new Date("2026-10-25T18:29:00Z")).reason, "CAMPAIGN_NOT_STARTED");   // 23:59 IST on the 25th
  assert.equal(campaignGate(c, new Date("2026-10-25T18:31:00Z")).pass, true);                         // 00:01 IST on the 26th
  assert.equal(campaignGate(c, new Date("2026-10-26T18:29:00Z")).pass, true);                         // 23:59 IST on the 26th
  assert.equal(campaignGate(c, new Date("2026-10-26T18:31:00Z")).reason, "CAMPAIGN_EXPIRED");
  assert.equal(todayIST(new Date("2026-10-25T18:31:00Z")), "2026-10-26");
});
test("campaign validation: missing data is refused, not guessed", () => {
  const { problems } = normaliseCampaign({ brand: "", status: "live", start: "2026-02-30", end: "x", creatives: [{ format: "hologram", file: "../../secret.mp4" }], targeting: { iab: ["NOPE"] } }, cfg);
  for (const p of ["brand is required", "status must be", "start date", "end date", 'unknown format "hologram"', "file must be a name inside", "unknown IAB id NOPE"]) assert.ok(problems.some((x) => x.includes(p)), p);
  assert.ok(normaliseCampaign({ brand: "B", status: "active", start: "2026-11-01", end: "2026-10-01", creatives: [{ format: "in-image" }], targeting: { iab: ["210"] } }, cfg).problems.includes("start date is after the end date"));
});
test("campaign exclusions: competitor mention, excluded keyword, excluded category", () => {
  const a = article({ headline: "Oats adai recipe with MDH garam masala", paras: FOOD, ai: foodAI });
  assert.equal(rec(a, foodCampaign({ exclusions: { competitors: ["MDH"] } })).reasons[0], "COMPETITOR_MENTION:MDH");
  assert.equal(rec(a, foodCampaign({ exclusions: { keywords: ["paneer"] } })).reasons[0], "EXCLUDED_KEYWORD:paneer");
  assert.ok(rec(a, foodCampaign({ exclusions: { iab: ["216"] } })).reasons[0].startsWith("EXCLUDED_CATEGORY:216"));
});

// ---------- format gates ----------
test("incompatible formats are excluded", () => {
  const a = article({ headline: "Oats adai recipe", paras: FOOD, ai: foodAI });
  const c = foodCampaign();
  assert.equal(rec(a, c, { id: "x", format: "ctv" }).reasons[0], "FORMAT_NOT_OPEN_WEB:ctv");
  assert.equal(rec(a, c, { id: "x", format: "in-scroll" }).reasons[0], "FORMAT_NOT_SOLD_ON_PUBLISHER:in-scroll");
  assert.equal(rec(a, c, { id: "x", format: "rich-media" }, { ...pub(), formats: { ...pub().formats, "rich-media": "test source" } }).reasons[0], "FORMAT_SPEC_MISSING");
  const noImg = article({ headline: "Oats adai recipe", paras: FOOD, ai: foodAI, image: null });
  assert.equal(rec(noImg, c).reasons[0], "FORMAT_NO_LEAD_IMAGE");
  const scrollPub = { ...pub(), formats: { ...pub().formats, "in-scroll": "test source" } };
  const twoParas = article({ headline: "Oats adai recipe", paras: [FOOD[0], FOOD[1] + " " + FILLER + " " + FILLER], ai: foodAI });
  assert.equal(rec(twoParas, c, { id: "x", format: "in-scroll" }, scrollPub).reasons[0], "FORMAT_TOO_FEW_PARAGRAPHS");
  assert.equal(rec(a, c, { id: "x", format: "in-scroll" }, scrollPub).status, "recommended");
  assert.equal(rec(a, c, { id: "x", format: "in-image" }, null).reasons[0], "FORMAT_NOT_SOLD_ON_PUBLISHER:in-image");   // publisher not in config
});

// ---------- missing data ----------
test("a page that could not be fetched is excluded with the fetch reason", () => {
  const a = { id: "0123456789abcdef", url: "https://x.test", publisherId: "news18-food", error: { code: "BLOCKED", message: "403" } };
  const r = rec(a, foodCampaign());
  assert.equal(r.status, "excluded"); assert.equal(r.reasons[0], "FETCH_FAILED:BLOCKED");
});

// ---------- review ----------
test("review: approval needs the same content and policy version; rejection excludes", () => {
  const a = article({ headline: "Recipe of the week", paras: ["Her grandmother, who died in 1990, taught her this recipe.", ...FOOD], ai: foodAI });
  const ok = { decision: "approve", contentHash: a.contentHash, safetyVersion: cfg.versions.safety, by: "QA", why: "historical mention" };
  assert.equal(rec(a, foodCampaign(), undefined, undefined, NOW, ok).status, "approved");
  assert.equal(rec(a, foodCampaign(), undefined, undefined, NOW, { ...ok, contentHash: "changed" }).status, "needs_review");
  assert.equal(rec(a, foodCampaign(), undefined, undefined, NOW, { ...ok, safetyVersion: "safety.v0" }).status, "needs_review");
  assert.equal(rec(a, foodCampaign(), undefined, undefined, NOW, { ...ok, decision: "reject" }).status, "excluded");
});
test("an approval can never apply to an excluded page", () => {
  const a = article({ headline: "5 killed as recipe show stage collapses", paras: FOOD, ai: foodAI });
  const r = rec(a, foodCampaign(), undefined, undefined, NOW, { decision: "approve", contentHash: a.contentHash, safetyVersion: cfg.versions.safety });
  assert.equal(r.status, "excluded");
});

// ---------- determinism ----------
test("same inputs and config → identical output", () => {
  const a = article({ headline: "Oats adai recipe for a healthy breakfast", paras: FOOD, ai: foodAI });
  assert.deepEqual(rec(a, foodCampaign()), rec(structuredClone(a), foodCampaign()));
});
test("the AI never supplies the score: score parts come from features × config weights", () => {
  const r = rec(article({ headline: "Oats adai recipe for a healthy breakfast", paras: FOOD, ai: foodAI }), foodCampaign());
  const W = cfg.scoring.weights;
  assert.equal(r.parts.category, W.category * 1);
  assert.equal(r.score, Math.round(Object.values(r.parts).reduce((x, y) => x + y, 0)));
});
