// Three creative directions per campaign (Creative Intelligence Engine, phase 1). One AI text call returns:
//   A — premium cinematic / photographic, B — experimental graphic design / kinetic typography,
//   C — conceptual / surreal storytelling.
// Each has an idea, 3–5 storyboard beats, art direction, a stock-photo query for a REAL photographic element (Unsplash /
// Pexels, free licence), one line of copy (no claims, no numbers) and why it fits. validateConcepts() is deterministic.
export const CONCEPTS_VERSION = "concepts.v1";
export const DIRECTION_KINDS = { A: "premium cinematic / photographic", B: "experimental graphic design / kinetic typography", C: "conceptual / surreal storytelling" };
// words that make a line a claim, an offer or cheap hype
export const BANNED = ["best", "no.1", "number one", "#1", "guaranteed", "guarantee", "cure", "cures", "clinically", "proven", "doctor", "100%", "free", "offer", "discount", "sale", "cheapest", "lowest", "fastest", "healthiest", "miracle", "instant", "only", "world's", "india's", "certified", "pure", "purest", "natural", "naturally", "healthy", "safe", "sparkle", "sparkles", "particles", "confetti"];

const direction = { type: "object", properties: {
  key: { type: "string", enum: ["A", "B", "C"] }, name: { type: "string" }, idea: { type: "string" },
  beats: { type: "array", items: { type: "string" } },
  art: { type: "object", properties: { palette: { type: "array", items: { type: "string" } }, type: { type: "string" }, lighting: { type: "string" }, texture: { type: "string" } }, required: ["palette", "type", "lighting", "texture"] },
  photo_query: { type: "string" }, copy: { type: "string" }, kicker: { type: "string" }, why: { type: "string" }, strength: { type: "integer" },
}, required: ["key", "name", "idea", "beats", "art", "photo_query", "copy", "why", "strength"] };
export const CONCEPTS_SCHEMA = { type: "object", properties: { directions: { type: "array", items: direction } }, required: ["directions"] };

export function conceptsPrompt({ brand, product, guideline, article }) {
  const g = guideline || {};
  const pick = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);
  return `Brand: ${brand}. Product: ${product}.
Brand guideline (sources marked; use as the rules): visual identity: ${pick(g.visual_identity) || "-"}; ad look: ${pick(g.ad_look) || "-"}; colours: ${(g.colour_system || []).map((c) => `${c.hex} ${c.role}`).join(", ") || "-"}; type: ${pick(g.typography?.display) || "-"} / ${pick(g.typography?.text) || "-"}; motion: ${pick(g.motion_language) || "-"}; tone: ${pick(g.campaign_tone) || "-"}; signature visuals: ${(pick(g.signature_visuals) || []).join("; ") || "-"}; don't: ${(pick(g.dont) || []).join("; ")}.
Article the ad sits on: "${article?.headline || ""}" — picture: ${article?.imageAlt || "-"}.

Write THREE genuinely different directions for an in-image ad (a ~6 s scene over the article picture, then the brand strip; plays muted):
A = ${DIRECTION_KINDS.A}; B = ${DIRECTION_KINDS.B}; C = ${DIRECTION_KINDS.C}.
For each: name (2–4 words); idea (one sentence); beats (3–5 storyboard beats, each one short sentence); art (palette of 2–4 #rrggbb, type direction naming a Google Font, lighting, texture); photo_query (3–6 words to find ONE real free stock photograph on Unsplash/Pexels — a place, texture or moment, never the product, logo, a celebrity or text); kicker (optional, 1–3 words); copy (at most 6 words: no claims, numbers, prices, superlatives, health or medical promises); why (how it ties product, brand and article); strength (1–10, how well it would work on this article).
Never use drawn particles, sparkles, orbits or cartoon splashes — premium means real photography, composition, typography and restrained motion.`;
}

const words = (s) => String(s || "").toLowerCase().match(/[a-z0-9']+/g) || [];
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i || 1); };
const STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "with", "for", "its", "is", "as", "at", "by", "from", "into", "that", "this", "it"]);
const content = (s) => words(s).filter((w) => !STOP.has(w));

/** Banned word, claim or number in a line of copy (null when clean). */
export function copyProblem(line) {
  const t = String(line || "").toLowerCase();
  if (!t.trim()) return "empty";
  if (/\d/.test(t)) return "has a number";
  if (/[₹$%]/.test(t)) return "has a price or percentage";
  for (const b of BANNED) { const re = new RegExp(`(^|[^a-z0-9])${b.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")}([^a-z0-9]|$)`); if (re.test(t)) return `banned word "${b}"`; }
  if (words(t).length > 6) return "longer than 6 words";
  return null;
}

/**
 * Deterministic check of the three directions: A, B and C present once each; 3–5 beats; a photo query; clean copy;
 * hex palettes; and the three genuinely different (ideas, beats and photo queries do not overlap much).
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function validateConcepts(set) {
  const p = [], ds = set?.directions || [];
  const keys = ds.map((d) => d.key).sort().join("");
  if (keys !== "ABC") p.push(`directions must be A, B and C once each (got ${keys || "none"})`);
  for (const d of ds) {
    const k = d.key || "?";
    if (!String(d.idea || "").trim()) p.push(`${k}: no idea`);
    const n = (d.beats || []).length; if (n < 3 || n > 5) p.push(`${k}: ${n} beats (3–5 needed)`);
    if (words(d.photo_query).length < 2) p.push(`${k}: no stock-photo query`);
    if (/logo|celebrity|\btext\b|illustration|vector|clipart|render/i.test(d.photo_query || "")) p.push(`${k}: the photo query must find a real photograph`);
    const c = copyProblem(d.copy); if (c) p.push(`${k}: copy ${c}`);
    if (d.kicker) { const kp = copyProblem(d.kicker); if (kp && kp !== "longer than 6 words") p.push(`${k}: kicker ${kp}`); }
    const pal = d.art?.palette || []; if (!pal.length || pal.some((h) => !/^#[0-9a-f]{6}$/i.test(h))) p.push(`${k}: palette must be #rrggbb colours`);
    for (const b of BANNED.filter((x) => ["sparkle", "sparkles", "particles", "confetti"].includes(x))) if ([d.idea, ...(d.beats || [])].join(" ").toLowerCase().includes(b)) p.push(`${k}: uses ${b}`);
    if (!String(d.why || "").trim()) p.push(`${k}: no why`);
  }
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
    const a = ds[i], b = ds[j];
    const sim = jaccard(content([a.idea, ...(a.beats || [])].join(" ")), content([b.idea, ...(b.beats || [])].join(" ")));
    if (sim > 0.45) p.push(`${a.key} and ${b.key} are too alike (${sim.toFixed(2)})`);
    if (jaccard(content(a.photo_query), content(b.photo_query)) > 0.6) p.push(`${a.key} and ${b.key} search the same photo`);
    if (String(a.copy).trim().toLowerCase() === String(b.copy).trim().toLowerCase()) p.push(`${a.key} and ${b.key} share the same copy`);
  }
  return { ok: !p.length, problems: p };
}

/** The direction to make: the highest strength among the ones that pass on their own (ties → A, the photographic one). */
export function strongest(set) {
  const all = set?.directions || [], problems = validateConcepts(set).problems;
  const clean = all.filter((d) => !problems.some((x) => x.startsWith(d.key + ":")));
  return [...(clean.length ? clean : all)].sort((a, b) => (b.strength || 0) - (a.strength || 0) || String(a.key).localeCompare(String(b.key)))[0] || null;
}

/**
 * One AI call → three directions, checked. Returns the set with its validation.
 * @param {{ ask: Function, brand: string, product: string, guideline: any, article: { headline?: string, imageAlt?: string } }} o
 */
export async function makeConcepts({ ask, brand, product, guideline, article }) {
  const r = await ask("You are the executive creative director of a premium ad studio. You never invent product claims.", conceptsPrompt({ brand, product, guideline, article }), CONCEPTS_SCHEMA, [], "high");
  const set = { version: CONCEPTS_VERSION, brand, product, article, directions: (r?.directions || []).slice(0, 3) };
  return { ...set, validation: validateConcepts(set) };
}
