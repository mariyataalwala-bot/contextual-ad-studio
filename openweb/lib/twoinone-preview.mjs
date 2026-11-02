// 2-in-1 contextual ad: the unit and its preview. The unit is a 9:16 card shown over the dimmed article, as in the
// reference ads: an opening (the brand's logo and product arrive), then the card — the 16:9 video ad on top and the
// animated product panel in the rest of the space — with a close button and an "Advertisement" label.
//
//   unitParts(o)    the unit as parts (css, html, init script) — used both by the standalone preview page and by the
//                   recorder, which injects them into the REAL article page in a phone browser to make the MP4
//   previewHtml(o)  a self-contained interactive preview (our own article page + the unit), served with its own CSP
//
// The panel is laid out as rows — logo + words, then the picture, then a strip of chips — so nothing can overlap
// nothing: text never sits on a picture, a watermark or a light effect. The picture is photographic: the checked
// product picture (cut out, floating in a light pool), or a frame of the brand's own video ad. Motion is made of
// light, not drawn shapes. Nothing here is served live. Every piece of text that came from a publisher, YouTube or
// the client goes through esc().

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : d);
const lum = (h) => { const n = parseInt(h.slice(1), 16), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const inkOn = (bg) => (lum(bg) > 0.35 ? "#101828" : "#ffffff");
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const PREVIEW_CSP = "default-src 'none'; img-src 'self' https: data:; media-src 'self' https: blob:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

// slow light specks: [left %, size cqw, rise seconds, delay seconds]
const BOKEH = [[8, 7, 13, 0], [22, 4, 10, 2.5], [38, 9, 16, 1], [55, 5, 11, 4], [68, 8, 15, 0.5], [82, 4, 9, 3], [92, 6, 14, 5.5]];

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

/**
 * @typedef {{ brand: string, product: string, publisher: string, article: { headline: string, url: string, published?: string|null, paragraphs: string[], hero?: string|null },
 *   video: { kind: "youtube"|"file", id?: string, src?: string, title?: string },
 *   panel: { colour?: string|null, accent?: string|null, logo?: string|null, logoInk?: string|null, product?: string|null, productMode?: string|null, hero?: string|null, image?: string|null, chips?: string[],
 *            headline?: string, subline?: string, cta?: string|null, ctaUrl?: string|null, productName?: string } }} PreviewInput
 */

/**
 * The unit as parts. `fixed`: the veil covers the whole window (injected into a real page) instead of the phone frame.
 * @param {PreviewInput} o @param {{ fixed?: boolean }} [opt]
 * @returns {{ css: string, html: string, js: string }}
 */
export function unitParts(o, { fixed = false } = {}) {
  const P = o.panel || /** @type {any} */ (o).display || {};
  const bg = hex(P.colour, "#101828"), ink = inkOn(bg), acc = hex(P.accent, ""), btn = acc && contrast(acc, bg) >= 3 ? acc : ink, btnInk = inkOn(btn);
  const player = o.video.kind === "youtube"
    ? `<iframe id="yt" title="${esc(o.video.title || "Video ad")}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" data-src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(o.video.id)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&controls=0&disablekb=1&iv_load_policy=3&fs=0"></iframe>`
    : `<video id="vid" src="${esc(o.video.src)}" muted playsinline preload="auto"></video><button id="replay" class="rp" hidden aria-label="Replay the video ad">&#8635; Replay</button>`;
  const { hs, ss } = textSizes(P.headline, P.subline);
  const hw = String(P.headline || "").split(/\s+/).filter(Boolean).map((w, k) => `<span class="w"><i style="--k:${k}">${esc(w)}</i></span>`).join(" ");
  const cta = P.cta ? (safeUrl(P.ctaUrl) ? `<a class="cta" href="${esc(safeUrl(P.ctaUrl))}" target="_blank" rel="noopener sponsored">${esc(P.cta)} &rarr;</a>` : `<span class="cta">${esc(P.cta)} &rarr;</span>`) : "";
  const kind = P.product ? "prod" : P.hero ? "hero" : "nop";
  // a logo in nearly the panel's own colour is shown all-white (or all-black on a light panel); on the dark opening it is white if it is dark
  const inkOk = /^#[0-9a-f]{6}$/i.test(String(P.logoInk || ""));
  const logoTone = inkOk && contrast(P.logoInk, bg) < 3 ? (lum(bg) > 0.35 ? "dark" : "light") : "", introTone = inkOk && lum(P.logoInk) < 0.3 ? "light" : "";
  const chips = fitChips(Array.isArray(P.chips) ? P.chips : []);
  const cf = chipSize(chips);
  const strip = chips.length ? `<div class="strip" style="--cf:${cf}cqw">${chips.map((c, k) => `<span style="--k:${k}">${esc(c)}</span>`).join("")}</div>` : "";
  const bokeh = BOKEH.map(([x, s, d, dl]) => `<b style="--x:${x}%;--s:${s}cqw;--d:${d}s;--dl:${dl}s"></b>`).join("");
  const vis = kind === "prod"
    ? `<div class="glow"></div><i class="rip"></i><i class="rip"></i><i class="rip"></i><div class="pshadow"></div><img class="pprod ${P.productMode === "photo" ? "photo" : "cut"}" src="${esc(P.product)}" alt="${esc(P.productName || o.product)}">`
    : kind === "hero" ? `<figure class="hero"><img src="${esc(P.hero)}" alt=""></figure>`
    : P.logo ? `<img class="pwm" src="${esc(P.logo)}" alt="">` : "";
  const panel = P.image
    ? `<div class="pn img"><img class="dimg" src="${esc(P.image)}" alt="${esc(o.brand)} — ${esc(P.productName || o.product)}"></div>`
    : `<div class="pn k-${kind}${chips.length ? " has-strip" : ""}" style="--hs:${hs}cqw;--ss:${ss}cqw"><div class="decor"><div class="mesh"><i></i><i></i><i></i></div><div class="bokeh">${bokeh}</div><div class="beam"></div><div class="beam b2"></div></div>
<div class="ptop">${P.logo ? `<img class="plogo${logoTone ? " " + logoTone : ""}" src="${esc(P.logo)}" alt="${esc(o.brand)}">` : `<div class="plogo word">${esc(o.brand)}</div>`}
${hw ? `<h2>${hw}</h2>` : `<h2><span class="w"><i style="--k:0">${esc(P.productName || o.product)}</i></span></h2>`}${P.subline ? `<p class="psub">${esc(P.subline)}</p>` : ""}${cta}</div>
<div class="vis">${vis}</div>${strip}</div>`;
  const introVisual = P.product ? `<img class="ip ${P.productMode === "photo" ? "photo" : "cut"}" src="${esc(P.product)}" alt="">` : P.hero ? `<img class="ip photo" src="${esc(P.hero)}" alt="">` : "";
  const introLogo = P.logo ? `<img class="il${introTone ? " " + introTone : ""}" src="${esc(P.logo)}" alt="${esc(o.brand)}">` : `<div class="il word">${esc(o.brand)}</div>`;
  const html = `<div class="veil" id="veil" role="dialog" aria-modal="true" aria-label="Advertisement"><div class="intro" id="intro"><div class="burst"></div><div class="ring"></div>${introLogo}${introVisual}</div>
<div class="wrap" id="wrap"><span class="tag">Advertisement</span><button class="x" id="x" aria-label="Close advertisement">&times; Close</button>
<div class="unit" id="unit"><div class="vid">${player}</div><div class="disp">${panel}</div></div></div></div>`;
  const css = `
.veil{position:${fixed ? "fixed" : "absolute"};inset:0;background:rgba(7,10,20,.74);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);display:grid;place-items:center;opacity:0;pointer-events:none;transition:opacity .35s;z-index:${fixed ? "2147483647" : "5"};font-family:system-ui,"Segoe UI",sans-serif;line-height:1.3;color:#fff}
.veil *{box-sizing:border-box}.veil.open{opacity:1;pointer-events:auto}
/* 1) the opening */
.intro{position:absolute;inset:0;pointer-events:none;display:grid;place-items:center;transition:opacity .45s}
.intro.done{opacity:0}
.il{position:absolute;top:15%;left:50%;width:52%;max-height:16%;object-fit:contain;transform:translateX(-50%);opacity:0;filter:drop-shadow(0 6px 20px rgba(0,0,0,.35))}
.il.light{filter:brightness(0) invert(1) drop-shadow(0 6px 20px rgba(0,0,0,.35))}
.il.word{width:auto;max-width:80%;font:800 clamp(30px,11vw,52px)/1.05 system-ui,sans-serif;color:#fff;text-align:center;letter-spacing:-.02em}
.ip{position:absolute;bottom:-3%;left:50%;width:76%;max-height:58%;object-fit:contain;opacity:0;transform:translateX(-50%)}
.ip.photo{width:70%;height:42%;object-fit:cover;border-radius:18px;box-shadow:0 30px 60px -20px #000;bottom:12%}
.burst{position:absolute;top:15%;left:50%;width:90%;aspect-ratio:1;margin-top:-30%;transform:translateX(-50%) scale(.2);background:radial-gradient(closest-side,rgba(255,255,255,.5),rgba(255,255,255,0));opacity:0}
.ring{position:absolute;top:15%;left:50%;width:30%;aspect-ratio:1;margin-top:-4%;transform:translateX(-50%) scale(.3);border:2px solid rgba(255,255,255,.7);border-radius:50%;opacity:0}
.intro.go .il{animation:ilIn .9s cubic-bezier(.2,.8,.2,1) .1s both}
.intro.go .ip{animation:ipIn 1.15s cubic-bezier(.2,.8,.2,1) .35s both}
.intro.go .burst{animation:burst 1.4s ease-out .05s both}
.intro.go .ring{animation:ringOut 1.5s ease-out .2s both}
@keyframes ilIn{from{opacity:0;transform:translateX(-50%) scale(.82)}to{opacity:1;transform:translateX(-50%) scale(1)}}
@keyframes ipIn{from{opacity:0;transform:translateX(-50%) translateY(14%) scale(.9) rotate(-3deg)}to{opacity:1;transform:translateX(-50%) none}}
@keyframes burst{0%{opacity:0;transform:translateX(-50%) scale(.2)}35%{opacity:1}100%{opacity:0;transform:translateX(-50%) scale(1.3)}}
@keyframes ringOut{0%{opacity:.9;transform:translateX(-50%) scale(.3)}100%{opacity:0;transform:translateX(-50%) scale(3.2)}}
/* 2) the unit: a 9:16 card — 16:9 video on top, the product panel in the rest */
.unit{position:relative;width:100%;aspect-ratio:9/16;container-type:inline-size;display:flex;flex-direction:column;border-radius:6px;overflow:hidden;background:#fff;box-shadow:0 30px 60px -20px #000;opacity:0;transform:scale(.93)}
.unit.in{opacity:1;transform:none;transition:opacity .45s,transform .55s cubic-bezier(.2,.8,.3,1)}
.wrap{position:relative;width:84%;max-height:92%}
.x{position:absolute;top:-30px;right:0;background:none;border:0;color:#fff;font:600 18px/1 system-ui,sans-serif;padding:4px 6px;cursor:pointer;opacity:0;transition:opacity .3s}
.tag{position:absolute;top:-26px;left:0;color:rgba(255,255,255,.85);font:600 10px system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;opacity:0;transition:opacity .3s}
.wrap.in .x,.wrap.in .tag{opacity:1}
.vid{position:relative;aspect-ratio:16/9;background:#000;flex:none}.vid iframe,.vid video{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;pointer-events:none}
.rp{position:absolute;right:8px;bottom:8px;font:600 12px system-ui,sans-serif;border:0;border-radius:99px;padding:6px 12px;background:rgba(255,255,255,.92);cursor:pointer}
.disp{flex:1;min-height:0;position:relative}
/* the product panel: rows — [logo, headline, subline, button] / [picture] / [chips] — so nothing can overlap */
.pn{--c:${bg};--c2:color-mix(in srgb,${bg} 55%,#000);--lite:color-mix(in srgb,${bg} 55%,#fff);--ink:${ink};--btn:${btn};--btnink:${btnInk};position:absolute;inset:0;overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:linear-gradient(165deg,var(--c) 0%,var(--c2) 100%);color:var(--ink);font-family:system-ui,"Segoe UI",sans-serif}
.pn.img{display:block}
.decor{grid-area:1/1;position:relative;overflow:hidden;z-index:0;pointer-events:none}   /* same grid cell as the words, so the effects can never reach the picture row */
.decor:after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.16) 50%,transparent 62%);transform:translateX(-130%)}
.mesh,.bokeh,.beam{pointer-events:none}.mesh{position:absolute;inset:0;z-index:0}
.mesh i{position:absolute;border-radius:50%;filter:blur(7cqw);opacity:0;will-change:transform}
.mesh i:nth-child(1){width:90cqw;height:90cqw;left:-25cqw;top:-30cqw;background:radial-gradient(closest-side,var(--lite),transparent)}
.mesh i:nth-child(2){width:80cqw;height:80cqw;right:-30cqw;top:25cqw;background:radial-gradient(closest-side,${acc || "var(--lite)"},transparent)}
.mesh i:nth-child(3){width:70cqw;height:70cqw;left:5cqw;bottom:-35cqw;background:radial-gradient(closest-side,var(--lite),transparent)}
.bokeh{position:absolute;inset:0;overflow:hidden;z-index:0}
.bokeh b{position:absolute;left:var(--x);bottom:-12cqw;width:var(--s);aspect-ratio:1;border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.5),rgba(255,255,255,0));opacity:0}
.beam{position:absolute;top:-20%;bottom:-20%;left:0;width:16cqw;background:linear-gradient(90deg,transparent,rgba(255,255,255,.16),transparent);transform:translateX(-60cqw) skewX(-18deg);z-index:1;opacity:0}
.beam.b2{width:8cqw}
.ptop{grid-area:1/1;position:relative;z-index:4;padding:5cqw 7cqw 3cqw;display:flex;flex-direction:column;align-items:flex-start;gap:2.4cqw}
.plogo{height:8cqw;max-width:34cqw;object-fit:contain;opacity:0;transform-origin:left center}
.plogo.light{filter:brightness(0) invert(1)}.plogo.dark{filter:brightness(0)}
.plogo.word{height:auto;font:800 6.4cqw/1 system-ui,sans-serif;letter-spacing:-.02em}
.ptop h2{margin:0;width:86cqw;font:800 var(--hs)/1.04 system-ui,sans-serif;letter-spacing:-.025em}
.w{position:relative;display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.1em}.w>i{position:relative;z-index:1;display:inline-block;font-style:normal;transform:translateY(112%)}
.w:last-child:before{content:"";position:absolute;left:0;right:0;bottom:.1em;height:.26em;background:var(--btn);opacity:.9;transform:scaleX(0);transform-origin:left}
.psub{margin:0;width:86cqw;font:500 var(--ss)/1.36 system-ui,sans-serif;opacity:0}
.cta{position:relative;overflow:hidden;display:inline-block;margin-top:.8cqw;font:700 3.8cqw/1 system-ui,sans-serif;text-decoration:none;color:var(--btnink);background:var(--btn);padding:2.8cqw 5.4cqw;border-radius:99px;opacity:0;box-shadow:0 8px 22px -8px rgba(0,0,0,.45)}
.cta:after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);transform:translateX(-140%)}
/* the picture row: the product in a light pool, or a frame of the brand's own ad — it can never reach the words above */
.vis{grid-row:2;position:relative;min-height:0;overflow:hidden;z-index:2}
.glow{position:absolute;left:50%;bottom:-18cqw;width:84cqw;aspect-ratio:1;margin-left:-42cqw;border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.5),rgba(255,255,255,0));opacity:0}
.rip{position:absolute;left:50%;bottom:6cqw;width:18cqw;aspect-ratio:1;margin-left:-9cqw;border-radius:50%;border:.6cqw solid rgba(255,255,255,.5);opacity:0}
.pshadow{position:absolute;left:50%;bottom:1.5cqw;width:50cqw;height:5cqw;margin-left:-25cqw;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.45),transparent);opacity:0}
.pprod{position:absolute;left:0;right:0;margin:0 auto;bottom:4cqw;width:auto;height:auto;max-width:86%;max-height:calc(100% - 5cqw);object-fit:contain;opacity:0;filter:drop-shadow(0 5cqw 4cqw rgba(0,0,0,.3));transform-origin:50% 100%}
.pprod.photo{max-width:62%;border-radius:4cqw;object-fit:cover;filter:none;box-shadow:0 5cqw 9cqw -3cqw rgba(0,0,0,.55)}
.hero{position:absolute;inset:0;margin:0;overflow:hidden;opacity:0;background:var(--c2)}
.hero img{width:100%;height:100%;object-fit:cover;object-position:75% 30%;display:block;transform:scale(1.5);transform-origin:75% 30%}   /* zoomed on the subject, away from the captions a YouTube frame carries at its lower left */
.pwm{position:absolute;right:-6cqw;bottom:-8cqw;height:90%;max-width:75%;opacity:.14;object-fit:contain}
.pn.img .dimg{width:100%;height:100%;object-fit:cover;display:block}
.strip{grid-row:3;position:relative;z-index:5;height:13cqw;background:var(--btn);color:var(--btnink);display:flex;align-items:center;gap:3.4cqw;padding:0 6cqw;transform:translateY(101%);overflow:hidden;box-shadow:0 -2cqw 6cqw -2cqw rgba(0,0,0,.35)}
.strip span{display:inline-flex;align-items:center;gap:1.4cqw;font:700 var(--cf,3.6cqw)/1 system-ui,sans-serif;white-space:nowrap;opacity:0;transform:translateY(60%) scale(.9)}
.strip span:before{content:"";width:2.1cqw;height:2.1cqw;border-radius:50%;background:currentColor;opacity:.85}
.strip:after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.5) 50%,transparent 65%);transform:translateX(-140%)}
/* motion — starts when the unit opens */
.unit.in .mesh i{animation:meshIn 1.2s ease .1s both}
.unit.in .mesh i:nth-child(1){animation:meshIn 1.2s ease .1s both,drift1 14s ease-in-out 1.3s infinite alternate}
.unit.in .mesh i:nth-child(2){animation:meshIn 1.2s ease .3s both,drift2 17s ease-in-out 1.5s infinite alternate}
.unit.in .mesh i:nth-child(3){animation:meshIn 1.2s ease .5s both,drift3 12s ease-in-out 1.7s infinite alternate}
.unit.in .bokeh b{animation:rise2 var(--d) linear var(--dl) infinite}
.unit.in .beam{animation:beam 7s ease-in-out 2s infinite}.unit.in .beam.b2{animation:beam 7s ease-in-out 4.6s infinite}
.unit.in .plogo{animation:fadeL .8s cubic-bezier(.2,.8,.2,1) .15s both}
.unit.in .w>i{animation:rise .75s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(.35s + var(--k)*.09s)}
.unit.in .w:last-child:before{animation:bar .7s cubic-bezier(.3,.8,.3,1) 1.3s both}
.unit.in .psub{animation:fadeUp .7s ease .95s both}
.unit.in .cta{animation:pop .55s cubic-bezier(.3,1.5,.5,1) 1.25s both,pulse 2.6s ease-in-out 2.3s infinite}
.unit.in .cta:after{animation:shimmer 3.4s ease-in-out 2.2s infinite}
.unit.in .glow{animation:fadeIn 1s ease .6s both,breathe 5s ease-in-out 1.6s infinite alternate}
.unit.in .rip{animation:ripple 4.4s ease-out 1.4s infinite}.unit.in .rip:nth-of-type(2){animation-delay:2.9s}.unit.in .rip:nth-of-type(3){animation-delay:4.4s}
.unit.in .pprod{animation:prodIn 1.05s cubic-bezier(.2,.8,.2,1) .45s both,floaty 5.5s ease-in-out 1.6s infinite alternate}
.unit.in .pshadow{animation:fadeIn .8s ease 1s both,shadowPulse 5.5s ease-in-out 1.6s infinite alternate}
.unit.in .hero{animation:heroIn 1.1s cubic-bezier(.2,.8,.2,1) .4s both}
.unit.in .hero img{animation:kbh 16s ease-out .4s both}
.unit.in .pwm{animation:fadeUp 1s ease .5s both}
.unit.in .strip{animation:stripIn .7s cubic-bezier(.2,.8,.2,1) 1.8s both}
.unit.in .strip span{animation:chipIn .5s cubic-bezier(.3,1.4,.5,1) both;animation-delay:calc(2.25s + var(--k)*.2s)}
.unit.in .strip:after{animation:shimmer 4s ease-in-out 3.4s infinite}
.unit.in .decor:after{animation:sheen 1.5s ease .9s 1 both}
.unit.in .pn.img .dimg{animation:kb 14s ease-out both}
@keyframes meshIn{from{opacity:0}to{opacity:.85}}
@keyframes drift1{from{transform:translate(0,0)}to{transform:translate(22cqw,14cqw)}}
@keyframes drift2{from{transform:translate(0,0)}to{transform:translate(-26cqw,-10cqw)}}
@keyframes drift3{from{transform:translate(0,0)}to{transform:translate(18cqw,-16cqw)}}
@keyframes rise2{0%{opacity:0;transform:translateY(0)}12%{opacity:.5}80%{opacity:.35}100%{opacity:0;transform:translateY(-95cqw)}}
@keyframes beam{0%{opacity:0;transform:translateX(-30cqw) skewX(-18deg)}10%{opacity:1}55%{opacity:1}65%,100%{opacity:0;transform:translateX(130cqw) skewX(-18deg)}}
@keyframes fadeL{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
@keyframes rise{to{transform:none}}
@keyframes bar{to{transform:scaleX(1)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes pop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{box-shadow:0 8px 22px -8px rgba(0,0,0,.45),0 0 0 0 rgba(255,255,255,0)}50%{box-shadow:0 8px 22px -8px rgba(0,0,0,.45),0 0 0 2.2cqw rgba(255,255,255,.14)}}
@keyframes shimmer{0%,55%{transform:translateX(-140%)}100%{transform:translateX(140%)}}
@keyframes prodIn{from{opacity:0;transform:translateY(18%) scale(.88) rotate(-4deg)}to{opacity:1;transform:none}}
@keyframes floaty{from{transform:translateY(0) rotate(0)}to{transform:translateY(-2cqw) rotate(1.2deg)}}
@keyframes breathe{from{transform:scale(.94);opacity:.8}to{transform:scale(1.06);opacity:1}}
@keyframes ripple{0%{transform:scale(.4);opacity:.5}100%{transform:scale(4.2);opacity:0}}
@keyframes shadowPulse{from{transform:scale(1);opacity:1}to{transform:scale(.9);opacity:.75}}
@keyframes heroIn{from{opacity:0;transform:translateY(12%)}to{opacity:1;transform:none}}
@keyframes stripIn{to{transform:none}}
@keyframes chipIn{to{opacity:1;transform:none}}
@keyframes sheen{to{transform:translateX(130%)}}
@keyframes kbh{from{transform:scale(1.68)}to{transform:scale(1.5)}}
@keyframes kb{from{transform:scale(1.14)}to{transform:scale(1)}}
@media(prefers-reduced-motion:reduce){.veil,.unit,.intro{transition:none}.unit *,.intro *{animation-duration:.01s!important;animation-delay:0s!important;animation-iteration-count:1!important}.bokeh{display:none}}
`;
  // runs against a document or a shadow root; returns { open, close }
  const js = `function mkInit(root){const q=(i)=>root.getElementById(i),veil=q("veil"),intro=q("intro"),unit=q("unit"),wrap=q("wrap"),yt=q("yt"),vid=q("vid"),rp=q("replay");
const calm=matchMedia("(prefers-reduced-motion: reduce)").matches,INTRO=calm?0:2300;let t2,onClose=null;
function startVideo(){if(yt&&!yt.src)yt.src=yt.dataset.src;if(vid){vid.currentTime=0;vid.play().catch(()=>{});}if(rp)rp.hidden=true;}
function open(){clearTimeout(t2);unit.classList.remove("in");wrap.classList.remove("in");intro.classList.remove("go","done");void intro.offsetWidth;veil.classList.add("open");
 const go=()=>{intro.classList.add("done");unit.classList.add("in");wrap.classList.add("in");startVideo();};
 if(INTRO){intro.classList.add("go");t2=setTimeout(go,INTRO);}else go();}
function close(){clearTimeout(t2);veil.classList.remove("open");if(vid)vid.pause();if(yt)yt.removeAttribute("src");if(onClose)onClose();}
q("x").onclick=close;veil.addEventListener("click",e=>{if(e.target===veil)close();});
if(vid){vid.addEventListener("ended",()=>{if(rp)rp.hidden=false;});if(rp)rp.onclick=()=>{rp.hidden=true;vid.currentTime=0;vid.play();};}
const geom=()=>{const R=(e)=>{if(!e)return null;const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)};};
const cs=(e)=>getComputedStyle(e),texts=[];
const add=(k,e)=>{if(!e)return;const c=cs(e),r=R(e);if(!r||r.w<1||r.h<1||c.visibility==='hidden'||+c.opacity===0)return;texts.push({k,...r,fs:+parseFloat(c.fontSize).toFixed(1),color:c.color,text:(e.textContent||'').trim().slice(0,80)});};
const all=(s)=>[...root.querySelectorAll(s)];
add('logo-word',root.querySelector('.plogo.word'));all('.ptop h2 .w').forEach((e,i)=>add('headline-'+i,e));add('subline',root.querySelector('.psub'));add('cta',root.querySelector('.cta'));all('.strip span').forEach((e,i)=>add('chip-'+i,e));add('tag',root.querySelector('.tag'));add('close',root.querySelector('.x'));
return {view:{w:innerWidth,h:innerHeight},card:R(unit),video:R(root.querySelector('.vid')),picture:R(root.querySelector('.vis')),logo:R(root.querySelector('.plogo:not(.word)')),product:R(root.querySelector('.pprod')),texts,panelColour:cs(root.querySelector('.pn')||unit).getPropertyValue('--c').trim(),ad:!!(root.querySelector('.tag')&&/advertisement/i.test(root.querySelector('.tag').textContent))};};
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
<title>2-in-1 preview — ${esc(o.brand)}</title><style>
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
.slot .tile em{font:500 12px system-ui,sans-serif;opacity:.85;margin-left:auto;font-style:normal;text-decoration:underline}
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
