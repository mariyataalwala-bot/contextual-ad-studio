// Page-level brand safety. Deterministic: the same features and policy always give the same verdict.
// verdict: "safe" | "excluded" | "needs_review", with reason codes and the evidence behind each.
//   - a headline hit, a mapped section, or enough distinct body terms in an "exclude" category → excluded
//     (the AI cannot clear these: a mandatory exclusion is never overridden)
//   - a verified AI quote in an "exclude" category → excluded when the term check also flags the page;
//     when only the AI flags it, the two classifiers disagree → policy.aiOnlyUnsafe ("conflict" → policy.onConflict)
//   - fewer body terms with the AI saying safe → conflict → policy.onConflict
//   - AI unavailable / errored, or too little text to judge → unknown → policy.onUnknown
//     (hard exclusions are checked first, so a short page with an unsafe headline is still excluded)
export function pageSafety(article, features, policy) {
  const reasons = [], evidence = [];
  const add = (code, ev) => { if (!reasons.includes(code)) reasons.push(code); if (ev) evidence.push(ev); };
  const lex = features.lexical.sensitive || [], ai = features.ai || { status: "unavailable", sensitive: [] };
  const th = policy.thresholds;

  let hardExclude = false, flagged = false, reviewOnly = false;
  const byCat = new Map();
  for (const h of lex) { if (!byCat.has(h.iab)) byCat.set(h.iab, []); byCat.get(h.iab).push(h); }
  for (const [iab, hits] of byCat) {
    const action = hits[0].action;
    const headline = hits.filter((h) => h.field === "headline"), section = hits.filter((h) => h.field === "section");
    const bodyTerms = new Set(hits.filter((h) => h.field === "body").map((h) => h.term.toLowerCase()));
    if (action === "review") { reviewOnly = true; add(`SAFETY_REVIEW:${iab}`, { kind: "term", iab, quote: hits[0].quote, term: hits[0].term, field: hits[0].field }); continue; }
    if (section.length) { hardExclude = true; add(`SAFETY_SECTION:${iab}`, { kind: "section", iab, value: section[0].term }); }
    if (headline.length >= th.headlineHitsExclude) { hardExclude = true; add(`SAFETY_HEADLINE:${iab}`, { kind: "term", iab, field: "headline", term: headline[0].term, quote: headline[0].quote }); }
    if (bodyTerms.size >= th.bodyDistinctTermsExclude) { hardExclude = true; add(`SAFETY_TERMS:${iab}`, { kind: "term", iab, field: "body", terms: [...bodyTerms], quote: hits.find((h) => h.field === "body").quote }); }
    else if (bodyTerms.size >= th.bodyDistinctTermsFlag && !headline.length && !section.length) { flagged = true; add(`SAFETY_FLAG:${iab}`, { kind: "term", iab, field: "body", term: [...bodyTerms][0], quote: hits.find((h) => h.field === "body").quote }); }
  }

  const actionOf = (iab) => policy.categories.find((c) => c.iab === iab)?.action;
  const aiOk = ai.status === "ok";
  const aiExclude = aiOk ? ai.sensitive.filter((s) => actionOf(s.iab) === "exclude") : [];
  const aiReview = aiOk ? ai.sensitive.filter((s) => actionOf(s.iab) === "review") : [];
  for (const s of aiExclude) add(`SAFETY_AI:${s.iab}`, { kind: "ai_quote", iab: s.iab, quote: s.quote, verified: true });
  for (const s of aiReview) add(`SAFETY_AI_REVIEW:${s.iab}`, { kind: "ai_quote", iab: s.iab, quote: s.quote, verified: true });

  const out = (verdict, state) => ({ verdict, state, reasons, evidence, policy: policy.version, ai: ai.status });
  if (hardExclude || (aiExclude.length && (flagged || policy.aiOnlyUnsafe === "exclude"))) return out("excluded", "unsafe");   // exclusions apply even to short pages
  if (aiExclude.length) { add("SAFETY_CONFLICT_AI_ONLY"); return out(policy.onConflict, "conflict"); }
  if (!article.body || article.body.length < policy.minBodyChars) {
    add("CONTENT_INSUFFICIENT", { kind: "length", value: (article.body || "").length, min: policy.minBodyChars });
    return out(policy.onUnknown, "unknown");
  }
  if (flagged && aiOk) { add("SAFETY_CONFLICT"); return out(policy.onConflict, "conflict"); }
  if (!aiOk && policy.aiRequiredForSafe) { add(ai.status === "error" ? "SAFETY_AI_ERROR" : "SAFETY_AI_UNAVAILABLE"); return out(policy.onUnknown, "unknown"); }
  if (flagged) { add("SAFETY_UNCONFIRMED"); return out(policy.onUnknown, "unknown"); }
  if (reviewOnly || aiReview.length) return out("needs_review", "review");
  add("SAFETY_CLEAR");
  return out("safe", "safe");
}
