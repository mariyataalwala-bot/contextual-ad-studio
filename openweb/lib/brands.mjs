// Brand knowledge (config/brands.v2.json): the brands MediaKart pitches, checked online — categories, current products
// (hero products first), official sites, brand colours with their source, official logo files, the ad design that
// suits them, how their ads look, real competitors (with their product lines) and their own sister brands, products
// that must never be advertised, and brand names that are everyday words. Shared by the In-Image Studio and the
// YouTube contextual tool. A typed brand (or a product naming a sub-brand: "Nestle" + "Maggi noodles") resolves to one profile.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STYLES } from "./strip.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BRANDS_FILE = "brands.v2.json";
const key = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const HEX = /^#[0-9a-f]{6}$/i;

export function loadBrands(dir = path.join(HERE, "..", "config"), file = BRANDS_FILE) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  for (const b of c.brands) {
    const all = [b, ...(b.subBrands || [])];
    for (const x of all) {
      if (!x.name || !Array.isArray(x.aliases) || !x.aliases.length) throw new Error(`${file}: ${b.id}: every brand needs a name and aliases`);
      if (x.style && !STYLES.includes(x.style)) throw new Error(`${file}: ${x.name}: unknown style ${x.style}`);
      for (const v of Object.values(x.colours || {})) if (v !== null && !HEX.test(v)) throw new Error(`${file}: ${x.name}: colour ${v} is not #rrggbb`);
    }
    if (!b.id || !b.category || !b.domains?.length || !(b.competitors?.length >= 3)) throw new Error(`${file}: ${b.id || b.name}: id, category, domains and 3+ competitors are needed`);
    for (const a of b.contextAliases || []) if (!a.alias || !a.needs?.length) throw new Error(`${file}: ${b.id}: a context alias needs the words it must appear with`);
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
    aliases: [...new Set([...(s.aliases || []), ...(sub ? [] : parent.aliases)])],
    category: s.category || parent.category, products: s.products || parent.products,
    heroProducts: s.products ? s.products.slice(0, 3) : parent.heroProducts || parent.products.slice(0, 3),
    domains: [...new Set([...(s.domains || []), ...parent.domains])],
    colours: { primary: s.colours?.primary || parent.colours?.primary || null, accent: s.colours?.accent || parent.colours?.accent || null },
    coloursSource: s.colours ? "sub-brand" : parent.coloursSource || null,
    logo: sub ? null : parent.logo || null,   // the parent's logo file is the company mark, not the sub-brand's
    style: s.style || parent.style || null, motif: s.motif || parent.motif || null,
    competitors: [...new Set([...(s.competitors || []), ...parent.competitors])],
    family: [...new Set([parent.name, ...(parent.family || []), ...(parent.subBrands || []).map((x) => x.name)].filter((x) => x && x !== (s.name || parent.name)))],
    topics: [...new Set([...(s.topics || []), ...(parent.topics || [])])],
    adLook: parent.adLook || null, campaigns: parent.campaigns || [],
    contextAliases: parent.contextAliases || [],
    banned: s.banned ? { products: [s.name, ...(s.products || [])], reason: parent.banned?.reason || "This product is not advertised." } : parent.banned || null,
    notes: parent.notes || [],
  };
}

// The facts handed to the AI with every request about this brand (so it does not guess products, categories or rivals)
export const brandBrief = (k) => k ? `Brand facts (MediaKart brand knowledge, checked online): ${k.name}${k.parent ? ` (${k.parent})` : ""} — ${k.category}. ` +
  `Current products (exact names): ${k.products.join(", ")}. Official sites: ${k.domains.join(", ")}. Competitors: ${k.competitors.join(", ")}. ` +
  `Same company (never competitors): ${k.family.join(", ") || "-"}.${k.adLook ? ` How ${k.name}'s ads look: ${k.adLook}` : ""}${k.banned ? ` Never advertise: ${k.banned.products.join(", ")}.` : ""}` : "";

// A product that must never be advertised (e.g. infant formula — India's IMS Act): the reason, or null
export function bannedReason(k, ...texts) {
  if (!k?.banned) return null;
  const t = ` ${key(texts.join(" "))} `;
  return k.sub && k.banned.products.includes(k.name) ? k.banned.reason
    : k.banned.products.some((p) => t.includes(` ${key(p)} `)) ? k.banned.reason : null;
}

// Every name that means the brand itself (its names, sister brands, sub-brands) — for "never the brand's own content".
// Everyday-word aliases (boAt, Yatra, Galaxy …) are left out: on their own they would match unrelated titles.
export function ownNames(k) {
  if (!k) return [];
  const ambiguous = new Set((k.contextAliases || []).map((a) => key(a.alias)));
  return [...new Set([k.name, ...k.aliases, ...k.family].map(key).filter((n) => n.length >= 3 && !ambiguous.has(n)))];
}

// Does this text name the brand? Everyday-word aliases count only next to one of their product words.
export function namesBrand(k, text) {
  const t = ` ${key(text)} `;
  if (ownNames(k).some((n) => t.includes(` ${n} `))) return true;
  return (k?.contextAliases || []).some((a) => t.includes(` ${key(a.alias)} `) && a.needs.some((w) => t.includes(` ${key(w)} `)));
}
