// 2-in-1 ads: the pictures and words of the product panel (the part of the 9:16 unit under the 16:9 video).
// Reuses the In-Image studio's product-picture machinery — online picture search, the AI's picture classes, the
// cut-out tool (cutout.py) and the "exactly this product" check — and its copy rules (a short headline and subline,
// a button from the studio's list, no invented offers or claims). If no product picture passes its check the panel is
// a brand panel (logo, colours, words) — never an unchecked picture.
import fs from "node:fs";
import path from "node:path";
import { imageSearch, downloadImage, brandHost } from "./websearch.mjs";
import { PICK_SCHEMA, productCandidates, tryProductPictures, bingLarge, foreignSite, ctaFor, words, withRealName } from "./studio.mjs";
import { brandBrief } from "./brands.mjs";
import { withTimeout } from "./reader.mjs";
import { sha256 } from "./text.mjs";
import { contrast } from "./twoinone-preview.mjs";

const VERIFY_SCHEMA = { type: "object", additionalProperties: false, required: ["ok", "problem", "kind", "logo_ok", "logo_problem"], properties: {
  ok: { type: "boolean" }, problem: { type: "string" }, kind: { type: "string", enum: ["cutout", "product_on_background", "lifestyle", "promo_banner", "irrelevant"] }, logo_ok: { type: "boolean" }, logo_problem: { type: "string" } } };
const COPY_SCHEMA = (ctas) => ({ type: "object", additionalProperties: false, required: ["headline", "subline", "cta", "category", "highlights", "opener"], properties: { opener: { type: "string" }, headline: { type: "string" }, subline: { type: "string" }, highlights: { type: "array", items: { type: "string" } }, cta: { type: "string", enum: ctas }, category: { type: "string" } } });
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The studio's copy rule, enforced on the words themselves: nothing after a superlative, a price word or an offer word survives,
 * and what is left never ends on a dash or a connector ("Discover Airtel Postpaid Plans - Best" → "Discover Airtel Postpaid Plans").
 * @param {string} text @returns {string}
 */
export function cleanCopy(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  const m = /\b(best|no\.? ?1|number one|#1|cheapest|lowest|guarantee[sd]?|free|offers?|discounts?|cashback|save|savings?|only)\b/i.exec(t);
  if (m) t = t.slice(0, m.index);
  t = t.replace(/[\s\-–—:,;&|+/]+$/, "");
  while (/\s(and|with|for|the|a|an|of|to|in|on|at|by|your|our|from|or)$/i.test(t)) t = t.replace(/\s\S+$/, "").replace(/[\s\-–—:,;&|+/]+$/, "");
  return t.split(" ").filter(Boolean).length >= 2 ? t : "";
}

/**
 * What the brand's recent ad is about, as a search phrase for pictures of that very product: the ad's title without the brand, the
 * filler (official, TVC, new, launch …) and anything after a separator. "" when nothing useful is left.
 * @param {string} title @param {string} brand @returns {string}
 */
export function adQuery(title, brand) {
  const first = String(title || "").split(/[|–—:]|\s-\s/)[0];
  const drop = new RegExp(`\\b(official|tvc|ad film|ads?|commercial|new|introducing|ft\\.?|launch(ed|es)?|film|full|hd|video|presents?|\\d+\\s?sec(onds)?|${String(brand || "").split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "$^"})\\b`, "gi");
  const t = first.replace(drop, " ").replace(/[^\p{L}\p{N}+ ]+/gu, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  return t.length >= 3 ? t : "";
}

const key = (s) => String(s || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/**
 * The panel's chips: up to three short NAMES (a product line, a service) — never a claim, price, offer or number. Each name the AI
 * proposes must appear in what it was given (the typed product, the ad's title and description, the brand facts); the rest are dropped.
 * If none survive, the brand's known product names (brand knowledge), else the product as typed.
 * @param {string[]} proposed @param {string} source @param {string[]} [known] @param {string} [typed]
 */
export function keepHighlights(proposed, source, known = [], typed = "", brand = "") {
  const hay = ` ${key(source)} `, seen = new Set(), out = /** @type {string[]} */ ([]);
  const ok = (n) => { const k = key(n); return n && n.length <= 26 && !/\d/.test(n) && k.length >= 3 && k !== key(brand) && ![...seen].some((x) => x.includes(k) || k.includes(x)) && (seen.add(k), true); };   // not the brand's own name, and no chip inside another
  for (const n of proposed || []) if (ok(String(n).trim()) && hay.includes(` ${key(n)} `)) out.push(String(n).trim());
  if (!out.length) for (const n of known) if (out.length < 3 && ok(String(n).trim())) out.push(String(n).trim());
  if (!out.length && typed && typed.length <= 26) out.push(typed.trim());
  return out.slice(0, 3);
}

/**
 * @param {{ brand: string, product: string, known?: any, studio: any, ask: Function, py: (a: string[]) => Promise<string>, ffmpeg: (a: string[]) => Promise<any>, fetchImpl?: any, workDir: string,
 *   video?: { title?: string, [k: string]: any }, say?: (m: string) => void, budgetMs?: number, heroFile?: string|null, campaigns?: string[] }} o
 * @returns {Promise<{ logoInk: string|null, highlights: string[], hero: string|null, product: string|null, logo: string|null, colour: string|null, accent: string|null, copy: { headline: string, subline: string, cta: string }, productInfo: any, logoInfo: any, flags: string[], checks: any[] }>}
 */
export async function preparePanel(o) {
  const { brand, product, known = null, studio, ask, py, ffmpeg, workDir } = o, fetchImpl = o.fetchImpl || globalThis.fetch, say = o.say || (() => {}), flags = /** @type {string[]} */ ([]);
  const assets = path.join(workDir, "assets"), cand = path.join(assets, "cand"), checkDir = path.join(assets, "checks");
  for (const d of [assets, cand, checkDir]) fs.mkdirSync(d, { recursive: true });
  const t0 = Date.now(), left = () => (o.budgetMs || 90000) - (Date.now() - t0);
  const official = (h) => !!h && (brandHost(h, brand) || (known?.domains || []).some((d) => { const x = d.replace(/^www\./, ""); return h === x || h.endsWith("." + x); }));
  const shop = (list, h) => list.some((d) => h === d || h.endsWith("." + d));
  const where = (h) => shop(studio.product.foreignShops, h) || foreignSite(h) ? -1 : official(h) ? 3 : shop(studio.product.indianShops, h) || /\.in$/.test(h) ? 2 : 0;
  say(`Looking for ${brand} ${product} pictures and the logo…`);
  // the brand's recent campaign is the reference: pictures of the product that campaign shows come first
  const extra = adQuery(o.video?.title || "", brand), sameAs = (q) => key(q) === key(`${brand} ${product}`);
  const [web, webIn, webClear, webLogos, webAd] = await Promise.all([
    imageSearch(`${brand} ${product}`, { fetchImpl }).catch(() => []), imageSearch(`${brand} ${product} India`, { fetchImpl }).catch(() => []),
    imageSearch(`${brand} ${product}`, { fetchImpl, transparent: true }).catch(() => []), imageSearch(`${brand} logo png`, { fetchImpl }).catch(() => []),
    extra && !sameAs(`${brand} ${extra}`) ? imageSearch(`${brand} ${extra}`, { fetchImpl }).catch(() => []) : Promise.resolve([]) ]);
  const seen = new Set(), products = [];
  for (const x of [...webAd, ...web, ...webIn, ...webClear].map((x, i) => ({ x, i, w: where(x.host) })).filter((r) => r.w >= 0).sort((a, b) => b.w - a.w || a.i - b.i).map((r) => r.x)) if (!seen.has(x.url) && x.thumb) { seen.add(x.url); products.push(x); }
  const researched = known?.logo?.png ? [{ url: known.logo.png, thumb: known.logo.png, page: known.logo.file || known.logo.png, host: "upload.wikimedia.org", title: `${known.name} official logo (MediaKart brand knowledge)` }] : [];
  const logos = [...researched, ...webLogos.filter((x) => x.thumb).slice(0, 5)].slice(0, 6);
  if (!products.length) flags.push(`No pictures of “${brand} ${product}” were found online — the panel is a brand panel.`);

  // small copies for the AI (JPEG / PNG only; WebP converted)
  const thumbs = async (list, pre, n) => (await Promise.all(list.slice(0, n).map(async (x, i) => {
    let f = await downloadImage(x.thumb, path.join(cand, `${pre}${i + 1}`), { fetchImpl, fs }).catch(() => null);
    if (f && f.endsWith(".webp")) { const png = f.replace(/\.webp$/, ".png"); f = await ffmpeg(["-loglevel", "error", "-y", "-i", f, png]).then(() => png, () => null); }
    return f && /\.(jpg|png)$/.test(f) ? { ...x, file: f, n: i + 1 } : null; }))).filter(Boolean);
  const [pT, lT] = await Promise.all([thumbs(products, "p", 10), thumbs(logos, "l", 6)]);
  // a frame of the brand's recent ad, shown to the AI as the reference for how the product looks TODAY (never used as a picture here)
  let refFile = null;
  if (o.heroFile && fs.existsSync(o.heroFile)) { refFile = o.heroFile; if (/\.webp$/i.test(refFile)) { const png = path.join(cand, "ref.png"); refFile = await ffmpeg(["-loglevel", "error", "-y", "-i", refFile, png]).then(() => png, () => null); } }
  const campaignLine = [o.campaigns?.length ? `The brand's recent campaigns (reported on dated trade-press pages): ${o.campaigns.join("; ")}.` : "", o.video?.title ? `Its recent video ad is titled “${o.video.title}”${refFile ? " — R1 is a frame from it" : ""}.` : ""].filter(Boolean).join(" ");
  const brief = known ? brandBrief(known) : "";
  const service = /deliver|airline|flight|travel|booking|\bstays?\b|hotel|streaming|\bapps?\b|assistant|bank|insurance|telecom|ride|cab|loan|credit|finance|fintech/i.test(`${known?.category || ""} ${product}`);

  // 1) one AI look at every picture: which shows exactly this product, which is the logo, the brand colours
  let pick = null;
  if (pT.length || lT.length) {
    say("Choosing the product picture and the logo…");
    pick = await withTimeout(ask("You prepare assets for a display ad. You only choose among the pictures shown; you never describe a picture you were not shown.",
      `Brand: ${brand}\nProduct: ${product}\n${brief ? brief + "\n" : ""}P pictures are product photos found online (with the page they are on). L pictures are logo candidates.\n` +
      `${campaignLine ? campaignLine + " Choose the P picture that shows the SAME product, model or variant as that campaign (R1 shows how it looks there) — not an older model and not a different product line.\n" : ""}packshot: the number of the P picture that shows EXACTLY this product as sold in India today (right brand, the variant asked for, current design) — 0 if none does. packshot_ranked: every acceptable one, best first. pictures: classify EVERY P picture (kind, and exact = it shows exactly this product). ` +
      `product_name: its name as written on its page. is_service: true for a service / app / bank / telecom plan (no physical pack). logo: the number of the L picture that is ${brand}'s real current logo on its own (never several logos, never another organisation's) — 0 if none. brand_colour and accent_colour as #rrggbb (the brand's own colours, accent contrasting with the main one). style, motif, hook: pick any valid value.`,
      PICK_SCHEMA, [...(refFile ? [{ label: "R1 — a frame from the brand's recent video ad (reference for the product's current look; never choose it as a product picture)", file: refFile }] : []), ...pT.map((x) => ({ label: `P${x.n} — "${x.title}" on ${x.host}`, file: x.file })), ...lT.map((x) => ({ label: `L${x.n} — "${x.title}" on ${x.host}`, file: x.file }))], "medium"), Math.min(60000, left()), "Choosing pictures")
      .catch((e) => { flags.push("The picture choice did not finish (" + String(e.message).slice(0, 100) + ") — brand panel."); return null; });
  }
  const colour = HEX.test(known?.colours?.primary || "") ? known.colours.primary : HEX.test(pick?.brand_colour || "") ? pick.brand_colour : null;
  const accent = HEX.test(known?.colours?.accent || "") ? known.colours.accent : HEX.test(pick?.accent_colour || "") ? pick.accent_colour : null;

  // 2) the logo file (background keyed out) and the product picture (cut out), each checked before use
  let logoFile = null, /** @type {any} */ logoInfo = null, productFile = null, productInfo = null, checks = [], logoRev = null, logoInk = null;
  const lx = lT.find((x) => x.n === pick?.logo);
  if (lx) {
    let f = await downloadImage(lx.url, path.join(assets, "logo"), { fetchImpl, fs }).catch(() => null);
    if (!f && bingLarge(lx.thumb, 600)) f = await downloadImage(bingLarge(lx.thumb, 600), path.join(assets, "logo"), { fetchImpl, fs }).catch(() => null);
    if (f) {
      await py(["trim_logo.py", f]).catch(() => {});
      const lg = await py(["cutout.py", "logo", f, path.join(assets, "logo_clean.png")]).then((t) => JSON.parse(t.trim().split(/\r?\n/).pop())).catch(() => null);
      if (lg) { logoFile = path.join(assets, "logo_clean.png"); logoRev = lg.reverse && fs.existsSync(lg.reverse) ? lg.reverse : null; logoInk = typeof lg.ink === "string" && HEX.test(lg.ink) ? lg.ink : Array.isArray(lg.ink) ? "#" + lg.ink.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") : null; logoInfo = { url: lx.url, page: lx.page, site: lx.host, title: lx.title, kind: lg.kind, ink: lg.ink, light: lg.light }; }
    }
  }
  let logoChecked = !logoFile;
  const candidates = pick ? productCandidates(pick, pT, { lifestyleOk: service }) : [];
  if (candidates.length && left() > 25000) {
    say(`Checking ${Math.min(candidates.length, 4)} product picture(s)…`);
    const fetched = await Promise.all(candidates.slice(0, 4).map(async (x, i) => {
      let f = await downloadImage(x.url, path.join(assets, `product_src${i}`), { fetchImpl, fs }).catch(() => null);
      if (!f && bingLarge(x.thumb, 900)) f = await downloadImage(bingLarge(x.thumb, 900), path.join(assets, `product_src${i}b`), { fetchImpl, fs }).catch(() => null);
      return { x, f, idx: i, hash: f ? sha256(fs.readFileSync(f).toString("base64")) : null };
    }));
    const tried = await tryProductPictures(fetched, { maxTries: 4, outOfTime: () => left() < 15000,
      prepare: async (got, mode) => {
        const out = path.join(assets, "product.png"), c = JSON.parse((await py(["cutout.py", "product", got.f, out, ...(mode === "photo" ? ["--photo"] : [])])).trim().split("\n").pop());
        const pv = path.join(checkDir, `product_${got.idx}_${mode}.jpg`); await py(["cutout.py", "preview", out, pv]);
        return { ...c, previewFile: pv, preview: path.relative(workDir, pv).replace(/\\/g, "/") };
      },
      check: async (got, c) => {
        if (c.method === "photo" && (c.clear || 0) > 0.3) return { ok: false, kind: "promo_banner", problem: "a graphic on a transparent background, not a photograph" };
        const imgs = [{ label: "PRODUCT PICTURE to check (grey checkerboard = transparent)", file: c.previewFile }];
        let lpv = null; if (!logoChecked && logoFile) { lpv = path.join(checkDir, "logo.jpg"); await py(["cutout.py", "preview", logoFile, lpv]); imgs.push({ label: "LOGO PNG to check", file: lpv }); }
        const v = await withTimeout(ask("You check the finished pictures of a display ad before it is published. Judge only what you see.",
          `Ad for ${brand} — ${pick.product_name || product} (asked for: "${product}"), as sold in India. ok only if exactly this product (right brand, the variant asked for, current pack) is clearly the main subject, complete, not cut off or damaged` +
          `${service ? "; for a service, ONE appealing photo of what it gives people also passes" : ""}. Never ok: banner, headline, offer or price text over the picture; people or models as the focus; other brands' products; a watermark; a collage; illustrated or 3D-rendered decoration art. ` +
          `A background or simple props around the product are fine when the original photo is shown. kind: what the picture is.${lpv ? `\nLOGO PNG: logo_ok only if it is ${brand}'s own logo, complete and legible, and nothing else.` : " logo_ok: true, logo_problem: \"\"."}`,
          VERIFY_SCHEMA, imgs, "medium"), 45000, "Checking the picture").catch((e) => ({ ok: false, kind: got.x.kind, problem: "the check could not run: " + e.message, logo_ok: false, logo_problem: "" }));
        if (lpv) { logoChecked = true; if (!v.logo_ok) { flags.push(`Logo not used — ${v.logo_problem || "the logo check failed"}.`); logoFile = null; logoInfo = null; } }
        return v;
      } });
    checks = tried.checks;
    if (tried.got) { productFile = path.join(assets, "product.png"); productInfo = { url: tried.got.x.url, page: tried.got.x.page, site: tried.got.x.host, title: tried.got.x.title, kind: tried.v.kind || tried.got.x.kind, method: tried.c.method, name: pick.product_name || product }; }
    else flags.push("No product picture passed the check — the panel is a brand panel.");
  }
  if (logoFile && !logoChecked) { logoFile = null; logoInfo = null; flags.push("Logo not used — it could not be checked."); }

  // a logo in the same colour as the panel would vanish: the all-white version is used when it stands out better
  if (logoFile && logoRev && logoInk && contrast(logoInk, colour || "#101828") < 3) { logoFile = logoRev; if (logoInfo) logoInfo.reversed = true; }

  // 3) the words: a short headline and subline, the button — no invented offers, prices or claims
  say("Writing the panel copy…");
  const ctas = studio.copy.ctas;
  const typed = product, found = pick?.product_name || "";
  const plan = await withTimeout(ask("You write the short copy of a display panel for an Indian brand's video ad. You write only what is safe: no offers, discounts, prices, numbers, awards or claims that were not given to you.",
    `Brand: ${brand}\nProduct: ${product}\n${brief ? brief + "\n" : ""}${o.video?.title ? `The brand's own video ad is titled: “${o.video.title}”.\n` : ""}Headline at most ${studio.copy.maxHeadlineWords} words; subline at most ${studio.copy.maxSublineWords} words, naming the product; cta from the list. ${studio.copy.noClaims} No superlatives like "best" or "No.1". Use the brand's OWN words and text theme: its tagline or campaign line (from the video title or the brief above) spelled and capitalised exactly as the brand writes it, in its own mix of English and Hindi (Hinglish) and its tone — never a generic line when the brand has its own. opener: a 2 to 5 word scene-setting line for the first seconds of the ad that leads straight into the headline (e.g. “Midnight cravings?” before “Crunch it.”), in the brand's own voice, no claim, offer or number. category: the product's category in two words. highlights: up to 3 short NAMES (1-3 words each) of the brand's real product lines or services that are named in the information above — the ad title, the product typed or the brand facts — and [] if none is; never a claim, a price, an offer or a number.`,
    COPY_SCHEMA(ctas), [], "medium"), Math.max(15000, Math.min(40000, left())), "Panel copy").catch((e) => { flags.push("Copy could not be written (" + String(e.message).slice(0, 80) + ") — the panel shows the brand and product name only."); return null; });
  const named = (t) => service ? t : withRealName(t, typed, found, brand);
  const highlights = keepHighlights(plan?.highlights || [], `${product} ${o.video?.title || ""} ${o.video?.description || ""} ${brief}`, known?.products || [], product, brand);
  const button = ctaFor({ rules: studio.copy.ctaRules, ctas, known, product, aiCategory: plan?.category || "", aiCta: plan?.cta || "" });
  const copy = plan ? { headline: cleanCopy(words(named(plan.headline), studio.copy.maxHeadlineWords)), subline: cleanCopy(words(named(plan.subline), studio.copy.maxSublineWords)), opener: cleanCopy(words(plan.opener || "", 5)), cta: button.cta } : { headline: "", subline: "", opener: "", cta: button.cta };
  // no checked product picture: a frame of the brand's own video ad is the visual (its key visual, not a made-up one)
  const hero = null;   // never a frame or thumbnail of the video in place of the product: the panel then animates the brand (logo, colours, copy) and says no product picture passed
  if (!productFile) flags.push("No product picture passed its check — the panel animates the brand only; upload the pack photo to get the product animation.");
  return { style: pick?.style || null, logoInk: logoFile ? logoInk : null, highlights, hero, product: productFile, logo: logoFile, colour, accent, copy, productInfo, logoInfo, flags, checks };
}
