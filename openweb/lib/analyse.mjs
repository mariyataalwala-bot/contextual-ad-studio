// Article analysis → features with evidence. Two layers:
//  1. deterministic: URL / publisher sections, category lexicon and safety lexicon (always runs)
//  2. AI (optional, via the app's ask()): categories, sensitive topics, entities and lead-image objects.
//     The AI never scores anything, and every AI text claim must carry a quote that appears word for word in
//     the article — anything else is dropped and counted. Image objects are labelled as model observations.
import { norm, termHits, quoteFound } from "./text.mjs";

export const PROMPT_VERSION = "analyse.v1";

export function lexicalFeatures(article, cfg) {
  const T = cfg.taxonomy, minTerms = cfg.scoring.lexiconCategoryMinTerms;
  const categories = [];
  const secIds = new Map();
  for (const s of article.sections || []) for (const id of cfg.lexicon.sections[s] || []) if (!secIds.has(id)) secIds.set(id, s);
  for (const [iab, s] of secIds) categories.push({ iab, source: "section", evidence: [{ kind: "section", value: s, url: article.url }] });
  const text = `${article.headline}\n${article.body}`;
  for (const [iab, terms] of Object.entries(cfg.lexicon.terms)) {
    const hits = termHits(text, terms);
    if (hits.length >= minTerms) categories.push({ iab, source: "lexicon", evidence: hits.slice(0, 4).map((h) => ({ kind: "term", term: h.term, count: h.count, quote: h.quote })) });
  }
  const sensitive = [];
  for (const c of cfg.safety.categories) {
    for (const [field, t] of [["headline", article.headline], ["body", article.body]]) {
      for (const h of termHits(t, c.terms)) sensitive.push({ iab: c.iab, action: c.action, field, term: h.term, count: h.count, quote: h.quote });
    }
  }
  for (const [iab, s] of secIds) { const c = cfg.safety.categories.find((x) => T.within(iab, x.iab)); if (c) sensitive.push({ iab: c.iab, action: c.action, field: "section", term: s, count: 1, quote: s }); }
  return { categories, sensitive };
}

const SENSITIVE_HELP = (cfg) => cfg.safety.categories.map((c) => `${c.iab} = ${cfg.taxonomy.path(c.iab)}`).join("\n");
const CATEGORY_HELP = (cfg) => cfg.taxonomy.all().map((n) => `${n.id} = ${cfg.taxonomy.path(n.id)}`).join("\n");

const TEXT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["categories", "sensitive", "sentiment", "entities"],
  properties: {
    categories: { type: "array", items: { type: "object", additionalProperties: false, required: ["iab", "quote"], properties: { iab: { type: "string" }, quote: { type: "string" } } } },
    sensitive: { type: "array", items: { type: "object", additionalProperties: false, required: ["iab", "quote"], properties: { iab: { type: "string" }, quote: { type: "string" } } } },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    entities: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "type", "quote"], properties: { name: { type: "string" }, type: { type: "string", enum: ["brand", "product", "person", "organisation", "place"] }, quote: { type: "string" } } } },
  },
};
const IMAGE_SCHEMA = { type: "object", additionalProperties: false, required: ["objects"], properties: { objects: { type: "array", items: { type: "string" } } } };

// ask(system, text, schema, images, effort) is the app's provider-agnostic call; it throws when no AI is set up.
export async function aiFeatures(article, cfg, ask, { imageFile = null } = {}) {
  const text = `${article.headline}\n${article.body}`;
  const out = { status: "unavailable", promptVersion: PROMPT_VERSION, categories: [], sensitive: [], entities: [], sentiment: null, objects: [], dropped: [], message: "" };
  if (!ask) { out.message = "No AI provider configured"; return out; }
  try {
    const r = await ask(
      "You classify news and blog articles for contextual advertising. You only report what the article itself says. Every quote you give must be copied exactly, character for character, from the article text.",
      `ARTICLE HEADLINE: ${article.headline}\n\nARTICLE BODY:\n${norm(article.body).slice(0, 14000)}\n\n` +
      `Tasks:\n1. categories: up to 3 IAB Content Taxonomy 3.1 ids that describe what the article is mainly about (most specific that fits), each with a short exact quote (5–25 words) from the article that shows it. Ids:\n${CATEGORY_HELP(cfg)}\n` +
      `2. sensitive: every sensitive topic the article is actually about (not a passing word), each with an exact quote. Use only these ids; return [] if none apply:\n${SENSITIVE_HELP(cfg)}\n` +
      `3. sentiment of the article overall.\n4. entities: up to 8 brands, products, people, organisations or places named in the article, each with an exact quote.`,
      TEXT_SCHEMA, [], "medium");
    const known = new Set(cfg.safety.categories.map((c) => c.iab));
    for (const c of r.categories || []) {
      if (!cfg.taxonomy.has(c.iab)) out.dropped.push({ kind: "category", iab: c.iab, why: "not an IAB 3.1 id" });
      else if (!quoteFound(text, c.quote)) out.dropped.push({ kind: "category", iab: c.iab, why: "quote not found in the article", quote: c.quote });
      else out.categories.push({ iab: c.iab, quote: norm(c.quote) });
    }
    for (const s of r.sensitive || []) {
      if (!known.has(s.iab)) out.dropped.push({ kind: "sensitive", iab: s.iab, why: "not a policy category" });
      else if (!quoteFound(text, s.quote)) out.dropped.push({ kind: "sensitive", iab: s.iab, why: "quote not found in the article", quote: s.quote });
      else out.sensitive.push({ iab: s.iab, quote: norm(s.quote) });
    }
    for (const e of r.entities || []) {
      if (quoteFound(text, e.quote) && quoteFound(text, e.name)) out.entities.push({ name: norm(e.name), type: e.type, quote: norm(e.quote) });
      else out.dropped.push({ kind: "entity", name: e.name, why: "name or quote not found in the article" });
    }
    out.sentiment = r.sentiment || null;
    out.status = "ok";
  } catch (e) { out.status = /No AI key|manual mode/i.test(e.message) ? "unavailable" : "error"; out.message = String(e.message).slice(0, 200); return out; }
  if (imageFile) {
    try {
      const r = await ask("You list what is visible in a photo, plainly.", "List the main physical objects or products clearly visible in this photo (at most 8), as short plain nouns (e.g. 'face mask', 'bowl of rice', 'smartphone'). No guesses about brands.", IMAGE_SCHEMA, [{ label: "article lead image", file: imageFile }], "medium");
      out.objects = (r.objects || []).map((o) => norm(o).toLowerCase()).filter(Boolean).slice(0, 8);
      out.objectsSource = "model observation of the lead image (not text-verifiable)";
    } catch (e) { out.imageMessage = String(e.message).slice(0, 160); }
  }
  return out;
}
