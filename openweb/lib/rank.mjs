// Gates and ranking: (article × campaign creative) → recommendation with status, score, reason codes and evidence.
// Order is fixed and deterministic:
//   G1 content fetched → G2 page safety → G3 campaign live → G4 campaign exclusions → G5 format fits the page
//   → relevance (category OR, for campaigns with a brief, a strong meaning match required; then score threshold) → status.
// A negative-tone article (AI sentiment) is never recommended straight away: it goes to review like an uncertain page.
// Any failed gate means "excluded" and no score is computed, so relevance can never outweigh a safety exclusion.
// A page whose safety needs review stays "needs_review" whatever its score; only a person can approve it, and
// approvals never apply to excluded pages.
import { termHits, findTerm } from "./text.mjs";
import { campaignGate } from "./campaigns.mjs";

export const recKey = (articleId, campaignId, creativeId) => `${articleId}|${campaignId}|${creativeId}`;

function categoryMatch(features, campaign, cfg) {
  const T = cfg.taxonomy, S = cfg.scoring.category;
  const cats = [...features.lexical.categories, ...(features.ai?.status === "ok" ? features.ai.categories.map((c) => ({ iab: c.iab, source: "ai", evidence: [{ kind: "ai_quote", quote: c.quote, verified: true }] })) : [])];
  let best = { value: 0 };
  for (const c of cats) for (const t of campaign.targeting.iab) {
    const m = T.within(c.iab, t) ? S.exactOrNarrower : T.within(t, c.iab) ? S.broader : 0;
    const v = +(m * (S.sourceStrength[c.source] ?? 0)).toFixed(3);
    if (v > best.value) best = { value: v, article: c.iab, target: t, source: c.source, evidence: c.evidence };
  }
  return best;
}

function formatGate(article, creative, publisher, cfg) {
  const f = cfg.formats.formats[creative.format];
  if (!f) return { pass: false, reason: "FORMAT_UNKNOWN" };
  if (!f.openWeb) return { pass: false, reason: `FORMAT_NOT_OPEN_WEB:${creative.format}` };
  if (!publisher?.formats?.[creative.format]) return { pass: false, reason: `FORMAT_NOT_SOLD_ON_PUBLISHER:${creative.format}` };
  if (f.needs.slotSpec) return { pass: false, reason: "FORMAT_SPEC_MISSING" };
  if (f.needs.leadImage && !article.image?.url) return { pass: false, reason: "FORMAT_NO_LEAD_IMAGE" };
  if (f.needs.minParagraphs && (article.paragraphs || 0) < f.needs.minParagraphs) return { pass: false, reason: "FORMAT_TOO_FEW_PARAGRAPHS", detail: `${article.paragraphs} < ${f.needs.minParagraphs}` };
  return { pass: true, reason: `FORMAT_OK:${creative.format}`, source: publisher.formats[creative.format] };
}

/** @returns {Record<string, any>} a recommendation record */
export function recommend({ article, campaign, creative, publisher, cfg, now = new Date(), review = null, sim = null }) {
  const base = { key: recKey(article.id, campaign.id, creative.id), articleId: article.id, campaignId: campaign.id, creativeId: creative.id, brand: campaign.brand, creativeLabel: creative.label || creative.id, format: creative.format,
    versions: cfg.versions, contentHash: article.contentHash || null, gates: [] };
  const excluded = (reason, detail) => ({ ...base, status: "excluded", score: null, reasons: [reason, ...base.gates.filter((g) => !g.pass).map((g) => g.reason).filter((r) => r !== reason)], detail: detail || null, evidence: [] });

  if (article.error) { base.gates.push({ gate: "content", pass: false, reason: `FETCH_FAILED:${article.error.code}` }); return excluded(`FETCH_FAILED:${article.error.code}`, article.error.message); }
  base.gates.push({ gate: "content", pass: true, reason: "CONTENT_OK" });

  const safety = article.safety;
  if (!safety) return excluded("SAFETY_NOT_ASSESSED");
  base.gates.push({ gate: "safety", pass: safety.verdict !== "excluded", reason: safety.verdict === "excluded" ? safety.reasons.find((r) => r !== "SAFETY_CLEAR") || "SAFETY_EXCLUDED" : `SAFETY_${safety.state.toUpperCase()}` });
  if (safety.verdict === "excluded") return { ...excluded(base.gates.at(-1).reason), safetyReasons: safety.reasons, evidence: safety.evidence };

  const cg = campaignGate(campaign, now);
  base.gates.push({ gate: "campaign", ...cg });
  if (!cg.pass) return excluded(cg.reason, cg.detail);

  const text = `${article.headline}\n${article.body}`;
  const comp = termHits(text, campaign.exclusions.competitors);
  if (comp.length) { base.gates.push({ gate: "exclusions", pass: false, reason: `COMPETITOR_MENTION:${comp[0].term}` }); return { ...excluded(`COMPETITOR_MENTION:${comp[0].term}`), evidence: comp.map((h) => ({ kind: "term", term: h.term, quote: h.quote })) }; }
  const exk = termHits(text, campaign.exclusions.keywords);
  if (exk.length) { base.gates.push({ gate: "exclusions", pass: false, reason: `EXCLUDED_KEYWORD:${exk[0].term}` }); return { ...excluded(`EXCLUDED_KEYWORD:${exk[0].term}`), evidence: exk.map((h) => ({ kind: "term", term: h.term, quote: h.quote })) }; }
  const allCats = [...article.features.lexical.categories.map((c) => c.iab), ...(article.features.ai?.status === "ok" ? article.features.ai.categories.map((c) => c.iab) : [])];
  const exCat = allCats.find((a) => campaign.exclusions.iab.some((x) => cfg.taxonomy.within(a, x)));
  if (exCat) { base.gates.push({ gate: "exclusions", pass: false, reason: `EXCLUDED_CATEGORY:${exCat}` }); return excluded(`EXCLUDED_CATEGORY:${exCat}`); }
  base.gates.push({ gate: "exclusions", pass: true, reason: "EXCLUSIONS_CLEAR" });

  const fg = formatGate(article, creative, publisher, cfg);
  base.gates.push({ gate: "format", ...fg });
  if (!fg.pass) return excluded(fg.reason, fg.detail);

  // relevance — computed only for pages that passed every gate
  const evidence = [], reasons = [], SM = cfg.scoring.semantic, brief = !!(campaign.brief && SM && cfg.scoring.semanticWeights);
  // weights: v1 weights without a brief; with a brief, meaning carries the weight of any signal the campaign doesn't use
  const W = brief ? { ...cfg.scoring.semanticWeights } : { ...cfg.scoring.weights };
  if (brief) {
    const move = (k) => { W.semantic += W[k]; W[k] = 0; };
    if (!campaign.targeting.iab.length) move("category");
    if (!campaign.targeting.keywords.length) { move("keywords"); move("headline"); }
    if (!campaign.targeting.objects.length) move("object");
  }
  const cat = categoryMatch(article.features, campaign, cfg);
  const catOk = cat.value >= cfg.scoring.category.required, meaningOk = brief && sim != null && sim >= SM.minAlone;
  if (!catOk && !meaningOk) {
    if (!brief) return excluded("NO_CATEGORY_MATCH", `best category signal ${cat.value} < ${cfg.scoring.category.required}`);
    if (sim == null) return excluded("MEANING_PENDING", "the article or the campaign brief has no meaning vector yet — run Recompute");
    return excluded("NO_CATEGORY_OR_MEANING_MATCH", `category ${cat.value} < ${cfg.scoring.category.required} and meaning ${sim} < ${SM.minAlone}`);
  }
  if (catOk) {
    reasons.push(`CAT_MATCH:${cat.article}→${cat.target}:${cat.source}`);
    evidence.push(...cat.evidence.map((e) => ({ ...e, about: `category ${cfg.taxonomy.path(cat.article)}` })));
  }
  const sem = brief && sim != null ? Math.max(0, Math.min(1, (sim - SM.floor) / (SM.full - SM.floor))) : 0;
  if (brief && sim != null) {
    reasons.push(`MEANING:${sim}`);
    evidence.push({ kind: "semantic", value: `Meaning match ${sim} with the campaign brief (${SM.floor} = unrelated, ${SM.full}+ = very close)`, about: `embedding similarity, ${SM.model}` });
  }

  const kw = termHits(text, campaign.targeting.keywords);
  for (const h of kw) { reasons.push(`KW_HIT:${h.term}×${h.count}`); evidence.push({ kind: "term", term: h.term, count: h.count, quote: h.quote, about: "campaign keyword" }); }
  const inHeadline = campaign.targeting.keywords.filter((k) => findTerm(article.headline, k).length);
  if (inHeadline.length) reasons.push(`KW_HEADLINE:${inHeadline[0]}`);
  const objs = (article.features.ai?.objects || []).filter((o) => campaign.targeting.objects.some((t) => findTerm(o, t).length || findTerm(t, o).length));
  if (objs.length) { reasons.push(`OBJECT:${objs[0]}`); evidence.push({ kind: "image_observation", value: objs.join(", "), about: "lead image (model observation, not text-verifiable)" }); }
  const ageDays = article.published ? (now.getTime() - new Date(article.published).getTime()) / 864e5 : null;
  const fresh = ageDays == null ? 0 : ageDays <= cfg.scoring.freshness.fullDays ? 1 : ageDays <= cfg.scoring.freshness.halfDays ? 0.5 : 0;
  if (fresh) reasons.push(`FRESH:${Math.max(0, Math.floor(ageDays))}d`);

  const parts = {
    category: W.category * (catOk ? cat.value : 0),
    keywords: W.keywords * Math.min(1, kw.length / cfg.scoring.keywords.fullAt),
    headline: W.headline * (inHeadline.length ? 1 : 0),
    object: W.object * (objs.length ? 1 : 0),
    freshness: W.freshness * fresh,
    ...(brief ? { semantic: W.semantic * sem } : {}),
  };
  const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
  const scored = { ...base, score, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(2)])), reasons, evidence, safetyReasons: safety.reasons };
  if (score < cfg.scoring.minScoreToRecommend) return { ...scored, status: "excluded", reasons: ["BELOW_THRESHOLD", ...reasons], detail: `${score} < ${cfg.scoring.minScoreToRecommend}` };
  if (!evidence.length || !reasons.length) return excluded("INSUFFICIENT_EVIDENCE");   // never emit a recommendation without both
  const negative = cfg.scoring.negativeSentiment === "needs_review" && article.features.ai?.status === "ok" && article.features.ai.sentiment === "negative";
  if (safety.verdict === "needs_review" || negative) {
    const ok = review && review.decision === "approve" && review.contentHash === article.contentHash && review.safetyVersion === cfg.versions.safety;
    if (review && review.decision === "reject" && review.contentHash === article.contentHash) return { ...scored, status: "excluded", reasons: ["REVIEW_REJECTED", ...reasons], review };
    return { ...scored, status: ok ? "approved" : "needs_review", reasons: [ok ? "REVIEW_APPROVED" : "NEEDS_REVIEW", ...(negative ? ["NEGATIVE_TONE"] : []), ...safety.reasons.filter((r) => r !== "SAFETY_CLEAR"), ...reasons], review: ok ? review : null };
  }
  return { ...scored, status: "recommended" };
}

const ORDER = { recommended: 0, approved: 0, needs_review: 1, excluded: 2 };
export const rankRecs = (recs) => [...recs].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.score ?? -1) - (a.score ?? -1) || a.key.localeCompare(b.key));
