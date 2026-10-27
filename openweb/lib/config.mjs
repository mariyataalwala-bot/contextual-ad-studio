// Versioned configuration: IAB taxonomy, publishers, formats, safety policy, scoring and category lexicon.
// Every IAB id used anywhere in config must exist in the vendored taxonomy file (checked at load).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./text.mjs";

export const CONFIG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config");
const readJson = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

// IAB Content Taxonomy TSV → Map id → { id, parent, name }
export function parseTaxonomy(tsv) {
  const map = new Map();
  for (const line of tsv.split(/\r?\n/).slice(2)) {
    const [id, parent, name] = line.split("\t");
    if (id && name) map.set(id.trim(), { id: id.trim(), parent: (parent || "").trim() || null, name: name.trim() });
  }
  return map;
}

export function makeTaxonomy(map, version) {
  const ancestors = (id) => { const out = []; let n = map.get(id); while (n?.parent) { out.push(n.parent); n = map.get(n.parent); } return out; };
  return {
    version, size: map.size,
    has: (id) => map.has(String(id)),
    name: (id) => map.get(String(id))?.name || null,
    path: (id) => [...ancestors(String(id)).reverse(), String(id)].map((x) => map.get(x)?.name).filter(Boolean).join(" › "),
    ancestors: (id) => ancestors(String(id)),
    tier1: (id) => [String(id), ...ancestors(String(id))].pop(),
    // a is the same as b or sits under b
    within: (a, b) => String(a) === String(b) || ancestors(String(a)).includes(String(b)),
    all: () => [...map.values()],
  };
}

export function loadConfig(dir = CONFIG_DIR) {
  const tx = readJson(dir, "taxonomy.v1.json");
  const tsv = fs.readFileSync(path.join(dir, tx.file), "utf8");
  if (sha256(tsv.replace(/\r\n/g, "\n")) !== tx.sha256) throw new Error(`Taxonomy file ${tx.file} does not match its recorded sha256 — it was changed outside version control.`);
  const taxonomy = makeTaxonomy(parseTaxonomy(tsv), tx.version);
  const cfg = {
    taxonomy,
    publishers: readJson(dir, "publishers.v2.json"),
    formats: readJson(dir, "formats.v1.json"),
    safety: readJson(dir, "safety-policy.v2.json"),
    scoring: readJson(dir, "scoring.v2.json"),
    lexicon: readJson(dir, "category-lexicon.v2.json"),
  };
  const problems = validateConfig(cfg);
  if (problems.length) throw new Error("Open Web config is invalid: " + problems.join("; "));
  cfg.versions = { taxonomy: tx.version, publishers: cfg.publishers.version, formats: cfg.formats.version, safety: cfg.safety.version, scoring: cfg.scoring.version, lexicon: cfg.lexicon.version };
  return cfg;
}

export function validateConfig(cfg) {
  const p = [], T = cfg.taxonomy;
  for (const [sec, ids] of Object.entries(cfg.lexicon.sections)) for (const id of ids) if (!T.has(id)) p.push(`lexicon section "${sec}" → unknown IAB id ${id}`);
  for (const id of Object.keys(cfg.lexicon.terms)) if (!T.has(id)) p.push(`lexicon terms → unknown IAB id ${id}`);
  for (const c of cfg.safety.categories) { if (!T.has(c.iab)) p.push(`safety → unknown IAB id ${c.iab}`); if (!["exclude", "review"].includes(c.action)) p.push(`safety ${c.iab} → action must be exclude or review`); }
  for (const k of ["onUnknown", "onConflict"]) if (!["needs_review", "excluded"].includes(cfg.safety[k])) p.push(`safety.${k} must be needs_review or excluded`);
  if (!["conflict", "exclude"].includes(cfg.safety.aiOnlyUnsafe)) p.push("safety.aiOnlyUnsafe must be conflict or exclude");
  const fmts = Object.keys(cfg.formats.formats);
  for (const pub of cfg.publishers.publishers) {
    for (const f of Object.keys(pub.formats || {})) { if (!fmts.includes(f)) p.push(`publisher ${pub.id} → unknown format ${f}`); if (!String(pub.formats[f]).trim()) p.push(`publisher ${pub.id} format ${f} has no source`); }
    if (!pub.feeds?.length) p.push(`publisher ${pub.id} has no feed`);
  }
  for (const f of Object.values(cfg.formats.showcasePlatforms)) if (!fmts.includes(f)) p.push(`showcase platform → unknown format ${f}`);
  const w = cfg.scoring.weights; if (Object.values(w).reduce((a, b) => a + b, 0) !== 100) p.push("scoring weights must add up to 100");
  const sw = cfg.scoring.semanticWeights, sm = cfg.scoring.semantic;
  if (sw && Object.values(sw).reduce((a, b) => a + b, 0) !== 100) p.push("scoring semanticWeights must add up to 100");
  if (sm && !(sm.floor < sm.minAlone && sm.minAlone < sm.full)) p.push("scoring.semantic must have floor < minAlone < full");
  if (cfg.scoring.negativeSentiment && !["needs_review", "ignore"].includes(cfg.scoring.negativeSentiment)) p.push("scoring.negativeSentiment must be needs_review or ignore");
  return p;
}
