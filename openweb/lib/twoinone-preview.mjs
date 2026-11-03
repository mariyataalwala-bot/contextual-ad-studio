// 2-in-1 contextual ad: the unit and its preview. The unit is a 9:16 card shown over the dimmed article, as in the
// reference ads: an art-directed opening (the real product and the brand's logo, few elements, slow clean motion), then
// the card — the 16:9 video ad on top and the product panel in the rest of the space — with a close button and an
// "Advertisement" label.
//
//   unitParts(o)    the unit as parts (css, html, init script) — used both by the standalone preview page and by the
//                   recorder, which injects them into the REAL article page in a phone browser to make the MP4
//   previewHtml(o)  a self-contained interactive preview (our own article page + the unit), served with its own CSP
//   introLayout(P)  which of the three openings a brand gets: "editorial", "hero" or "range"
//
// The opening is one of three restrained layouts, chosen per brand (see introLayout): big type beside the product
// ("editorial"), the product centred and large with one light sweep ("hero"), or the brand's packs lined up as a family
// ("range"). Each is laid out in fixed, separate regions — type, product, logo — so nothing can overlap anything. There
// are no drawn decorations (no orbits, rings, bursts, sparkles or particles): a clean colour field from the brand's
// palette with a subtle tonal gradient, the real product sharp and large with a soft shadow, strong type.
//
// The panel is laid out as rows — logo + words, then the picture, then a line of chips — so nothing can overlap
// nothing: text never sits on a picture. Logo and product are shown exactly as supplied (object-fit: contain, never
// recoloured, cropped or stretched). Nothing here is served live. Every piece of text that came from a publisher, YouTube
// or the client goes through esc().

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : d);
const lum = (h) => { const n = parseInt(h.slice(1), 16), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const inkOn = (bg) => (lum(bg) > 0.35 ? "#101828" : "#ffffff");
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
/** a + (b − a) · t, on #rrggbb colours */
const mixHex = (/** @type {string} */ a, /** @type {string} */ b, /** @type {number} */ t) => { const p = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
/** a CSS url() for an inline style attribute (the attribute itself is escaped by the caller) */
const cssUrl = (/** @type {string} */ u) => `url("${String(u).replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;

export const PREVIEW_CSP = "default-src 'none'; img-src 'self' https: data:; media-src 'self' https: blob:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/** The width the chips may use in the strip, in cqw (the card is 100): 100 minus the 6cqw padding on each side and the gaps between chips. */
const CHIP_ROOM = 86;
const chipWidth = (/** @type {string[]} */ chips, /** @type {number} */ fs) => chips.reduce((a, c) => a + c.length * 0.6 * fs + 3.5 + 1.4 * 2, 0) + Math.max(0, chips.length - 1) * 3.4;
/** The chip type size that fits all the chips in the strip (3.6cqw at most; 3.35cqw is the least that is still 10px on a phone). */
export function chipSize(/** @type {string[]} */ chips) { for (let fs = 3.6; fs >= 3.35; fs -= 0.05) if (chipWidth(chips, fs) <= CHIP_ROOM) return +fs.toFixed(2); return 3.35; }
/** Up to three chips of at most 28 characters; the last ones are dropped until the rest fit the strip at a readable size. */
export function fitChips(/** @type {string[]} */ list) { const c = list.map((x) => String(x).slice(0, 28)).filter(Boolean).slice(0, 3); while (c.length > 1 && chipWidth(c, 3.35) > CHIP_ROOM) c.pop(); return c; }

/**
 * Text sizes that keep the headline to two lines and the subline to two lines in the panel's text width (86 cqw), so the
 * rows above the picture never grow into it. Rough but safe: a character is ~0.55 em wide in a heavy sans.
 * @param {string} headline @param {string} subline
 */
export function textSizes(headline, subline) {
  const hl = String(headline || "").length, sl = String(subline || "").length;
  return { hs: +clamp(hl ? 2 * 86 / (hl * 0.56) : 10, 6.4, 10).toFixed(2), ss: +clamp(sl ? 2 * 86 / (sl * 0.5) : 4.4, 3.3, 4.4).toFixed(2) };
}

// ---------- type fitting for the opening ----------
/** how wide each typeface sets, relative to a heavy system sans, and the weight it is shown at */
const FACE = /** @type {Record<string, { k: number, w: number }>} */ ({ "Anton": { k: 0.8, w: 400 }, "Playfair Display": { k: 1.02, w: 600 }, "Baloo 2": { k: 1.0, w: 800 }, "Space Grotesk": { k: 1.06, w: 700 } });
/** the width of a word in em (a deliberately generous estimate, so the type never runs out of its region) */
const wordEm = (/** @type {string} */ w, k = 1) => [...w].reduce((a, ch) => a + (/[mwMW@]/.test(ch) ? 0.9 : /[A-Z]/.test(ch) ? 0.7 : /[il.,'’!|:;]/.test(ch) ? 0.32 : /[0-9]/.test(ch) ? 0.6 : 0.58), 0) * k * 1.06;
/**
 * The largest type size (cqw, from `max` down to `min`) at which `text` fits `width` cqw in at most `maxLines` lines with no
 * word wider than the line. `ok` is false when even `min` does not fit.
 * @param {string} text @param {number} width @param {number} maxLines @param {number} max @param {number} min @param {number} [k]
 */
export function fitType(text, width, maxLines, max, min, k = 1) {
  const ws = String(text || "").split(/\s+/).filter(Boolean), em = ws.map((w) => wordEm(w, k));
  const lines = (/** @type {number} */ fs) => { let n = 1, cur = 0; for (const e of em) { const w = e * fs; if (!cur) cur = w; else if (cur + 0.28 * fs + w <= width) cur += 0.28 * fs + w; else { n++; cur = w; } } return n; };
  for (let fs = max; fs >= min - 1e-9; fs -= 0.25) if (Math.max(0, ...em) * fs <= width && lines(fs) <= maxLines) return { fs: +fs.toFixed(2), ok: true };
  return { fs: min, ok: false };
}

// ---------- which opening ----------
export const INTRO_LAYOUTS = /** @type {const} */ (["editorial", "hero", "range"]);
/** the design style (studio STYLES) behind each brand typeface, for runs that pass only the typeface */
const STYLE_OF_FONT = /** @type {Record<string, string>} */ ({ "Playfair Display": "luxe", "Anton": "sport", "Baloo 2": "fresh", "Space Grotesk": "tech" });
/** product-led styles get the centred hero; type-led styles get the editorial page */
const LAYOUT_OF_STYLE = /** @type {Record<string, "editorial"|"hero">} */ ({ luxe: "hero", tech: "hero", bold: "editorial", sport: "editorial", fresh: "editorial", journey: "editorial" });
/** 2–4 real pack shots of the brand's range, when the panel data carries them */
const rangeOf = (/** @type {any} */ P) => (Array.isArray(P.range) ? P.range.filter((x) => x && typeof x.src === "string" && x.src && String(x.name || "").trim()).slice(0, 4) : []);
/**
 * The opening a brand gets — deterministic: an explicit `introLayout` (or `layout`) wins; "range" needs at least two real
 * pack shots in `range` (otherwise it falls back to "hero"); then the design style (`style`, or the one behind the brand
 * typeface); then the category; then the kind of product picture.
 * @param {any} P the panel input @returns {"editorial"|"hero"|"range"}
 */
export function introLayout(P = {}) {
  const want = [P.introLayout, P.layout].find((x) => INTRO_LAYOUTS.includes(x));
  const range = rangeOf(P).length >= 2;
  if (want) return want === "range" && !range ? "hero" : want;
  if (range) return "range";
  const style = P.style || STYLE_OF_FONT[P.fontFamily];
  if (LAYOUT_OF_STYLE[style]) return LAYOUT_OF_STYLE[style];
  const cat = String(P.category || "");
  if (cat) return /beauty|cosmetic|perfume|fragrance|skin|hair|watch|jewel|phone|mobile|laptop|electronic|gadget|tech|appliance|luxury/i.test(cat) ? "hero" : "editorial";
  return P.productMode === "photo" ? "editorial" : "hero";
}

/**
 * @typedef {{ brand: string, product: string, publisher: string, article: { headline: string, url: string, published?: string|null, paragraphs: string[], hero?: string|null },
 *   video: { kind: "youtube"|"file", id?: string, src?: string, title?: string },
 *   panel: { colour?: string|null, accent?: string|null, logo?: string|null, logoInk?: string|null, product?: string|null, productMode?: string|null, hero?: string|null, image?: string|null, chips?: string[],
 *            headline?: string, subline?: string, cta?: string|null, ctaUrl?: string|null, productName?: string, opener?: string, fontFamily?: string|null, fontCss?: string,
 *            style?: string|null, category?: string|null, introLayout?: string|null, range?: { name: string, src: string }[] } }} PreviewInput
 */

/** how long the opening runs before the unit appears (seconds) — the recorder and the quality checks follow it */
export const INTRO_SECONDS = 4.2;

/**
 * The unit as parts. `fixed`: the veil covers the whole window (injected into a real page) instead of the phone frame.
 * @param {PreviewInput} o @param {{ fixed?: boolean }} [opt]
 * @returns {{ css: string, html: string, js: string }}
 */
export function unitParts(o, { fixed = false } = {}) {
  const P = o.panel || /** @type {any} */ (o).display || {};
  const bg = hex(P.colour, "#101828"), acc = hex(P.accent, "");
  // the colour field: the brand colour — or, when the logo would not stand out on it, a pale or a deep tone of the same
  // colour, so the logo is shown as it is (never recoloured); a plate behind the logo is the last resort
  const inkOk = /^#[0-9a-f]{6}$/i.test(String(P.logoInk || ""));
  let field = bg, logoTone = "";
  if (inkOk && contrast(P.logoInk, bg) < 3) {
    const [best] = [mixHex(bg, "#ffffff", 0.93), mixHex(bg, "#0b0d12", 0.8)].map((c) => ({ c, r: contrast(P.logoInk, c) })).sort((a, b) => b.r - a.r);
    if (best.r >= 3) field = best.c; else logoTone = lum(bg) > 0.35 ? "dark" : "light";
  }
  const ink = inkOn(field), head = field !== bg && contrast(bg, field) >= 3 ? bg : ink;
  const btn = acc && contrast(acc, field) >= 3 ? acc : head, btnInk = inkOn(btn);
  const f1 = mixHex(field, "#ffffff", 0.07), f2 = mixHex(field, "#000000", 0.14);
  const player = o.video.kind === "youtube"
    ? `<iframe id="yt" title="${esc(o.video.title || "Video ad")}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" data-src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(o.video.id)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&controls=0&disablekb=1&iv_load_policy=3&fs=0"></iframe>`
    : `<video id="vid" src="${esc(o.video.src)}" muted playsinline preload="auto"></video><button id="replay" class="rp" hidden aria-label="Replay the video ad">&#8635; Replay</button>`;
  const { hs, ss } = textSizes(P.headline, P.subline);
  const hw = String(P.headline || "").split(/\s+/).filter(Boolean).map((w, k) => `<span class="w"><i style="--k:${k}">${esc(w)}</i></span>`).join(" ");
  const cta = P.cta ? (safeUrl(P.ctaUrl) ? `<a class="cta" href="${esc(safeUrl(P.ctaUrl))}" target="_blank" rel="noopener sponsored">${esc(P.cta)} &rarr;</a>` : `<span class="cta">${esc(P.cta)} &rarr;</span>`) : "";
  const family = P.fontFamily ? String(P.fontFamily).replace(/[^\w -]/g, "") : "";
  const ff = family ? `'${family}',system-ui,sans-serif` : "system-ui,sans-serif", face = FACE[family] || { k: 1, w: 800 };
  const kind = P.product ? "prod" : P.hero ? "hero" : "nop";
  const chips = fitChips(Array.isArray(P.chips) ? P.chips : []);
  const cf = chipSize(chips);
  const strip = chips.length ? `<div class="strip" style="--cf:${cf}cqw">${chips.map((c, k) => `<span style="--k:${k}">${esc(c)}</span>`).join("")}</div>` : "";
  const photo = P.productMode === "photo";
  const plogo = P.logo ? `<img class="plogo${logoTone ? " " + logoTone : ""}" src="${esc(P.logo)}" alt="${esc(o.brand)}">` : `<div class="plogo word">${esc(o.brand)}</div>`;
  const vis = kind === "prod"
    ? `<div class="pstage"><i class="pshadow"></i><img class="pprod ${photo ? "photo" : "cut"}" src="${esc(P.product)}" alt="${esc(P.productName || o.product)}"></div>`
    : kind === "hero" ? `<figure class="hero"><img src="${esc(P.hero)}" alt=""></figure>`
    : P.logo ? `<img class="pwm${logoTone ? " " + logoTone : ""}" src="${esc(P.logo)}" alt="${esc(o.brand)}">` : "";
  // a brand panel with no product shows the logo large in the picture row, so it is not repeated in the top row
  const topLogo = kind === "nop" && P.logo ? "" : plogo;
  const panel = P.image
    ? `<div class="pn img"><img class="dimg" src="${esc(P.image)}" alt="${esc(o.brand)} — ${esc(P.productName || o.product)}"></div>`
    : `<div class="pn k-${kind}${chips.length ? " has-strip" : ""}${family === "Anton" ? " f400" : ""}" style="--hs:${hs}cqw;--ss:${ss}cqw;--ff:${ff};--fw:${face.w}">
<div class="ptop">${topLogo}
${hw ? `<h2>${hw}</h2>` : `<h2><span class="w"><i style="--k:0">${esc(P.productName || o.product)}</i></span></h2>`}${P.subline ? `<p class="psub">${esc(P.subline)}</p>` : ""}${cta}</div>
<div class="vis">${vis}</div>${strip}</div>`;

  // ---------- the opening ----------
  const range = rangeOf(P);
  let layout = /** @type {string} */ (introLayout(P));
  if (layout !== "range" && !P.product) layout = "type";   // no product picture: a typographic opening — the line and the logo
  const opener = String(P.opener || "").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  const line = layout === "range" ? opener : opener || String(P.productName || o.product || o.brand || "");
  const fit = layout === "editorial" ? fitType(line, 46, 6, 13, 6.5, face.k) : layout === "hero" ? fitType(line, 84, 2, 10.5, 6.5, face.k)
    : layout === "range" ? fitType(line, 84, 2, 9, 6, face.k) : fitType(line, 84, 4, 14, 7, face.k);
  const stack = layout === "editorial" ? fitType(line, 86, 3, 12, 6.5, face.k) : fit;
  const iwords = String(line).split(/\s+/).filter(Boolean).map((w, k) => `<span class="iw" style="--k:${k}">${esc(w)}</span>`).join(" ");
  const itype = iwords ? `<p class="itype">${iwords}</p>` : "";
  const ilogo = P.logo ? `<img class="il${logoTone ? " " + logoTone : ""}" src="${esc(P.logo)}" alt="${esc(o.brand)}">` : `<div class="il word">${esc(o.brand)}</div>`;
  const pu = P.product ? esc(cssUrl(P.product)) : "";
  const ibox = (/** @type {boolean} */ sweep) => `<div class="ibox"><i class="ishadow"></i><div class="ipw"><img class="ip ${photo ? "photo" : "cut"}" src="${esc(P.product)}" alt="${esc(P.productName || o.product)}">${sweep ? `<i class="isweep" style="--pu:${pu}"></i>` : ""}</div></div>`;
  const colW = range.length ? (88 - (range.length - 1) * 4) / range.length : 0;
  const rs = range.length ? clamp(Math.min(...range.map((r) => fitType(String(r.name).toUpperCase(), colW, 2, 3.2, 2.8, face.k * 1.12).fs)), 2.8, 3.2) : 3;
  const stageInner = layout === "editorial" ? `${itype}${ibox(false)}${ilogo}`
    : layout === "hero" ? `${ibox(true)}${itype}${ilogo}`
    : layout === "range" ? `${itype}<div class="irange" style="--n:${range.length};--rs:${rs}cqw">${range.map((r, k) => `<figure class="rk" style="--k:${k}"><div class="rimg"><img src="${esc(r.src)}" alt="${esc(r.name)}"></div><figcaption>${esc(r.name)}</figcaption></figure>`).join("")}</div>${ilogo}`
    : `${itype}${ilogo}`;
  const iclass = `intro L-${layout}${layout === "editorial" && !fit.ok ? " stack" : ""}${layout === "range" && !itype ? " noline" : ""}`;
  const html = `<div class="veil" id="veil" role="dialog" aria-modal="true" aria-label="Advertisement"><div class="${iclass}" id="intro" data-layout="${layout}" style="--f:${field};--f1:${f1};--f2:${f2};--ink:${ink};--head:${head};--ff:${ff};--fw:${face.w};--ts:${fit.fs}cqw;--ts2:${stack.fs}cqw"><div class="ifield"></div><div class="istage">${stageInner}</div></div>
<div class="wrap" id="wrap"><span class="tag">Advertisement</span><button class="x" id="x" aria-label="Close advertisement">&times; Close</button>
<div class="unit" id="unit"><div class="vid">${player}</div><div class="disp">${panel}</div></div></div></div>`;

  const E = "cubic-bezier(.2,.8,.2,1)";
  const css = `
.veil{position:${fixed ? "fixed" : "absolute"};inset:0;background:rgba(7,10,20,.74);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);display:grid;place-items:center;opacity:0;pointer-events:none;transition:opacity .35s;z-index:${fixed ? "2147483647" : "5"};font-family:system-ui,"Segoe UI",sans-serif;line-height:1.3;color:#fff}
.veil *,.pn *{text-decoration:none!important}.veil *{box-sizing:border-box}.veil.open{opacity:1;pointer-events:auto}
/* 1) the opening — one of three restrained layouts; type, product and logo each have their own region, so nothing overlaps */
.intro{position:absolute;inset:0;pointer-events:none;overflow:hidden;container-type:size;z-index:2;transition:opacity .4s ease,transform .8s ${E}}
.intro.done{opacity:0;transform:scale(.94)}
.ifield{position:absolute;inset:0;background:linear-gradient(172deg,var(--f1) 0%,var(--f) 50%,var(--f2) 100%)}
.istage{position:absolute;inset:0;perspective:150cqw;transform-origin:50% 56%}
.itype{position:absolute;margin:0;display:flex;flex-wrap:wrap;align-content:center;gap:0 .27em;color:var(--head);font:var(--fw) var(--ts)/1.06 var(--ff,system-ui,sans-serif);letter-spacing:-.022em;overflow-wrap:anywhere}
.iw{display:inline-block;opacity:0}
.ibox{position:absolute}
.ipw{position:absolute;inset:0;transform-origin:50% 100%}
.ip{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom;filter:drop-shadow(0 2.2cqw 2.6cqw rgba(0,0,0,.2))}
.ishadow{position:absolute;left:50%;bottom:-1.4cqw;width:calc(var(--pw,34cqw) * .92);height:4.4cqw;margin-left:calc(var(--pw,34cqw) * -.46);border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.32),rgba(0,0,0,0));opacity:0}
.isweep{position:absolute;inset:0;-webkit-mask:var(--pu) center bottom/contain no-repeat;mask:var(--pu) center bottom/contain no-repeat;background:linear-gradient(100deg,transparent 44%,rgba(255,255,255,.42) 50%,transparent 56%) 100% 0/300% 100% no-repeat;opacity:0}
.il{position:absolute;height:8%;width:36cqw;object-fit:contain;opacity:0}
.il.light{background:#fff;padding:2cqw 3cqw;border-radius:2cqw}.il.dark{background:#14171f;padding:2cqw 3cqw;border-radius:2cqw}
.il.word{height:auto;width:auto;max-width:86cqw;font:var(--fw) 9cqw/1.05 var(--ff,system-ui,sans-serif);color:var(--head);letter-spacing:-.02em;white-space:nowrap}
/* editorial: big type on the left, the product large on the right, the logo under the type; one slow push-in */
.L-editorial .itype{left:7cqw;width:46cqw;top:12%;bottom:27%;justify-content:flex-start}
.L-editorial .ibox{left:56cqw;right:5cqw;top:9%;bottom:11%}
.L-editorial .il{left:7cqw;bottom:9%;object-position:left bottom}
.L-editorial .il.word{left:7cqw;bottom:9%;font-size:7cqw}
.L-editorial.stack .itype{--ts:var(--ts2);width:86cqw;top:8%;bottom:auto;height:30%}
.L-editorial.stack .ibox{left:7cqw;right:7cqw;top:41%;bottom:20%}
.L-editorial.stack .il{left:32cqw;object-position:center bottom}
/* hero: the product centred and very large, a gentle 3D tilt as it rises, one light sweep; the line below, then the logo */
.L-hero .ibox{left:8cqw;right:8cqw;top:8%;bottom:40%}
.L-hero .itype{left:8cqw;right:8cqw;top:63%;height:19%;justify-content:center;text-align:center}
.L-hero .il{left:32cqw;bottom:6.5%;object-position:center}
.L-hero .il.word{left:0;right:0;width:auto;margin:auto;text-align:center;font-size:7cqw}
/* range: the packs as a lined-up family, each with its real name in small capitals, then the logo */
.L-range .itype{left:8cqw;right:8cqw;top:7%;height:17%;justify-content:center;text-align:center}
.irange{position:absolute;left:6cqw;right:6cqw;top:27%;bottom:22%;display:flex;gap:4cqw;justify-content:center}
.L-range.noline .irange{top:13%}
.rk{flex:1;min-width:0;margin:0;display:flex;flex-direction:column;opacity:0}
.rimg{flex:1;min-height:0;position:relative}
.rimg img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom;filter:drop-shadow(0 2cqw 2.2cqw rgba(0,0,0,.2))}
.rk figcaption{flex:none;min-height:calc(var(--rs) * 2.6 + 3.4cqw);padding-top:3.4cqw;text-align:center;color:var(--ink);font:600 var(--rs)/1.25 var(--ff,system-ui,sans-serif);letter-spacing:.12em;text-transform:uppercase;overflow-wrap:anywhere}
.L-range .il{left:32cqw;bottom:6.5%;object-position:center}
.L-range .il.word{left:0;right:0;width:auto;margin:auto;text-align:center;font-size:7cqw}
/* no product picture: the line, large, and the logo */
.L-type .itype{left:8cqw;right:8cqw;top:14%;bottom:36%;justify-content:center;text-align:center}
.L-type .il{left:22cqw;width:56cqw;height:12%;bottom:14%;object-position:center}
.L-type .il.word{left:0;right:0;width:auto;margin:auto;text-align:center;font-size:11cqw}
/* motion: few things, slow and clean — every one plays once */
.intro.go .iw{animation:iwIn .9s ${E} calc(var(--d0,.35s) + var(--k) * .09s) both}
.intro.go .il{animation:ilIn .9s ${E} var(--dl,2.2s) both}
.intro.go .ishadow{animation:fadeIn 1s ease var(--ds,.9s) both}
.L-editorial.go .istage{animation:push 4.8s cubic-bezier(.25,.6,.3,1) both}
.L-editorial.go .ipw{animation:slideIn 1.2s ${E} .55s both}
.L-editorial{--dl:2s}
.L-hero{--d0:1.65s;--dl:2.55s;--ds:.7s}
.L-hero.go .ibox{animation:drift 3.95s linear .25s both}
.L-hero.go .ipw{animation:riseTilt 1.2s ${E} .25s both}
.L-hero.go .isweep{animation:sweep 1.1s cubic-bezier(.45,0,.2,1) 1.45s both}
.L-range{--d0:.3s;--dl:2.35s}
.L-range.go .rk{animation:rkIn 1.1s ${E} calc(.55s + var(--k) * .14s) both}
.L-type{--d0:.35s;--dl:1.6s}
@keyframes iwIn{from{opacity:0;transform:translateY(.38em)}to{opacity:1;transform:none}}
@keyframes ilIn{from{opacity:0;transform:translateY(1.6cqw)}to{opacity:1;transform:none}}
@keyframes push{from{transform:scale(1)}to{transform:scale(1.04)}}
@keyframes slideIn{from{opacity:0;transform:translateX(9%)}to{opacity:1;transform:none}}
@keyframes drift{from{transform:translateY(0)}to{transform:translateY(-1.4%)}}
@keyframes riseTilt{0%{opacity:0;transform:translateY(8%) rotateX(9deg) rotateY(-13deg) scale(.95)}45%{opacity:1}100%{opacity:1;transform:none}}
@keyframes sweep{0%{opacity:0;background-position:100% 0}18%,82%{opacity:1}100%{opacity:0;background-position:0 0}}
@keyframes rkIn{from{opacity:0;transform:translateX(10cqw)}to{opacity:1;transform:none}}
/* 2) the unit: a 9:16 card — 16:9 video on top, the product panel in the rest; it scales and crossfades in as the opening leaves */
.unit{position:relative;width:100%;aspect-ratio:9/16;container-type:inline-size;display:flex;flex-direction:column;border-radius:6px;overflow:hidden;background:#fff;box-shadow:0 30px 60px -20px #000;opacity:0;transform:scale(.96)}
.unit.in{opacity:1;transform:none;transition:opacity .6s ease .15s,transform .8s ${E}}
.wrap{position:relative;width:84%;max-height:92%}
.x{position:absolute;top:-30px;right:0;background:none;border:0;color:#fff;font:600 18px/1 system-ui,sans-serif;padding:4px 6px;cursor:pointer;opacity:0;transition:opacity .3s}
.tag{position:absolute;top:-26px;left:0;color:rgba(255,255,255,.85);font:600 10px system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;opacity:0;transition:opacity .3s}
.wrap.in .x,.wrap.in .tag{opacity:1}
.vid{position:relative;aspect-ratio:16/9;background:#000;flex:none}.vid iframe,.vid video{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;pointer-events:none}
.rp{position:absolute;right:8px;bottom:8px;font:600 12px system-ui,sans-serif;border:0;border-radius:99px;padding:6px 12px;background:rgba(255,255,255,.92);cursor:pointer}
.disp{flex:1;min-height:0;position:relative}
/* the product panel: rows — [logo, headline, subline, button] / [picture] / [chips] — so nothing can overlap */
.pn{--c:${field};--c1:${f1};--c2:${f2};--ink:${ink};--head:${head};--btn:${btn};--btnink:${btnInk};position:absolute;inset:0;overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:linear-gradient(172deg,var(--c1) 0%,var(--c) 45%,var(--c2) 100%);color:var(--ink);font-family:system-ui,"Segoe UI",sans-serif}
.pn.img{display:block}
.pn.f400 h2,.pn.f400 .cta,.pn.f400 .strip span,.pn.f400 .plogo.word{font-weight:400}
.ptop{grid-row:1;position:relative;z-index:4;padding:6cqw 7cqw 3cqw;display:flex;flex-direction:column;align-items:flex-start;gap:2.6cqw}
.plogo{height:8cqw;max-width:34cqw;object-fit:contain;opacity:0}
.plogo.light{background:#fff;padding:1.4cqw 2.4cqw;border-radius:2cqw;box-sizing:content-box}.plogo.dark{background:#14171f;padding:1.4cqw 2.4cqw;border-radius:2cqw;box-sizing:content-box}
.plogo.word{height:auto;color:var(--head);font:var(--fw,800) 6.4cqw/1.05 var(--ff,system-ui,sans-serif);letter-spacing:-.02em}
.ptop h2{margin:0;width:86cqw;color:var(--head);font:var(--fw,800) var(--hs)/1.06 var(--ff,system-ui,sans-serif);letter-spacing:-.022em}
.w{display:inline-block;vertical-align:top}.w>i{display:inline-block;font-style:normal;opacity:0}
.psub{margin:0;width:86cqw;font:500 var(--ss)/1.4 var(--ff,system-ui,sans-serif);opacity:0}
.cta{display:inline-block;margin-top:1cqw;font:700 3.8cqw/1 var(--ff,system-ui,sans-serif);color:var(--btnink);background:var(--btn);padding:2.8cqw 5.4cqw;border-radius:99px;opacity:0}
/* the picture row: the product, sharp, with a soft shadow on the ground — it can never reach the words above */
.vis{grid-row:2;position:relative;min-height:0;overflow:hidden;z-index:2}
.pstage{position:absolute;left:0;right:0;bottom:5cqw;top:2cqw;display:flex;justify-content:center;align-items:flex-end}
.pshadow{position:absolute;left:50%;bottom:-1.6cqw;width:calc(var(--pw,40cqw) * .92);height:4.4cqw;margin-left:calc(var(--pw,40cqw) * -.46);border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.3),rgba(0,0,0,0));opacity:0}
.pprod{position:relative;margin:0;width:auto;height:86%;max-width:80%;object-fit:contain;opacity:0;filter:drop-shadow(0 2.4cqw 2.6cqw rgba(0,0,0,.2));transform-origin:50% 100%}
.pprod.photo{max-width:66%;filter:drop-shadow(0 3cqw 4cqw rgba(0,0,0,.3))}
.hero{position:absolute;inset:0;margin:0;overflow:hidden;opacity:0;background:var(--c2)}
.hero img{width:100%;height:100%;object-fit:cover;object-position:75% 30%;display:block;transform:scale(1.5);transform-origin:75% 30%}   /* zoomed on the subject, away from the captions a YouTube frame carries at its lower left */
.pwm{position:absolute;inset:0;margin:auto;width:auto;height:auto;max-height:46%;max-width:62%;object-fit:contain;opacity:0}   /* the whole logo, never cropped */
.pwm.light,.pwm.dark{padding:3cqw 4cqw;border-radius:2.4cqw;background:#fff}.pwm.dark{background:#14171f}
.pn.img .dimg{width:100%;height:100%;object-fit:cover;display:block}
.strip{grid-row:3;position:relative;z-index:5;height:13cqw;background:color-mix(in srgb,var(--c2) 70%,var(--c));color:var(--ink);display:flex;align-items:center;gap:3.4cqw;padding:0 6cqw;overflow:hidden;opacity:0}
.strip span{display:inline-flex;align-items:center;gap:3.4cqw;font:600 var(--cf,3.6cqw)/1 var(--ff,system-ui,sans-serif);white-space:nowrap;opacity:0}
.strip span+span:before{content:"";width:1px;height:3.6cqw;background:currentColor;opacity:.35}
/* motion — starts when the unit opens; every piece plays once (the product's slow push-in keeps it alive) */
.unit.in .plogo{animation:fadeUp .8s ${E} .15s both}
.unit.in .w>i{animation:wordIn .9s ${E} calc(.3s + var(--k) * .07s) both}
.unit.in .psub{animation:fadeUp .8s ${E} .8s both}
.unit.in .cta{animation:fadeUp .7s ${E} 1s both}
.unit.in .pprod{animation:prodIn 1.2s ${E} .45s both,pushIn 26s cubic-bezier(.3,.1,.6,1) 1.65s forwards}
.unit.in .pshadow{animation:fadeIn 1s ease .8s both}
.unit.in .hero{animation:fadeIn 1.1s ease .4s both}
.unit.in .hero img{animation:kbh 16s ease-out .4s both}
.unit.in .pwm{animation:fadeUp 1s ${E} .5s both}
.unit.in .strip{animation:fadeIn .8s ease 1.5s both}
.unit.in .strip span{animation:fadeUp .7s ${E} calc(1.7s + var(--k) * .12s) both}
.unit.in .pn.img .dimg{animation:kb 14s ease-out both}
@keyframes wordIn{from{opacity:0;transform:translateY(.35em)}to{opacity:1;transform:none}}
@keyframes fadeUp{from{opacity:0;transform:translateY(1.6cqw)}to{opacity:1;transform:none}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes prodIn{from{opacity:0;translate:0 5%}to{opacity:1;translate:0 0}}
@keyframes pushIn{from{scale:1}to{scale:1.06}}
@keyframes kbh{from{transform:scale(1.62)}to{transform:scale(1.5)}}
@keyframes kb{from{transform:scale(1.1)}to{transform:scale(1)}}
@media(prefers-reduced-motion:reduce){.veil,.unit,.intro{transition:none}.unit *,.intro *{animation-duration:.01s!important;animation-delay:0s!important;animation-iteration-count:1!important}}
`;
  // runs against a document or a shadow root; returns { open, close }
  const js = `function mkInit(root){const q=(i)=>root.getElementById(i),veil=q("veil"),intro=q("intro"),unit=q("unit"),wrap=q("wrap"),yt=q("yt"),vid=q("vid"),rp=q("replay");
const calm=matchMedia("(prefers-reduced-motion: reduce)").matches,INTRO=calm?0:${INTRO_SECONDS * 1000};let t2,onClose=null;
const fitIntro=()=>{const b=intro.querySelector(".ibox"),im=b&&b.querySelector(".ip");if(!im||!im.naturalWidth)return;const a=im.naturalWidth/im.naturalHeight;
 if(intro.classList.contains("L-editorial")&&a>1.15)intro.classList.add("stack");b.style.setProperty("--pw",Math.min(b.clientWidth,b.clientHeight*a).toFixed(1)+"px");};
const fitPanel=()=>{const p=root.querySelector(".pprod"),s=root.querySelector(".pstage");if(p&&s&&p.offsetWidth)s.style.setProperty("--pw",p.offsetWidth+"px");};
for(const [im,f] of [[intro.querySelector(".ip"),fitIntro],[root.querySelector(".pprod"),fitPanel]])if(im){if(im.complete)f();else im.addEventListener("load",f);}
function startVideo(){if(yt&&!yt.src)yt.src=yt.dataset.src;if(vid){vid.currentTime=0;vid.play().catch(()=>{});}if(rp)rp.hidden=true;}
function open(){clearTimeout(t2);unit.classList.remove("in");wrap.classList.remove("in");intro.classList.remove("go","done");void intro.offsetWidth;veil.classList.add("open");fitIntro();
 const go=()=>{intro.classList.add("done");unit.classList.add("in");wrap.classList.add("in");fitPanel();startVideo();};
 if(INTRO){intro.classList.add("go");t2=setTimeout(go,INTRO);}else go();}
function close(){clearTimeout(t2);veil.classList.remove("open");if(vid)vid.pause();if(yt)yt.removeAttribute("src");if(onClose)onClose();}
q("x").onclick=close;veil.addEventListener("click",e=>{if(e.target===veil)close();});
if(vid){vid.addEventListener("ended",()=>{if(rp)rp.hidden=false;});if(rp)rp.onclick=()=>{rp.hidden=true;vid.currentTime=0;vid.play();};}
const geom=()=>{const R=(e)=>{if(!e)return null;const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)};};
const cs=(e)=>getComputedStyle(e),texts=[];
const add=(k,e)=>{if(!e)return;const c=cs(e),r=R(e);if(!r||r.w<1||r.h<1||c.visibility==='hidden'||+c.opacity===0)return;texts.push({k,...r,fs:+parseFloat(c.fontSize).toFixed(1),color:c.color,text:(e.textContent||'').trim().slice(0,80)});};
const all=(s)=>[...root.querySelectorAll(s)];
add('logo-word',root.querySelector('.plogo.word'));all('.ptop h2 .w').forEach((e,i)=>add('headline-'+i,e));add('subline',root.querySelector('.psub'));add('cta',root.querySelector('.cta'));all('.strip span').forEach((e,i)=>add('chip-'+i,e));add('tag',root.querySelector('.tag'));add('close',root.querySelector('.x'));
return {view:{w:innerWidth,h:innerHeight},card:R(unit),video:R(root.querySelector('.vid')),picture:R(root.querySelector('.vis')),logo:R(root.querySelector('.plogo:not(.word)')||root.querySelector('.pwm')),product:R(root.querySelector('.pprod')),texts,panelColour:cs(root.querySelector('.pn')||unit).getPropertyValue('--c').trim(),ad:!!(root.querySelector('.tag')&&/advertisement/i.test(root.querySelector('.tag').textContent))};};
return {open,close,geom,set onClose(f){onClose=f;}};}`;
  return { css, html, js };
}

/** @param {PreviewInput} o */
export function previewHtml(o) {
  const P = o.panel || /** @type {any} */ (o).display || {};
  const bg = hex(P.colour, "#101828"), ink = inkOn(bg);
  const paras = o.article.paragraphs.slice(0, 9);
  const at = Math.min(3, Math.max(1, paras.length - 1));   // the slot sits after the 3rd paragraph, like the references
  const body = paras.map((p, i) => `<p>${esc(p)}</p>${i + 1 === at ? slot(o, bg, ink) : ""}`).join("");
  const date = o.article.published ? new Date(o.article.published).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  const { css, html, js } = unitParts(o);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>2-in-1 preview — ${esc(o.brand)}</title><style>${o.panel?.fontCss || ""}
*{box-sizing:border-box}html,body{margin:0;height:100%}body{font:15px/1.6 Georgia,"Times New Roman",serif;color:#1d2433;background:#e9ecf2;display:grid;place-items:center}
.phone{position:relative;aspect-ratio:9/16;height:min(100vh,calc(100vw * 16 / 9),860px);width:auto;background:#fff;overflow:hidden}
@media(min-width:480px){.phone{border-radius:30px;box-shadow:0 30px 70px -28px rgba(11,18,32,.55),0 0 0 9px #0b0f19}}
.page{height:100%;overflow:auto;padding:0 5%;scrollbar-width:none}.page::-webkit-scrollbar{display:none}
.bar{position:sticky;top:0;background:#fff;margin:0 -5.5%;padding:12px 5.5%;border-bottom:1px solid #e4e7ee;font:700 14px system-ui,sans-serif;display:flex;justify-content:space-between;z-index:2}
.bar small{font-weight:500;color:#667085}
h1{font:700 23px/1.25 Georgia,serif;margin:16px 0 8px}.meta{font:12.5px system-ui,sans-serif;color:#667085;margin-bottom:12px}
.hero-img{width:111%;margin:0 -5.5% 14px;display:block;aspect-ratio:16/9;object-fit:cover;background:#dfe3ec}
p{margin:0 0 14px}
.slot{margin:6px 0 18px;border:1px solid #e4e7ee;border-radius:12px;padding:8px 10px 10px;font-family:system-ui,sans-serif;background:#fafbfd;cursor:pointer;text-align:left;width:100%}
.slot .adv{display:block;font:600 10px system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#98a1b3;margin-bottom:6px}
.slot .tile{display:flex;align-items:center;gap:10px;border-radius:9px;padding:10px 12px;font:700 15px system-ui,sans-serif}
.slot .tile em{font:500 12px system-ui,sans-serif;opacity:.85;margin-left:auto;font-style:normal}
.again{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);font:600 12px system-ui,sans-serif;border:0;border-radius:99px;padding:9px 16px;background:#0b6ff0;color:#fff;cursor:pointer;display:none;z-index:3}
.again.show{display:block}
.mock{position:absolute;left:0;right:0;bottom:0;background:#0b0f19;color:#c8cfdd;font:600 10.5px system-ui,sans-serif;letter-spacing:.05em;padding:5px 12px;text-align:center;z-index:6}
${css}</style></head><body>
<div class="phone"><div class="page" id="page"><div class="bar"><span>${esc(o.publisher)}</span><small>News</small></div>
<h1>${esc(o.article.headline)}</h1><div class="meta">${esc(o.publisher)}${date ? " · " + esc(date) : ""}</div>
${o.article.hero ? `<img class="hero-img" src="${esc(o.article.hero)}" alt="">` : ""}${body}</div>
${html}
<button class="again" id="again">&#9654; Show the ad again</button>
<div class="mock">MOCK PREVIEW — not a live placement · nothing is served</div></div>
<script>
${js}
(()=>{const ui=mkInit(document),again=document.getElementById("again");
ui.onClose=()=>again.classList.add("show");const open=()=>{again.classList.remove("show");ui.open();};
again.onclick=open;document.addEventListener("keydown",e=>{if(e.key==="Escape")ui.close();});
for(const s of document.querySelectorAll(".slot"))s.onclick=open;
setTimeout(open,1500);})();
</script></body></html>`;
}

function slot(o, bg, ink) {
  return `<button class="slot" type="button" aria-label="Advertisement from ${esc(o.brand)}: open"><span class="adv">Advertisement</span><span class="tile" style="background:${bg};color:${ink}">${esc(o.brand)}<em>Watch</em></span></button>`;
}
