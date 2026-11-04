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
import { discoverProducts } from "./discover-products.mjs";

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

/** An AI error that means no AI can look at a picture right now (quota spent, no key, every model busy). */
export const AI_DOWN = /quota|\b429\b|RESOURCE_EXHAUSTED|No AI key|Gemini is busy/i;
export const NOT_AI_CHECKED = "picture not AI-checked (AI quota) — verify";
const STOPW = new Set(["and", "the", "for", "with", "sauces", "products", "range", "instant"]);
/** the title names the brand and the product (or its category): a word of each, by stem */
export function titleNames(title, brand, product, category = "") {
  const t = ` ${key(title)} `, b = key(brand);
  if (!b || !t.includes(` ${b}`)) return false;
  const ws = key(`${product} ${category}`).split(" ").filter((w) => w.length >= 4 && !STOPW.has(w) && w !== b);
  return ws.some((w) => t.includes(" " + w.slice(0, Math.max(4, w.length - 2))));
}
/**
 * The rule that stands in for the AI picture check when no AI can run: a product picture from the brand's official site or a
 * known Indian shop, whose title names the brand and the product or category, cut out successfully, at least 400 px on its longest side.
 * @param {{ host: string, title: string, brand: string, product: string, category?: string, official: (h: string) => boolean, indianShops: string[], cut: any }} o
 * @returns {{ ok: boolean, problem: string }}
 */
export function ruleProductOk({ host, title, brand, product, category = "", official, indianShops, cut }) {
  const h = String(host || "").replace(/^www\./, "");
  if (!(official(h) || (indianShops || []).some((d) => h === d || h.endsWith("." + d)))) return { ok: false, problem: `${h || "the site"} is neither the brand's site nor a known Indian shop` };
  if (!titleNames(title, brand, product, category)) return { ok: false, problem: "its title does not name the brand and the product" };
  if (!cut || !cut.method || cut.method === "photo") return { ok: false, problem: "the cut-out did not succeed" };
  if (Math.max(+cut.w || 0, +cut.h || 0) < 400) return { ok: false, problem: "smaller than 400 px" };
  return { ok: true, problem: "" };
}
/**
 * The logo rule when no AI can run: only the brand-knowledge logo, or a Wikimedia Commons file named after the brand.
 * @param {{ url: string, title?: string, host?: string }} x @param {string} brand @param {any} known
 */
export function ruleLogoOk(x, brand, known) {
  if (!x?.url) return false;
  if (known?.logo?.png && x.url === known.logo.png) return true;
  let h = ""; try { h = new URL(x.url).host; } catch { return false; }
  const b = key(brand).replace(/ /g, "");
  return /(^|\.)(upload|commons)\.wikimedia\.org$/.test(h) && !!b && key(`${x.title || ""} ${decodeURIComponent(x.url)}`).replace(/ /g, "").includes(b);
}
/** a logo file on Wikimedia Commons whose name holds the brand's name and "logo" (as a 600 px PNG), or null */
export async function commonsLogo(brand, fetchImpl = globalThis.fetch) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url&iiurlwidth=600&gsrsearch=${encodeURIComponent(`${brand} logo`)}`;
  const j = await fetchImpl(u, { headers: { "User-Agent": "ContextualAdStudio/1.0 (Mediakart demo tool)" }, signal: AbortSignal.timeout(12000) }).then((r) => r.json()).catch(() => null);
  const b = key(brand).replace(/ /g, "");
  const pages = Object.values(j?.query?.pages || {}).sort((a, c) => (a.index || 0) - (c.index || 0));
  for (const p of pages) {
    // the file's name minus "File:", "logo", "new", a year and the extension must be the brand itself ("Philips logo new.svg",
    // not "Logo Philips Classics.png" — another logo)
    const rest = key(String(p.title).replace(/^File:/i, "").replace(/\.(svg|png|jpe?g|gif)$/i, "")).split(" ").filter((w) => !/^(logo|logos|new|official|wordmark|\d{4}|svg|png)$/.test(w)).join("");
    const ii = p.imageinfo?.[0];
    if (b && rest === b && ii) { const url = String(ii.thumburl || ii.url).replace(/\?.*$/, ""); if (/\.(png|jpe?g)$/i.test(url)) return { url, thumb: url, page: ii.descriptionurl || url, host: new URL(url).host, title: p.title }; }
  }
  return null;
}
/** a short caption from a product name: the part before a comma or bar, at most five words */
export const rangeName = (n) => words(String(n || "").split(/[,|(–—]/)[0].trim(), 5);

/**
 * @param {{ brand: string, product: string, known?: any, studio: any, ask: Function, py: (a: string[]) => Promise<string>, ffmpeg: (a: string[]) => Promise<any>, fetchImpl?: any, workDir: string,
 *   video?: { title?: string, [k: string]: any }, say?: (m: string) => void, budgetMs?: number, heroFile?: string|null, campaigns?: string[], productImage?: string, productThumb?: string }} o
 * @returns {Promise<{ range?: { name: string, file: string }[], category?: string|null, style?: string|null, logoInk: string|null, highlights: string[], hero: string|null, product: string|null, logo: string|null, colour: string|null, accent: string|null, copy: { headline: string, subline: string, cta: string }, productInfo: any, logoInfo: any, flags: string[], checks: any[] }>}
 */
export async function preparePanel(o) {
  const { brand, product, known = null, studio, ask, py, ffmpeg, workDir } = o, fetchImpl = o.fetchImpl || globalThis.fetch, say = o.say || (() => {}), flags = /** @type {string[]} */ ([]);
  const assets = path.join(workDir, "assets"), cand = path.join(assets, "cand"), checkDir = path.join(assets, "checks");
  for (const d of [assets, cand, checkDir]) fs.mkdirSync(d, { recursive: true });
  const t0 = Date.now(), left = () => (o.budgetMs || 90000) - (Date.now() - t0);
  // the exact product photo (a https link, e.g. picked from the product list): used instead of the searched pictures — still cut out and checked
  const userPic = /^https:\/\//i.test(String(o.productImage || "").trim()) ? String(o.productImage).trim() : "";
  const official = (h) => !!h && (brandHost(h, brand) || (known?.domains || []).some((d) => { const x = d.replace(/^www\./, ""); return h === x || h.endsWith("." + x); }));
  const shop = (list, h) => list.some((d) => h === d || h.endsWith("." + d));
  const where = (h) => shop(studio.product.foreignShops, h) || foreignSite(h) ? -1 : official(h) ? 3 : shop(studio.product.indianShops, h) || /\.in$/.test(h) ? 2 : 0;
  say(`Looking for ${brand} ${product} pictures and the logo…`);
  // the brand's recent campaign is the reference: pictures of the product that campaign shows come first
  const extra = adQuery(o.video?.title || "", brand), sameAs = (q) => key(q) === key(`${brand} ${product}`);
  const [web, webIn, webClear, webLogos, webAd] = await Promise.all([
    imageSearch(`"${brand}" ${product}`, { fetchImpl }).catch(() => []), imageSearch(`"${brand}" ${product} India`, { fetchImpl }).catch(() => []),
    imageSearch(`"${brand}" ${product}`, { fetchImpl, transparent: true }).catch(() => []), imageSearch(`"${brand}" logo png`, { fetchImpl }).catch(() => []),
    extra && !sameAs(`${brand} ${extra}`) ? imageSearch(`${brand} ${extra}`, { fetchImpl }).catch(() => []) : Promise.resolve([]) ]);
  const seen = new Set(), products = [];
  for (const x of [...webAd, ...web, ...webIn, ...webClear].map((x, i) => ({ x, i, w: where(x.host) })).filter((r) => r.w >= 0).sort((a, b) => b.w - a.w || a.i - b.i).map((r) => r.x)) if (!seen.has(x.url) && x.thumb) { seen.add(x.url); products.push(x); }
  const researched = known?.logo?.png ? [{ url: known.logo.png, thumb: known.logo.png, page: known.logo.file || known.logo.png, host: "upload.wikimedia.org", title: `${known.name} official logo (MediaKart brand knowledge)` }] : [];
  const logos = [...researched, ...webLogos.filter((x) => x.thumb).slice(0, 5)].slice(0, 6);
  if (!products.length && !userPic) flags.push(`No pictures of “${brand} ${product}” were found online — the panel is a brand panel.`);

  // small copies for the AI (JPEG / PNG only; WebP converted)
  const thumbs = async (list, pre, n) => (await Promise.all(list.slice(0, n).map(async (x, i) => {
    let f = await downloadImage(x.thumb, path.join(cand, `${pre}${i + 1}`), { fetchImpl, fs }).catch(() => null);
    if (f && f.endsWith(".webp")) { const png = f.replace(/\.webp$/, ".png"); f = await ffmpeg(["-loglevel", "error", "-y", "-i", f, png]).then(() => png, () => null); }
    return f && /\.(jpg|png)$/.test(f) ? { ...x, file: f, n: i + 1 } : null; }))).filter(Boolean);
  const [pT, lT] = await Promise.all([thumbs(userPic ? [] : products, "p", 10), thumbs(logos, "l", 6)]);   // a photo link from the user replaces the searched product pictures
  // a frame of the brand's recent ad, shown to the AI as the reference for how the product looks TODAY (never used as a picture here)
  let refFile = null;
  if (o.heroFile && fs.existsSync(o.heroFile)) { refFile = o.heroFile; if (/\.webp$/i.test(refFile)) { const png = path.join(cand, "ref.png"); refFile = await ffmpeg(["-loglevel", "error", "-y", "-i", refFile, png]).then(() => png, () => null); } }
  const campaignLine = [o.campaigns?.length ? `The brand's recent campaigns (reported on dated trade-press pages): ${o.campaigns.join("; ")}.` : "", o.video?.title ? `Its recent video ad is titled “${o.video.title}”${refFile ? " — R1 is a frame from it" : ""}.` : ""].filter(Boolean).join(" ");
  const brief = known ? brandBrief(known) : "";
  const service = /deliver|airline|flight|travel|booking|\bstays?\b|hotel|streaming|\bapps?\b|assistant|bank|insurance|telecom|ride|cab|loan|credit|finance|fintech/i.test(`${known?.category || ""} ${product}`);

  // no AI can look at pictures (quota spent): the strict no-AI rules decide, and every such picture is flagged for a person to verify
  let aiDown = false; const down = (e) => { if (AI_DOWN.test(String(e?.message || e))) aiDown = true; };
  const indianShops = studio.product.indianShops || [], category = known?.category || "";
  const ruleOk = (x, c) => ruleProductOk({ host: x.host, title: x.title, brand, product, category, official, indianShops, cut: c });

  // 1) one AI look at every picture: which shows exactly this product, which is the logo, the brand colours
  let pick = null;
  if (pT.length || lT.length) {
    say("Choosing the product picture and the logo…");
    pick = await withTimeout(ask("You prepare assets for a display ad. You only choose among the pictures shown; you never describe a picture you were not shown.",
      `Brand: ${brand}\nProduct: ${product}\n${brief ? brief + "\n" : ""}P pictures are product photos found online (with the page they are on). L pictures are logo candidates.\n` +
      `${campaignLine ? campaignLine + " Choose the P picture that shows the SAME product, model or variant as that campaign (R1 shows how it looks there) — not an older model and not a different product line.\n" : ""}packshot: the number of the P picture that shows EXACTLY this product as sold in India today (right brand, the variant asked for, current design) — 0 if none does. packshot_ranked: every acceptable one, best first. pictures: classify EVERY P picture (kind, and exact = it shows exactly this product). ` +
      `product_name: its name as written on its page. is_service: true for a service / app / bank / telecom plan (no physical pack). logo: the number of the L picture that is ${brand}'s real current logo on its own (never several logos, never another organisation's) — 0 if none. brand_colour and accent_colour as #rrggbb (the brand's own colours, accent contrasting with the main one). style, motif, hook: pick any valid value.`,
      PICK_SCHEMA, [...(refFile ? [{ label: "R1 — a frame from the brand's recent video ad (reference for the product's current look; never choose it as a product picture)", file: refFile }] : []), ...pT.map((x) => ({ label: `P${x.n} — "${x.title}" on ${x.host}`, file: x.file })), ...lT.map((x) => ({ label: `L${x.n} — "${x.title}" on ${x.host}`, file: x.file }))], "medium"), Math.min(60000, left()), "Choosing pictures")
      .catch((e) => { down(e); flags.push("The picture choice did not finish (" + String(e.message).slice(0, 100) + ")" + (aiDown ? " — pictures are chosen by the no-AI rules." : " — brand panel.")); return null; });
  }
  const colour = HEX.test(known?.colours?.primary || "") ? known.colours.primary : HEX.test(pick?.brand_colour || "") ? pick.brand_colour : null;
  const accent = HEX.test(known?.colours?.accent || "") ? known.colours.accent : HEX.test(pick?.accent_colour || "") ? pick.accent_colour : null;

  // 2) the logo file (background keyed out) and the product picture (cut out), each checked before use
  let logoFile = null, /** @type {any} */ logoInfo = null, productFile = null, /** @type {any} */ productInfo = null, checks = [], logoRev = null, logoInk = null;
  const loadLogo = async (lx) => {
    let f = await downloadImage(lx.url, path.join(assets, "logo"), { fetchImpl, fs }).catch(() => null);
    if (!f && bingLarge(lx.thumb, 600)) f = await downloadImage(bingLarge(lx.thumb, 600), path.join(assets, "logo"), { fetchImpl, fs }).catch(() => null);
    if (!f) return false;
    await py(["trim_logo.py", f]).catch(() => {});
    const lg = await py(["cutout.py", "logo", f, path.join(assets, "logo_clean.png")]).then((t) => JSON.parse(t.trim().split(/\r?\n/).pop())).catch(() => null);
    if (!lg) return false;
    logoFile = path.join(assets, "logo_clean.png"); logoRev = lg.reverse && fs.existsSync(lg.reverse) ? lg.reverse : null; logoInk = typeof lg.ink === "string" && HEX.test(lg.ink) ? lg.ink : Array.isArray(lg.ink) ? "#" + lg.ink.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") : null; logoInfo = { url: lx.url, page: lx.page, site: lx.host, title: lx.title, kind: lg.kind, ink: lg.ink, light: lg.light };
    return true;
  };
  const lx = lT.find((x) => x.n === pick?.logo);
  if (researched[0]) await loadLogo(researched[0]);
  if (!logoFile) { const alt = await commonsLogo(brand, fetchImpl).catch(() => null); if (alt) await loadLogo(alt); }
  if (!logoFile && lx) await loadLogo(lx);
  let logoChecked = !logoFile;
  let candidates = pick ? productCandidates(pick, pT, { lifestyleOk: service }) : [];
  // the AI found no picture of the campaign's exact variant: the brand's regular packs of this product (title names brand and product)
  // still go to the final picture check, which asks for the product as typed
  let loose = false; const pname = () => (loose ? "" : pick?.product_name || "");   // a regular pack is never given the campaign variant's name
  if (pick && !candidates.length && Array.isArray(pick.pictures)) {
    loose = true;
    candidates = pick.pictures.filter((p) => p.kind === "cutout" || p.kind === "product_on_background").map((p) => ({ ...pT.find((t) => t.n === p.n), kind: p.kind }))
      .filter((x) => x.url && titleNames(x.title, brand, product, category)).slice(0, 4);
  }
  // no AI answer at all: only pictures the no-AI rule can accept are tried (official site / Indian shop, title names the product)
  if (!pick && aiDown && !userPic) candidates = pT.filter((x) => where(x.host) >= 2 && ruleOk(x, { method: "plain-bg", w: 9999 }).ok).map((x) => ({ ...x, kind: "product_on_background" })).slice(0, 4);
  if (userPic) {
    let host = ""; try { host = new URL(userPic).host.replace(/^www\./, ""); } catch { /* an unusable link: no picture */ }
    candidates = host ? [{ url: userPic, page: userPic, host, title: "photo link given by the user", n: -1, user: true, kind: "product_on_background", thumb: o.productThumb || null }] : [];
  }
  if (candidates.length && left() > 25000) {
    say(`Checking ${Math.min(candidates.length, 4)} product picture(s)…`);
    const fetched = await Promise.all(candidates.slice(0, 4).map(async (x, i) => {
      let f = await downloadImage(x.url, path.join(assets, `product_src${i}`), { fetchImpl, fs }).catch(() => null);
      if (!f && (!x.user || x.thumb) && bingLarge(x.thumb, 900)) f = await downloadImage(bingLarge(x.thumb, 900), path.join(assets, `product_src${i}b`), { fetchImpl, fs }).catch(() => null);
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
        const byRule = () => { const r = ruleOk(got.x, c); return { ok: r.ok, kind: got.x.kind, problem: r.ok ? NOT_AI_CHECKED : "no AI could check it, and " + r.problem }; };
        if (aiDown && !got.x.user) return byRule();
        const imgs = [{ label: "PRODUCT PICTURE to check (grey checkerboard = transparent)", file: c.previewFile }];
        let lpv = null; if (!logoChecked && logoFile) { lpv = path.join(checkDir, "logo.jpg"); await py(["cutout.py", "preview", logoFile, lpv]); imgs.push({ label: "LOGO PNG to check", file: lpv }); }
        const v = await withTimeout(ask("You check the finished pictures of a display ad before it is published. Judge only what you see.",
          `Ad for ${brand} — ${pname() || product} (asked for: "${product}"), as sold in India. ok only if exactly this product (right brand, the variant asked for, current pack) is clearly the main subject, complete, not cut off or damaged` +
          `${service ? "; for a service, ONE appealing photo of what it gives people also passes" : ""}. Never ok: banner, headline, offer or price text over the picture; people or models as the focus; other brands' products; a watermark; a collage; illustrated or 3D-rendered decoration art. ` +
          `A background or simple props around the product are fine when the original photo is shown. kind: what the picture is.${lpv ? `\nLOGO PNG: logo_ok only if it is ${brand}'s own logo, complete and legible, and nothing else.` : " logo_ok: true, logo_problem: \"\"."}`,
          VERIFY_SCHEMA, imgs, "medium"), 45000, "Checking the picture").catch((e) => { down(e); return null; });
        if (!v) return aiDown && !got.x.user ? byRule() : { ok: false, kind: got.x.kind, problem: "the check could not run" };
        if (lpv) { logoChecked = true; if (!v.logo_ok) { flags.push(`Logo not used — ${v.logo_problem || "the logo check failed"}.`); logoFile = null; logoInfo = null; } }
        return v;
      } });
    checks = tried.checks;
    if (tried.got) {
      productFile = path.join(assets, "product.png"); productInfo = { url: tried.got.x.url, page: tried.got.x.page, site: tried.got.x.host, title: tried.got.x.title, kind: tried.v.kind || tried.got.x.kind, method: tried.c.method, name: pname() || (loose ? rangeName(tried.got.x.title) : product) };
      if (tried.v.problem === NOT_AI_CHECKED) { productInfo.aiChecked = false; flags.push(`Product ${NOT_AI_CHECKED}.`); }
    }
    else flags.push("No product picture passed the check — the panel is a brand panel.");
  }
  // the logo was not checked together with a product picture: a check of its own, or (no AI) the logo rule
  if (logoFile && !logoChecked && !aiDown && left() > 12000) {
    const lpv = path.join(checkDir, "logo.jpg"); await py(["cutout.py", "preview", logoFile, lpv]).catch(() => {});
    const v = fs.existsSync(lpv) ? await withTimeout(ask("You check the finished pictures of a display ad before it is published. Judge only what you see.",
      `LOGO PNG: logo_ok only if it is ${brand}'s own logo, complete and legible, and nothing else (grey checkerboard = transparent). ok: true, problem: "", kind: "cutout".`,
      VERIFY_SCHEMA, [{ label: "LOGO PNG to check", file: lpv }], "medium"), 30000, "Checking the logo").catch((e) => { down(e); return null; }) : null;
    if (v) { logoChecked = true; if (!v.logo_ok) { flags.push(`Logo not used — ${v.logo_problem || "the logo check failed"}.`); logoFile = null; logoInfo = null; } }
  }
  if (aiDown && !logoChecked) {
    // no AI: only the brand-knowledge logo or a Commons file named after the brand
    if (!(logoFile && ruleLogoOk(logoInfo, brand, known))) {
      logoFile = null; logoInfo = null;
      const alt = researched[0] || await commonsLogo(brand, fetchImpl).catch(() => null);
      if (alt && ruleLogoOk(alt, brand, known)) await loadLogo(alt);
    }
    if (logoFile) { logoChecked = true; logoInfo.aiChecked = false; flags.push(`Logo ${NOT_AI_CHECKED}.`); }
  }
  if (logoFile && !logoChecked) { logoFile = null; logoInfo = null; flags.push("Logo not used — it could not be checked."); }

  // the range: up to three more real packs of the same brand and category, cut out and checked (the opening shows them as a family)
  let range = /** @type {{ name: string, file: string }[]} */ ([]);
  if (productFile && !service && !userPic && left() > 20000) {
    say("Looking for the rest of the range…");
    range = await productRange({ main: productInfo, mainFile: productFile }).catch(() => []);
  }
  async function productRange({ main, mainFile }) {
    const found = await withTimeout(discoverProducts({ brand, product, fetchImpl, limit: 8, shops: { indian: indianShops, foreign: studio.product.foreignShops || [] } }), 20000, "Range search");
    const mainKey = key(rangeName(main.name)), seenU = new Set([main.url]);
    const items = found.items.filter((x) => x.picture && !seenU.has(x.picture.url) && key(rangeName(x.name)) !== mainKey && where(x.picture.host) >= 0).slice(0, 5);
    const prepared = (await Promise.all(items.map(async (x, i) => {
      seenU.add(x.picture.url);
      let f = await downloadImage(x.picture.url, path.join(assets, `range_src${i}`), { fetchImpl, fs }).catch(() => null);
      if (!f && bingLarge(x.picture.thumb, 900)) f = await downloadImage(bingLarge(x.picture.thumb, 900), path.join(assets, `range_src${i}b`), { fetchImpl, fs }).catch(() => null);
      if (f && f.endsWith(".webp")) { const png = f.replace(/\.webp$/, ".png"); f = await ffmpeg(["-loglevel", "error", "-y", "-i", f, png]).then(() => png, () => null); }
      if (!f) return null;
      const out = path.join(assets, `range_${i}.png`);
      const c = await py(["cutout.py", "product", f, out]).then((t) => JSON.parse(t.trim().split("\n").pop())).catch(() => null);
      if (!c || c.method === "photo" || Math.max(+c.w || 0, +c.h || 0) < 400) return null;   // real cut-out pack shots only
      const pv = path.join(checkDir, `range_${i}.jpg`); await py(["cutout.py", "preview", out, pv]).catch(() => {});
      return fs.existsSync(pv) ? { x, out, c, pv } : null;
    }))).filter(Boolean).slice(0, 4);
    if (prepared.length < 2) return [];
    let pass;
    if (aiDown) pass = prepared.filter((p) => ruleOk({ host: p.x.picture.host, title: p.x.name }, p.c).ok);
    else {
      const v = await withTimeout(ask("You check the finished pictures of a display ad before it is published. Judge only what you see.",
        `Each R picture should be a real ${brand} product pack of the category "${category || product}", as sold in India, shown complete and clean (grey checkerboard = transparent). For EVERY R picture: ok only if it is exactly the ${brand} product named in its label, the main subject, complete, with no banner, offer or price text, no people, no other brand, no watermark, no collage or illustration.`,
        { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "ok"], properties: { n: { type: "integer" }, ok: { type: "boolean" } } } } } },
        prepared.map((p, i) => ({ label: `R${i + 1} — "${p.x.name}"`, file: p.pv })), "medium"), 40000, "Checking the range").catch((e) => { down(e); return null; });
      if (v) { const ok = new Set((v.items || []).filter((r) => r.ok).map((r) => r.n)); pass = prepared.filter((_, i) => ok.has(i + 1)); }
      else pass = aiDown ? prepared.filter((p) => ruleOk({ host: p.x.picture.host, title: p.x.name }, p.c).ok) : [];
    }
    pass = pass.slice(0, 3);
    if (pass.length < 2) return [];
    if (aiDown) flags.push(`Range ${NOT_AI_CHECKED}.`);
    return [{ name: rangeName(main.name), file: mainFile }, ...pass.map((p) => ({ name: rangeName(p.x.name), file: p.out }))];
  }

  // a logo in the same colour as the panel would vanish: the all-white version is used when it stands out better
  if (logoFile && logoRev && logoInk && contrast(logoInk, colour || "#101828") < 3) { logoFile = logoRev; if (logoInfo) logoInfo.reversed = true; }

  // 3) the words: a short headline and subline, the button — no invented offers, prices or claims
  say("Writing the panel copy…");
  const ctas = studio.copy.ctas;
  const typed = product, found = productInfo?.name && productFile ? productInfo.name : pname() || "";
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
  return { range: range.map((r) => ({ name: r.name, file: r.file })), category: plan?.category || null, style: pick?.style || null, logoInk: logoFile ? logoInk : null, highlights, hero, product: productFile, logo: logoFile, colour, accent, copy, productInfo, logoInfo, flags, checks };
}
