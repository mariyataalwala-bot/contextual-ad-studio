// Product words, the way people write them: "facewash" and "face wash" are the same product, "bodylotion" is "body lotion".
// A small category vocabulary turns every spelling into one canonical, spaced form; brand matching (brands.mjs) and product
// discovery (discover-products.mjs) both use it. Nothing here guesses a product name — it only compares words.

// Two-word product types (canonical spelling is the spaced one; the joined form is derived: "face wash" → "facewash").
const PHRASES = [
  "face wash", "body wash", "hand wash", "dish wash", "mouth wash", "eye wash", "car wash", "floor cleaner",
  "face cream", "hand cream", "foot cream", "eye cream", "night cream", "day cream", "cold cream", "body cream", "fairness cream", "shaving cream",
  "body lotion", "face lotion", "hand lotion", "baby lotion", "sun lotion",
  "hair oil", "hair gel", "hair cream", "hair serum", "hair mask", "hair spray", "hair colour", "hair wax", "hair pack", "hair removal",
  "face serum", "face pack", "face mask", "face scrub", "face powder", "face mist", "face toner", "body scrub", "body butter", "body spray", "body mist", "foot scrub",
  "lip balm", "lip gloss", "lip care", "lip liner", "lip stick",
  "sun screen", "sun block", "tooth paste", "tooth brush", "tooth powder", "shower gel", "bath soap", "hand sanitizer", "nail polish", "nail paint",
  "talcum powder", "baby powder", "baby oil", "baby soap", "baby shampoo", "baby wash", "eye liner", "eye shadow", "eye makeup", "make up", "after shave", "shaving foam", "room freshener",
  "washing powder", "washing liquid", "dish soap", "fabric softener", "toilet cleaner", "glass cleaner", "ice cream", "soft drink", "cold drink", "energy drink", "cooking oil", "ear phones", "head phones", "smart phone", "smart watch", "power bank",
];
// Single-word product types — used to tell one category from another (a face wash is not a shampoo).
// (only words that cannot be part of another product's name: "tea", "scrub" or "serum" are left out — "Tea Tree Face Wash")
const SINGLES = ["shampoo", "conditioner", "soap", "deodorant", "perfume", "moisturiser", "sunscreen", "lotion", "kajal", "lipstick", "toothpaste", "mascara", "detergent", "noodles", "biscuit", "shoes", "sandals", "jeans", "laptop", "earbuds", "headphones"];

const SPELLING = { moisturizer: "moisturiser", moisturizers: "moisturiser", moisturisers: "moisturiser", color: "colour", colors: "colours", sanitiser: "sanitizer", lipstic: "lipstick", sunscreen: "sun screen", toothpaste: "tooth paste", makeup: "make up", earphones: "ear phones", headphones: "head phones", smartphone: "smart phone", smartwatch: "smart watch", powerbank: "power bank", icecream: "ice cream" };
/** @type {Record<string, string>} joined form → spaced canonical form */
const JOINED = Object.fromEntries(PHRASES.map((p) => [p.replace(/ /g, ""), p]));

// Words that mean the same category (kept deliberately small — a wrong synonym lists another product type)
const SYNONYMS = { "face wash": ["face cleanser", "facial cleanser", "facial wash"], "tooth paste": ["tooth gel"], "body wash": ["shower gel"], "shower gel": ["body wash"], "sun screen": ["sun block", "sun lotion"], "hair oil": ["hair tonic"], "lip balm": ["lip care"] };

const base = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Singular of a word: shoes → shoe, washes → wash, oils → oil, cherries → cherry. */
export const singular = (w) => w.length <= 3 ? w : /(?:sh|ch|x|ss|z)es$/.test(w) ? w.slice(0, -2) : /[^aeiou]ies$/.test(w) ? w.slice(0, -3) + "y" : /ss$|us$|is$/.test(w) ? w : /s$/.test(w) ? w.slice(0, -1) : w;

/**
 * Lower-case, punctuation to single spaces, and every compound or spaced spelling turned into the canonical spaced one:
 * "Facewash", "face-wash", "FACE WASH" → "face wash"; "bodylotion" → "body lotion"; "moisturizer" → "moisturiser".
 * @param {string} s @returns {string}
 */
export function foldKey(s) {
  const out = [];
  for (const w of base(s).split(" ")) { if (!w) continue; const j = JOINED[w] || JOINED[singular(w)]; out.push(SPELLING[w] || (j ? j : w)); }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** The canonical words of a text, each in its singular form. @param {string} s @returns {string[]} */
export const termTokens = (s) => foldKey(s).split(" ").filter(Boolean).map(singular);

const phraseTokens = (p) => termTokens(p);
const hasRun = (tokens, run) => run.length > 0 && tokens.some((_, i) => run.every((w, k) => tokens[i + k] === w));

/**
 * What kind of product was typed: the vocabulary phrases found in it ("face wash"), their synonyms, and — when the vocabulary
 * knows nothing about it ("running shoes") — its last word as the head noun.
 * @param {string} product @returns {{ phrases: string[], variants: string[][], words: Set<string>, others: string[], any: boolean }}
 */
export function categoryOf(product) {
  const t = termTokens(product);
  const all = [...PHRASES, ...SINGLES.map((s) => foldKey(s))];
  const found = [...new Set(all.map((p) => foldKey(p)))].filter((p) => hasRun(t, phraseTokens(p)));
  // a phrase inside a longer found phrase ("sun screen" inside nothing; "tooth paste" vs "paste") is dropped; the longest wins
  const phrases = found.filter((p) => !found.some((q) => q !== p && q.includes(p) && q.length > p.length));
  const variants = [];
  for (const p of phrases) { variants.push(phraseTokens(p)); for (const syn of SYNONYMS[p] || []) variants.push(phraseTokens(syn)); }
  if (!variants.length && t.length) variants.push([t[t.length - 1]]);   // head noun
  const words = new Set(variants.flat());
  return { phrases, variants, words, others: all.map((p) => foldKey(p)).filter((p) => !phrases.includes(p)), any: variants.length > 0 };
}

/** Does this text name the category (its phrase, a synonym, or the head noun)? @param {string} text @param {ReturnType<typeof categoryOf>} cat */
export function mentionsCategory(text, cat) {
  const t = termTokens(text);
  return cat.variants.some((v) => hasRun(t, v));
}

/**
 * The OTHER product types a text names ("Neem Face Wash and Shampoo Combo" names a shampoo besides the face wash) — a bundle of
 * several categories is not one product of the category asked for.
 * @param {string} text @param {ReturnType<typeof categoryOf>} cat @returns {string[]}
 */
export function otherCategories(text, cat) {
  const t = termTokens(text);
  const mine = cat.variants.map((v) => v.join(" "));
  return [...new Set(cat.others)].filter((p) => {
    const run = phraseTokens(p);
    if (!hasRun(t, run) || mine.some((m) => m.includes(run.join(" ")) || run.join(" ").includes(m))) return false;
    // a single-word type that is part of one of my own words ("wash" in "face wash") is not another category
    return !(run.length === 1 && cat.words.has(run[0]));
  });
}
