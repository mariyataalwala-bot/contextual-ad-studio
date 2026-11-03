// Product discovery at brand and category level. The user types a brand ("Himalaya") and a product or category ("Facewash");
// this finds the brand's real products of that kind — Purifying Neem Face Wash, Charcoal Face Wash … — each with a picture, so the
// user can pick one. Rules: the brand is identified first (brand knowledge, then the typed words); the whole category is understood
// ("facewash" = "face wash"); variants count even when their names differ from what was typed; other brands and other product types
// are left out; exact matches rank first, then the brand's official site, then the rest of the category. A product name is never
// made up: each one is cut out of a real search-result title (or comes from the brand knowledge file). The optional AI step
// (one text-only call) may only merge, drop or tidy names — a name it returns must be made of words found in the titles it was
// given, otherwise the title-derived name is kept. Without the AI the same grouping is done by rules.
import { imageSearch, brandHost } from "./websearch.mjs";
import { loadBrands, findBrand, ownNames, namesBrand } from "./brands.mjs";
import { foldKey, termTokens, categoryOf, mentionsCategory, otherCategories } from "./product-terms.mjs";
import { foreignSite } from "./studio.mjs";
import { withTimeout } from "./reader.mjs";

const MAX_ITEMS = 12, MAX_CANDIDATES = 40;
// Pictures that are not a product (and comparisons / bundles of other things)
const NOT_A_PRODUCT = /\b(logo|wallpaper|vector|clip ?art|advert(?:isement)?|tvc|commercial|banner|poster|vs|versus|ad film)\b/i;
// Shop and listing words that are not part of a product's name
const SHOP_WORDS = /\b(buy|online|price|prices|best|review|reviews|png|hd|images?|photos?|pictures?|official|store|shop|shopping|free shipping|in india|india|at|rs|inr)\b/gi;
const SIZE = /\b\d+(?:\.\d+)?\s?(?:ml|g|gm|gms|gram|grams|kg|l|ltr|litre|litres|oz|fl\.? ?oz|pcs?|pieces?|tabs?|caps?|count|sheets?)\b/gi;
const STOP = new Set(["the", "a", "an", "and", "of", "with", "for", "by", "in", "on", "to", "pack", "combo", "set", "new", "ml", "gm", "g"]);

const titleCase = (s) => s.replace(/\b([a-z])([a-z']*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase());
const words = (s) => String(s || "").split(/\s+/).filter(Boolean);

/**
 * The product name inside a result title: the segment of the title ("Brand Product - 100 ml | Shop") that names the brand and the
 * category, without sizes, shop words or brackets. Returns "" when the title holds no usable name.
 * @param {string} title @param {{ names: (t: string) => boolean, category: (t: string) => boolean, brandLabel: string }} o
 */
export function nameFromTitle(title, { names, category, brandLabel }) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const segs = t.split(/\s*[|•·–—]\s*|\s+-\s+|\s*:\s+/).map((s) => s.trim()).filter(Boolean);
  let seg = segs.find((s) => names(s) && category(s));
  let prefix = false;
  if (!seg) { seg = segs.find((s) => category(s)); prefix = !!seg && segs.some((s) => names(s)); }
  if (!seg) return "";
  let n = seg.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\bpack of \d+\b/gi, " ").replace(SIZE, " ").replace(SHOP_WORDS, " ").replace(/&amp;/g, "&");
  n = n.replace(/\s+/g, " ").replace(/^[\s\-–—:,;&+/.]+|[\s\-–—:,;&+/.]+$/g, "");
  n = n.replace(/\b(and|with|for|the|a|an|of|to|in|on|by|or|at)$|&$/i, "").trim();
  if (n === n.toUpperCase() || n === n.toLowerCase()) n = titleCase(n);
  if (prefix && !names(n)) n = `${brandLabel} ${n}`;
  if (words(n).length > 9) return "";   // a keyword-stuffed title, not a product name
  return words(n).length >= 2 ? n : "";
}

/**
 * Rank: exact (the typed words are in the name) before related (same category); within each: the bare "Brand Product" name, the official site,
 * the brand's own known products, then by how many results show it.
 */
function rank(a, b) {
  return (a.match === "exact" ? 0 : 1) - (b.match === "exact" ? 0 : 1) || (b._bare ? 1 : 0) - (a._bare ? 1 : 0) || (b.official ? 1 : 0) - (a.official ? 1 : 0)
    || (b.known ? 1 : 0) - (a.known ? 1 : 0) || b._support - a._support || a.name.localeCompare(b.name);
}

/**
 * @param {{ brand: string, product: string, fetchImpl?: any, ask?: Function|null, brands?: any, search?: ((q: string) => Promise<any[]>)|null, limit?: number,
 *   shops?: { indian?: string[], foreign?: string[] } }} o
 * @returns {Promise<{ brand: string, query: { brand: string, product: string, normalised: string, category: string[] }, items: { name: string, picture: { url: string, thumb: string|null, page: string, host: string }|null, match: "exact"|"category", source: string, official: boolean, known: boolean }[], notes: string[] }>}
 */
export async function discoverProducts(o) {
  const brandIn = String(o.brand || "").trim().slice(0, 60), productIn = String(o.product || "").trim().slice(0, 100), notes = /** @type {string[]} */ ([]);
  const cfg = o.brands || loadBrands(), known = findBrand(cfg, brandIn, productIn);
  const limit = Math.min(MAX_ITEMS, o.limit || MAX_ITEMS), ask = o.ask || null, fetchImpl = o.fetchImpl || globalThis.fetch;
  const search = o.search || ((q) => imageSearch(q, { fetchImpl }));
  const cat = categoryOf(productIn), normalised = foldKey(productIn), brandLabel = known?.parent ? known.name : /^[a-z]/.test(brandIn) ? brandIn.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : brandIn;

  // 1) who is the brand: its own names (brand knowledge) or the typed words; its rivals and every other known brand are "other brands"
  const own = known ? ownNames(known) : [foldKey(brandIn)].filter((x) => x.length >= 2);
  const ownSet = new Set([...own, ...(known?.family || []).map(foldKey)]);
  const ambiguous = new Set(cfg.brands.flatMap((b) => (b.contextAliases || []).map((a) => foldKey(a.alias))));
  const rivalNames = [...new Set([...(known?.competitors || []), ...cfg.brands.map((b) => b.name)].map(foldKey))]
    .filter((n) => n.length >= 3 && !ownSet.has(n) && !ambiguous.has(n) && !own.some((m) => n.includes(m) || m.includes(n)));
  const has = (text, k) => ` ${foldKey(text)} `.includes(` ${k} `);
  // a brand that is not in the knowledge file has no known rivals: its name must then START the title ("Garnier Acme Face Wash" is Garnier's)
  const starts = (t, k) => { const x = foldKey(t).replace(/^(?:buy|shop|new|original|genuine|official)\s+/, ""); return x === k || x.startsWith(k + " "); };
  const names = (t) => known ? namesBrand(known, t) : own.some((k) => starts(t, k));
  const rival = (t) => rivalNames.find((k) => has(t, k)) || null;
  // the brand's own words (its name, not every alias: "Himalaya Face Wash" is an alias, and "face wash" is the product)
  const brandTokens = new Set([brandIn, known?.name, known?.parent].filter(Boolean).flatMap((k) => termTokens(k)));
  const typedTokens = termTokens(productIn).filter((w) => !brandTokens.has(w) && !STOP.has(w));
  const catTokens = cat.words;

  // 2) a few searches: brand + product as typed, + the normalised product, + "range", + "variants"
  const base = [`${brandIn} ${productIn}`.trim()];
  const plain = (q) => q.toLowerCase().replace(/\s+/g, " ").trim();   // search engines read "facewash" and "face wash" differently, so both are asked
  if (normalised && plain(`${brandIn} ${productIn}`) !== plain(`${brandIn} ${normalised}`)) base.push(`${brandIn} ${normalised}`);
  base.push(`${brandIn} ${normalised || productIn} range`, `${brandIn} ${normalised || productIn} variants`);
  const queries = [...new Map(base.map((q) => [plain(q), q])).values()];
  const lists = await Promise.all(queries.map((q) => Promise.resolve().then(() => search(q)).catch((e) => { notes.push(`Search “${q}” failed: ${String(e.message).slice(0, 80)}`); return []; })));
  const flat = [], seenPic = new Set();
  for (const r of lists.flat()) { if (!r || !r.title || !r.url || seenPic.has(r.url)) continue; seenPic.add(r.url); flat.push(r); }

  // 3) the real products: titles that name this brand, name the category, and name no other brand or other product type
  const siteScore = (host) => {
    const h = String(host || "").toLowerCase().replace(/^www\./, "");
    const inList = (l) => (l || []).some((d) => h === d || h.endsWith("." + d));
    const official = !!h && (brandHost(h, brandIn) || (known?.domains || []).some((d) => { const x = d.replace(/^www\./, ""); return h === x || h.endsWith("." + x); }));
    return { official, score: inList(o.shops?.foreign) || foreignSite(h) ? 0 : official ? 3 : inList(o.shops?.indian) || /\.in$/.test(h) ? 2 : 1 };
  };
  /** @type {any[]} */ const cands = [];
  for (const r of flat) {
    const t = r.title;
    if (NOT_A_PRODUCT.test(t) || !names(t) || rival(t) || !mentionsCategory(t, cat) || otherCategories(t, cat).length) continue;
    const name = nameFromTitle(t, { names, category: (s) => mentionsCategory(s, cat), brandLabel });
    if (!name || rival(name) || otherCategories(name, cat).length) continue;
    cands.push({ name, title: t, r, site: siteScore(r.host) });
    if (cands.length >= MAX_CANDIDATES) break;
  }
  const core = (name) => [...new Set(termTokens(name).filter((w) => !brandTokens.has(w) && !STOP.has(w)))];
  const qualifiers = (tokens) => tokens.filter((w) => !catTokens.has(w));
  // two names are one product when one holds all the words of the other, the shorter one says more than the category, and the longer adds at most two words
  const same = (a, b) => {
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    return s.length > 0 && s.every((w) => l.includes(w)) && (s.length === l.length || (qualifiers(s).length >= 1 && l.length - s.length <= 2));
  };
  /** @type {{ name: string, core: string[], names: any[], pics: any[], texts: string[], known: boolean }[]} */ let groups = [];
  const place = (g) => { const hit = groups.find((x) => same(x.core, g.core)); if (hit) { hit.names.push(...g.names); hit.pics.push(...g.pics); hit.texts.push(...g.texts); hit.known ||= g.known; if (g.core.length > hit.core.length) hit.core = g.core; } else groups.push(g); };
  // brand knowledge: the brand's own named products of this category (never a generic "range" line)
  const knownNames = (known?.products || []).filter((p) => !/\brange\b|\band\b|&/i.test(p) && mentionsCategory(p, cat) && !otherCategories(p, cat).length);
  const items0 = [...cands.map((c) => ({ core: core(c.name), names: [{ name: c.name, official: c.site.official }], pics: [{ ...c.r, site: c.site }], texts: [c.title], known: false })),
    ...knownNames.map((p) => ({ core: core(p), names: [{ name: names(p) ? p : `${brandLabel} ${p}`, official: true, fromKnowledge: true }], pics: [], texts: [p], known: true }))]
    .sort((a, b) => b.core.length - a.core.length);
  for (const g of items0) place({ name: "", ...g });

  // 4) one text-only AI call: may drop non-products, merge the same product, tidy a name — only with words found in the titles
  if (ask && groups.length > 1) {
    try {
      const listing = groups.map((g, i) => `${i} | ${g.names[0].name} | ${[...new Set(g.texts)].slice(0, 3).join(" ## ")}`).join("\n");
      const answer = await withTimeout(Promise.resolve(ask("You sort product search results into distinct real products. You only use what the titles say; you never add a word that is not in them.",
        `Brand: ${brandIn}${known ? ` (${known.name})` : ""}. Typed product: “${productIn}” (category: ${cat.phrases.join(", ") || cat.variants.map((v) => v.join(" ")).join(", ") || "unknown"}).\n` +
        `Each line is: group number | candidate name | search-result titles of that group.\n${listing}\n\n` +
        `For EVERY group: keep = true only if it is a real consumer product of ${brandIn} itself, of the typed category (a variant with a different name still counts); false for another brand, another product type, a gift set of several types, a logo, an advert or an article. ` +
        `name = the product's name copied from the titles of that group (shop words, sizes and repeated brand words removed; never a word that is not in a title). merge_into = the number of another group that is the very same product written differently, else -1.`,
        { type: "object", additionalProperties: false, required: ["groups"], properties: { groups: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "keep", "name", "merge_into"], properties: { id: { type: "integer" }, keep: { type: "boolean" }, name: { type: "string" }, merge_into: { type: "integer" } } } } } }, [], "medium")), 25000, "Product grouping");
      const verdict = new Map((answer?.groups || []).filter((x) => Number.isInteger(x?.id) && x.id >= 0 && x.id < groups.length).map((x) => [x.id, x]));
      if (verdict.size) {
        const next = groups.map((g) => ({ ...g, names: [...g.names], pics: [...g.pics], texts: [...g.texts] })), dead = new Set();
        for (const [i, v] of verdict) {
          const m = v.merge_into;
          if (v.keep && Number.isInteger(m) && m >= 0 && m < groups.length && m !== i && verdict.get(m)?.keep !== false && !dead.has(m)) { const t = next[m]; t.names.push(...next[i].names); t.pics.push(...next[i].pics); t.texts.push(...next[i].texts); t.known ||= next[i].known; dead.add(i); }
        }
        for (const [i, v] of verdict) if (!v.keep) dead.add(i);
        for (const [i, v] of verdict) {   // a tidied name counts only when every word of it is in the group's own titles (or the brand's)
          if (dead.has(i) || !v.keep) continue;
          const allowed = new Set([...next[i].texts.flatMap((x) => termTokens(x)), ...brandTokens]), nm = String(v.name || "").trim();
          if (nm && words(nm).length <= 9 && termTokens(nm).length && termTokens(nm).every((w) => allowed.has(w))) next[i].names.unshift({ name: names(nm) ? nm : `${brandLabel} ${nm}`, official: false, ai: true });
        }
        const kept = next.filter((_, i) => !dead.has(i));
        if (kept.length) groups = kept; else notes.push("The AI kept none of the groups; the rule-based grouping was used.");
      }
    } catch (e) { notes.push("AI grouping skipped: " + String(e.message).slice(0, 100)); }
  }

  // 5) the list: a name, a picture, the match, its source
  const out = groups.map((g) => {
    const pics = g.pics.filter((p) => p.thumb || p.url).sort((a, b) => b.site.score - a.site.score);
    const best = pics[0] || null;
    const nameVotes = new Map(); for (const n of g.names) nameVotes.set(n.name, (nameVotes.get(n.name) || 0) + 1);
    // a name from the brand knowledge file, or tidied by the AI, first; then the official site's wording, then the commonest, then the fuller one
    const chosen = [...g.names].sort((a, b) => (b.fromKnowledge ? 1 : 0) - (a.fromKnowledge ? 1 : 0) || (b.ai ? 1 : 0) - (a.ai ? 1 : 0) || (b.official ? 1 : 0) - (a.official ? 1 : 0) || nameVotes.get(b.name) - nameVotes.get(a.name) || b.name.length - a.name.length)[0];
    const c = core(chosen.name), all = [...new Set(g.core.concat(c))];
    // exact: the name holds everything typed, and what was typed says more than the category ("Neem Face Wash") or the name IS what was typed ("Himalaya Face Wash")
    const bare = typedTokens.length > 0 && c.length === typedTokens.length && typedTokens.every((w) => c.includes(w));
    const exact = typedTokens.length > 0 && typedTokens.every((w) => all.includes(w)) && (bare || qualifiers(typedTokens).length > 0);
    return { name: chosen.name, picture: best ? { url: best.url, thumb: best.thumb || null, page: best.page, host: best.host } : null,
      match: /** @type {"exact"|"category"} */ (exact ? "exact" : "category"), source: best ? best.host : "brand knowledge", official: !!best?.site.official, known: g.known,
      _bare: bare, _support: Math.max(g.pics.length, 1) };
  }).sort(rank).slice(0, limit).map(({ _bare, _support, ...x }) => x);
  if (!out.length) notes.push(`No ${brandIn} ${productIn} products were found — type the product's name, or paste a link to its photo.`);
  return { brand: known?.name || brandIn, query: { brand: brandIn, product: productIn, normalised, category: cat.phrases }, items: out, notes };
}
