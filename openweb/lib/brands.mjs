// Brand knowledge (config/brands.v1.json): the brands MediaKart pitches, with their categories, product lines, official
// sites, approximate brand colours, the ad design that suits them, real competitors and their own sister brands.
// A typed brand (or a product naming a sub-brand: "Nestle" + "Maggi noodles") resolves to one profile.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STYLES } from "./strip.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const key = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const HEX = /^#[0-9a-f]{6}$/i;

export function loadBrands(dir = path.join(HERE, "..", "config")) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, "brands.v1.json"), "utf8"));
  for (const b of c.brands) {
    const all = [b, ...(b.subBrands || [])];
    for (const x of all) {
      if (!x.name || !Array.isArray(x.aliases) || !x.aliases.length) throw new Error(`brands.v1.json: ${b.id}: every brand needs a name and aliases`);
      if (x.style && !STYLES.includes(x.style)) throw new Error(`brands.v1.json: ${x.name}: unknown style ${x.style}`);
      for (const v of Object.values(x.colours || {})) if (v !== null && !HEX.test(v)) throw new Error(`brands.v1.json: ${x.name}: colour ${v} is not #rrggbb`);
    }
    if (!b.id || !b.category || !b.domains?.length || !(b.competitors?.length >= 3)) throw new Error(`brands.v1.json: ${b.id || b.name}: id, category, domains and 3+ competitors are needed`);
  }
  return c;
}

// The profile for what was typed: a sub-brand named in the brand or the product wins over its parent.
export function findBrand(cfg, brand, product = "") {
  const b = key(brand), p = key(product), has = (text, a) => (` ${text} `).includes(` ${key(a)} `);
  let best = null;
  for (const parent of cfg.brands) {
    const parentHit = parent.aliases.some((a) => key(a) === b) || key(parent.name) === b;
    for (const sub of parent.subBrands || []) {
      if (sub.aliases.some((a) => key(a) === b) || ((parentHit || sub.aliases.some((a) => has(b, a))) && sub.aliases.some((a) => has(p, a)))) return merge(parent, sub);
    }
    if (parentHit) best = best || merge(parent, null);
  }
  return best;
}

function merge(parent, sub) {
  const s = sub || {};
  return {
    id: parent.id, sub: sub ? s.name : null, name: s.name || parent.name, parent: parent.parent || (sub ? parent.name : null),
    category: s.category || parent.category, products: s.products || parent.products,
    domains: [...new Set([...(s.domains || []), ...parent.domains])],
    colours: { primary: s.colours?.primary || parent.colours?.primary || null, accent: s.colours?.accent || parent.colours?.accent || null },
    style: s.style || parent.style || null, motif: s.motif || parent.motif || null,
    competitors: [...new Set([...(s.competitors || []), ...parent.competitors])],
    family: [...new Set([parent.name, ...(parent.family || []), ...(parent.subBrands || []).map((x) => x.name)].filter((x) => x && x !== (s.name || parent.name)))],
    topics: [...new Set([...(s.topics || []), ...(parent.topics || [])])],
  };
}

// The facts handed to the AI with every request about this brand (so it does not guess categories or rivals)
export const brandBrief = (k) => k ? `Brand facts (MediaKart brand knowledge): ${k.name}${k.parent ? ` (${k.parent})` : ""} — ${k.category}. Products: ${k.products.join(", ")}. Official sites: ${k.domains.join(", ")}. Competitors: ${k.competitors.join(", ")}. Same company (not competitors): ${k.family.join(", ") || "-"}.` : "";
