// Meaning (semantic) matching: each article and each campaign brief becomes an embedding vector, computed once and
// stored in embeddings.json (keyed by model, task and a hash of the exact text), so re-ranking never re-embeds.
// Similarity is the cosine of the two unit vectors. The model only places texts in "meaning space" — it never sees
// campaign rules, gates or scores.
import { sha256 } from "./text.mjs";

/** @param {Record<string, any>} a @param {Record<string, any>} cfg */
export const articleText = (a, cfg) => `${a.headline || ""}\n${String(a.body || "").slice(0, cfg.scoring.semantic.articleChars)}`.trim();
/** @param {Record<string, any>} c */
export const briefText = (c) => [c.brand, c.product, c.brief].filter(Boolean).join(". ");
const vkey = (cfg, task, text) => `${cfg.scoring.semantic.model}@${cfg.scoring.semantic.dims}|${task}|${sha256(text)}`;
export const articleKey = (a, cfg) => vkey(cfg, "RETRIEVAL_DOCUMENT", articleText(a, cfg));
export const campaignKey = (c, cfg) => vkey(cfg, "RETRIEVAL_QUERY", briefText(c));
/** @param {number[]} v */
const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => +(x / n).toFixed(5)); };
/** @param {number[]} a @param {number[]} b */
export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/**
 * Embeds every campaign brief and article that has no stored vector yet, in small batches (progress is saved after each).
 * @param {{ store: any, cfg: Record<string, any>, embed: ((texts: string[], task: string, dims: number) => Promise<number[][]>) | null | undefined, campaigns?: any[], articles?: any[], batch?: number }} o
 */
export async function ensureVectors({ store, cfg, embed, campaigns = store.getCampaigns(), articles = store.listArticles(), batch = 45 }) {
  const want = [];
  for (const c of campaigns) if (c.brief) want.push({ task: "RETRIEVAL_QUERY", key: campaignKey(c, cfg), text: briefText(c) });
  for (const a of articles) if (!a.error && a.headline) want.push({ task: "RETRIEVAL_DOCUMENT", key: articleKey(a, cfg), text: articleText(a, cfg) });
  const vecs = store.getVectors();
  const todo = [...new Map(want.filter((w) => !vecs[w.key]).map((w) => [w.key, w])).values()];
  if (!todo.length) return { added: 0, missing: 0, error: null };
  if (!embed) return { added: 0, missing: todo.length, error: "no embedding provider" };
  let added = 0, error = null;
  for (const task of ["RETRIEVAL_QUERY", "RETRIEVAL_DOCUMENT"]) {
    const list = todo.filter((t) => t.task === task);
    for (let i = 0; i < list.length && !error; i += batch) {
      const chunk = list.slice(i, i + batch);
      try {
        const out = await embed(chunk.map((x) => x.text), task, cfg.scoring.semantic.dims);
        chunk.forEach((x, k) => { if (Array.isArray(out[k]) && out[k].length) { vecs[x.key] = unit(out[k]); added++; } });
        store.saveVectors(vecs);
      } catch (e) { error = String(/** @type {any} */ (e).message || e).slice(0, 200); }
    }
  }
  return { added, missing: todo.length - added, error };
}

/** Similarity of an article to a campaign's brief, or null when the campaign has no brief or a vector is missing. */
export function similarity(vecs, article, campaign, cfg) {
  if (!campaign.brief || article.error) return null;
  const a = vecs[articleKey(article, cfg)], c = vecs[campaignKey(campaign, cfg)];
  return a && c ? +dot(a, c).toFixed(4) : null;
}
