// Brand guidelines (Creative Intelligence Engine, phase 1): one stored guideline per brand, built from the facts MediaKart
// already holds — the Top 50 list (config/brands.v2.json) and the online research behind it (brands_research.json) —
// plus at most ONE AI text call that turns those facts into creative direction (type, motion, signature visuals, do/don't).
// Every field says where it came from: "brands.v2" / "research" are checked facts; "ai-direction" is creative direction
// derived from those facts (never a product claim); "unverified" means no checked source holds it.
// Saved at config/guidelines/<brand-slug>.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBrand } from "./brands.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GUIDELINE_VERSION = "guideline.v1";
export const GUIDELINE_DIR = path.join(HERE, "..", "config", "guidelines");
export const RESEARCH_FILE = "D:/contextual-ads/inimage/_research/brands_research.json";
// the Google Fonts the direction may name (all free, all loadable by family name)
export const GOOGLE_FONTS = ["Playfair Display", "Cormorant Garamond", "DM Serif Display", "Fraunces", "Libre Caslon Text", "Poppins", "Inter", "Manrope", "DM Sans", "Montserrat", "Space Grotesk", "Archivo", "Archivo Black", "Anton", "Bebas Neue", "Oswald", "Baloo 2", "Mukta", "Outfit", "Syne", "Sora", "Work Sans"];
const HEX = /^#[0-9a-f]{6}$/i;

export const slug = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const src = (value, source, note) => ({ value, source, ...(note ? { note } : {}) });

export function loadResearch(file = RESEARCH_FILE) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { brands: [] }; }
}

// Where a brand outside the Top 50 is mentioned (as a rival of a listed brand): the only checked facts about it.
function mentions(cfg, name) {
  const k = slug(name), out = [];
  for (const b of cfg.brands) for (const r of b.rivals || []) if (slug(r.brand) === k) out.push({ rivalOf: b.name, lines: r.lines || [] });
  return out;
}

/** The checked facts for a brand (no AI): from brands.v2 when listed, else only where the list mentions it as a rival. */
export function brandFacts(cfg, research, name) {
  const k = findBrand(cfg, name);
  const r = k ? (research.brands || []).find((x) => x.id === k.id) : null;
  if (!k) {
    const m = mentions(cfg, name);
    return { name, id: slug(name), inBrandList: false, mentions: m, products: [...new Set(m.flatMap((x) => x.lines))] };
  }
  return { name: k.name, id: k.id, inBrandList: true, category: k.category, products: k.products, heroProducts: k.heroProducts,
    colours: k.colours, coloursSource: k.coloursSource, logo: k.logo, style: k.style, motif: k.motif, adLook: k.adLook, campaigns: k.campaigns,
    notes: k.notes, research: r ? { identity: r.identity || null, ad_look: r.ad_look || null, design_fit: r.design_fit || null, hero_products: r.hero_products || [], campaigns: r.campaigns || [], unverified: r.unverified || [] } : null };
}

export const GUIDELINE_SCHEMA = { type: "object", properties: {
  visual_identity: { type: "string" },
  supporting_colours: { type: "array", items: { type: "object", properties: { hex: { type: "string" }, role: { type: "string" } }, required: ["hex", "role"] } },
  display_font: { type: "string", enum: GOOGLE_FONTS }, text_font: { type: "string", enum: GOOGLE_FONTS }, type_notes: { type: "string" },
  motion_language: { type: "string" }, campaign_tone: { type: "string" },
  signature_visuals: { type: "array", items: { type: "string" } },
  do: { type: "array", items: { type: "string" } }, dont: { type: "array", items: { type: "string" } },
}, required: ["visual_identity", "display_font", "text_font", "motion_language", "campaign_tone", "signature_visuals", "do", "dont"] };

export function guidelinePrompt(f) {
  return `Brand: ${f.name}\nFacts (checked; use ONLY these, never add products, claims, numbers, awards or campaigns):\n${JSON.stringify(f, null, 1).slice(0, 6000)}\n
${f.inBrandList ? "" : "This brand is NOT in MediaKart's checked brand list — the facts are only where it is named as a rival. Keep every point general and visual; do not state facts about the brand.\n"}Write the creative direction a premium agency would follow for in-image display ads of this brand, true to the facts:
visual_identity (2 sentences: how the brand looks), supporting_colours (0–3 #rrggbb tints/neutrals that sit with the brand colours — never a new brand colour), display_font and text_font (from the list given), type_notes (weight, case, tracking), motion_language (restrained, intentional: how things enter and settle), campaign_tone (from the ad look facts), signature_visuals (3–5 real photographic subjects that suit the brand: textures, places, moments — no drawn effects), do (3–5) and dont (3–5; include "no drawn particles, sparkles or cartoon splashes" and "no claims or numbers").`;
}

/**
 * Builds a brand's guideline: checked facts + one AI call for direction (skipped when ask is null).
 * @param {{ cfg: any, research?: any, brand: string, ask?: Function|null }} o
 */
export async function buildGuideline({ cfg, research = { brands: [] }, brand, ask = null }) {
  const f = brandFacts(cfg, research, brand);
  let ai = null, aiError = null;
  if (ask) {
    try { ai = await ask("You are the brand design lead of a premium ad studio. You only use the facts given.", guidelinePrompt(f), GUIDELINE_SCHEMA, [], "high"); }
    catch (e) { aiError = String(e.message || e).slice(0, 200); }
  }
  const AI = "ai-direction (derived from the checked facts, not a brand rule)";
  const listed = f.inBrandList, rid = f.research?.identity;
  const colours = [];
  if (listed && f.colours?.primary) colours.push({ hex: f.colours.primary, role: "primary", source: "brands.v2", note: f.coloursSource || "" });
  if (listed && f.colours?.accent) colours.push({ hex: f.colours.accent, role: "accent", source: "brands.v2", note: f.coloursSource || "" });
  for (const [role, v] of Object.entries(rid || {})) if (v && typeof v === "object" && HEX.test(v.hex || "") && !colours.some((c) => c.hex.toLowerCase() === v.hex.toLowerCase())) colours.push({ hex: v.hex.toLowerCase(), role, source: "research", note: v.source || "" });
  for (const c of ai?.supporting_colours || []) if (HEX.test(c.hex) && !colours.some((x) => x.hex.toLowerCase() === c.hex.toLowerCase())) colours.push({ hex: c.hex.toLowerCase(), role: "supporting: " + String(c.role).slice(0, 60), source: AI });
  const fonts = (x) => (GOOGLE_FONTS.includes(x) ? x : null);
  const g = {
    version: GUIDELINE_VERSION, brand: f.name, slug: slug(f.name), inBrandList: listed, builtAt: new Date().toISOString(),
    sources: { facts: listed ? "openweb/config/brands.v2.json" + (f.research ? " + " + RESEARCH_FILE : "") : `not in brands.v2.json; only named as a rival of ${f.mentions.map((m) => m.rivalOf).join(", ") || "no listed brand"}`, direction: ai ? AI : aiError ? "AI unavailable: " + aiError : "none" },
    visual_identity: ai ? src(ai.visual_identity, AI) : src(null, "unverified"),
    ad_look: listed ? src(f.adLook || f.research?.ad_look || null, f.adLook ? "brands.v2" : "research") : src(null, "unverified"),
    colour_system: colours.length ? colours : [{ hex: null, role: "primary", source: "unverified", note: "no checked colour for this brand" }],
    typography: { display: src(fonts(ai?.display_font), ai ? AI : "unverified"), text: src(fonts(ai?.text_font), ai ? AI : "unverified"), notes: src(ai?.type_notes || null, ai ? AI : "unverified"),
      strip_style: src(listed ? f.style || f.research?.design_fit?.design || null : null, listed ? "brands.v2" : "unverified") },
    motion_language: src(ai?.motion_language || null, ai ? AI : "unverified"),
    campaign_tone: src(ai?.campaign_tone || null, ai ? AI : "unverified"),
    campaigns: listed ? (f.campaigns || []).map((c) => ({ ...c, source_kind: "brands.v2" })) : [],
    signature_visuals: src((ai?.signature_visuals || []).slice(0, 5), ai ? AI : "unverified"),
    product_range: listed ? src(f.products, "brands.v2", f.heroProducts?.length ? "hero: " + f.heroProducts.join(", ") : "") : src(f.products, f.products.length ? "brands.v2 (rival lines)" : "unverified"),
    logo: listed && f.logo ? src(f.logo, "brands.v2") : src(null, "unverified"),
    do: src((ai?.do || []).slice(0, 5), ai ? AI : "unverified"),
    dont: src([...new Set([...(ai?.dont || []).slice(0, 5), "No drawn particles, sparkles, orbits or cartoon splashes", "No claims, prices or numbers the brand has not made"])], ai ? AI + " + house rules" : "house rules"),
    safety_notes: listed ? src(f.notes || [], "brands.v2") : src([], "unverified"),
    unverified: listed ? f.research?.unverified || [] : ["Everything except the rival lines: this brand is not in the checked Top 50 list"],
  };
  return g;
}

export function saveGuideline(g, dir = GUIDELINE_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, g.slug + ".json");
  fs.writeFileSync(file, JSON.stringify(g, null, 1));
  return file;
}

/** The stored guideline, by the typed name or (with cfg) the listed brand's full name ("Himalaya" → himalaya-wellness). */
export function loadGuideline(brand, dir = GUIDELINE_DIR, cfg = null) {
  const names = [brand, cfg ? findBrand(cfg, brand)?.name : null].filter(Boolean);
  for (const n of names) { try { return JSON.parse(fs.readFileSync(path.join(dir, slug(n) + ".json"), "utf8")); } catch { /* next */ } }
  return null;
}

/** Every field object that carries a value must carry its source (used by tests and before saving). */
export function unsourced(g) {
  const bad = [];
  const walk = (v, p) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === "object") { if ("value" in v && !v.source) bad.push(p); if ("hex" in v && !v.source) bad.push(p); for (const [k, x] of Object.entries(v)) if (k !== "value") walk(x, p + "." + k); }
  };
  walk(g, "");
  return bad;
}
