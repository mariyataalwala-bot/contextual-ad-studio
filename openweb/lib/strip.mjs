// The in-image creative: a branded strip over the lower part of the article image, in the style of MediaKart's
// in-image units (Bata, Maggi, Airbnb, IndiGo references) — it slides up, the product drops in from the right and
// breaks out above the strip, the headline rises word by word, the button pops, then a second line swaps in.
// Plain HTML + CSS, sized with container units so it fits any image; the animation starts when the host gets data-go.
export const STRIP_VERSION = "strip.v1";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim()); return m ? "#" + m[1].toLowerCase() : null; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (h, to, k) => toHex(rgb(h).map((v, i) => v + (rgb(to)[i] - v) * k));
export const luminance = (h) => { const [r, g, b] = rgb(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

// words wrapped for the word-by-word rise
const words = (t, cls, d0) => esc(t).split(/\s+/).filter(Boolean).map((w, i) => `<span class="wd"><span class="${cls}" style="animation-delay:${(d0 + i * 0.08).toFixed(2)}s">${w}</span></span>`).join(" ");

/**
 * @param {{ brand: string, headline: string, subline?: string, cta: string, colour: string, accent?: string|null, productUrl: string, productMode: "alpha"|"plain-bg"|"photo"|"scene", logoUrl?: string|null }} o
 */
export function stripHtml(o) {
  const c = hex(o.colour) || "#1d2b53", light = luminance(c) > 0.62;
  const ink = light ? "#141414" : "#ffffff", deep = mix(c, "#000000", light ? 0.18 : 0.38), glow = mix(c, "#ffffff", 0.35);
  // the product sits on a panel of the second brand colour (when it differs enough), so a pack the colour of the strip still stands out
  const a2 = hex(o.accent), panel = a2 && Math.abs(luminance(a2) - luminance(c)) > 0.18 ? a2 : null;
  const ctaBg = light ? "#141414" : "#ffffff", ctaInk = light ? "#ffffff" : c;
  const cut = o.productMode === "alpha" || o.productMode === "plain-bg", scene = o.productMode === "scene";
  const logo = o.logoUrl ? `<div class="lg"><img src="${esc(o.logoUrl)}" alt="${esc(o.brand)}"></div>` : `<div class="lg lgt">${esc(o.brand)}</div>`;
  return `<style>
:host{display:block}
.w{position:absolute;inset:0;container-type:size;overflow:hidden;font-family:Poppins,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.s{position:absolute;left:0;right:0;bottom:0;height:max(46cqh,26cqw);max-height:56cqh;background:linear-gradient(105deg,${c} 0%,${c} 52%,${deep} 100%);box-shadow:0 -1cqw 3.4cqw rgba(0,0,0,.28);transform:translateY(105%)}
.s:before{content:"";position:absolute;left:0;right:0;top:0;height:.55cqw;background:linear-gradient(90deg,${glow},rgba(255,255,255,.75),${glow})}
.pn{position:absolute;right:0;top:0;bottom:0;width:44%;background:linear-gradient(160deg,${panel ? mix(panel, "#ffffff", 0.12) : "transparent"},${panel || "transparent"} 70%);clip-path:polygon(22% 0,100% 0,100% 100%,0 100%);transform:translateX(100%)}
:host([data-go]) .pn{animation:up .6s .2s cubic-bezier(.2,.9,.25,1) forwards}
.ring{position:absolute;right:-6cqw;top:50%;width:46cqw;height:46cqw;margin-top:-23cqw;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.26) 0%,rgba(255,255,255,.08) 55%,rgba(255,255,255,0) 70%);transform:scale(.3);opacity:0}
.sh{position:absolute;top:0;bottom:0;left:-40%;width:28%;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.28),rgba(255,255,255,0));transform:skewX(-18deg);opacity:0}
.lg{position:absolute;left:3.6cqw;top:2.3cqw;height:5.2cqw;padding:.8cqw 2cqw;box-sizing:border-box;background:#fff;border-radius:4cqw;box-shadow:0 .4cqw 1.4cqw rgba(0,0,0,.18);display:flex;align-items:center;opacity:0;transform:scale(.7);transform-origin:left center}
.lg img{height:100%;width:auto;max-width:26cqw;object-fit:contain;display:block}
.lgt{font:700 3.2cqw/1 Poppins,system-ui;color:${c};letter-spacing:.02em}
.tx{position:absolute;left:3.6cqw;width:52cqw;top:8.7cqw;color:${ink}}
.hd,.sb{position:absolute;left:0;right:0;top:0;font-weight:700;font-size:var(--fs,4.8cqw);line-height:1.08;letter-spacing:-.01em;text-shadow:${light ? "none" : "0 .3cqw 1.2cqw rgba(0,0,0,.22)"}}
.sb{font-weight:600;font-size:var(--fs2,4.2cqw);line-height:1.12}
.wd{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.4cqw}
.w1,.w2{display:inline-block;transform:translateY(115%);opacity:0}
.cta{position:absolute;left:3.6cqw;bottom:2.3cqw;padding:1.05cqw 3cqw;border-radius:5cqw;background:${ctaBg};color:${ctaInk};font:600 2.9cqw/1.15 Poppins,system-ui;letter-spacing:.01em;overflow:hidden;transform:scale(.4);opacity:0;transform-origin:left center;box-shadow:0 .5cqw 1.6cqw rgba(0,0,0,.2)}
.cta:after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:40%;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0));transform:skewX(-20deg)}
.p{position:absolute;right:2.4cqw;bottom:1.4cqw;opacity:0;transform:translateX(60cqw) rotate(12deg)}
.p img{display:block;width:auto;height:100%;max-width:100%;object-fit:contain;object-position:right bottom}
.p.cut{height:calc(max(46cqh,26cqw) * 1.2);max-height:60cqh;width:40cqw;display:flex;justify-content:flex-end;align-items:flex-end;filter:drop-shadow(0 1.2cqw 1.6cqw rgba(0,0,0,.35))}
.p.cut img{height:auto;max-height:100%}
.p.card{height:calc(max(46cqh,26cqw) - 5cqw);max-height:46cqh;bottom:2.5cqw;right:3.4cqw;padding:.8cqw;background:#fff;border-radius:2.2cqw;box-shadow:0 1cqw 2.6cqw rgba(0,0,0,.3)}
.p.card img{border-radius:1.6cqw;max-width:36cqw;object-fit:cover}
.sc{position:absolute;right:0;top:0;bottom:0;width:50%;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 34%);mask-image:linear-gradient(90deg,transparent 0,#000 34%);opacity:0;transform:scale(1.12)}
.sc img{width:100%;height:100%;object-fit:cover;display:block}
:host([data-go]) .sc{animation:scene 1.1s .3s cubic-bezier(.2,.8,.3,1) forwards,drift 9s 1.4s ease-in-out infinite alternate}
@keyframes scene{to{opacity:1;transform:scale(1.02)}}
@keyframes drift{to{transform:scale(1.08) translateX(-1.5%)}}
.x{position:absolute;right:1.2cqw;top:1.2cqw;width:4.2cqw;height:4.2cqw;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font:600 3.2cqw/4.2cqw system-ui;text-align:center;z-index:5;opacity:0}
.ad{position:absolute;right:6.4cqw;top:1.5cqw;font:600 2.2cqw/1 system-ui;color:#fff;background:rgba(0,0,0,.45);padding:.7cqw 1.2cqw;border-radius:1cqw;z-index:5;opacity:0}
:host([data-go]) .s{animation:up .55s cubic-bezier(.2,.9,.25,1) forwards}
:host([data-go]) .ring{animation:ring .8s .25s cubic-bezier(.2,.9,.3,1) forwards}
:host([data-go]) .sh{animation:sweep 1s 1s ease-in-out forwards}
:host([data-go]) .lg{animation:pop .45s .55s cubic-bezier(.2,1.3,.4,1) forwards}
:host([data-go]) .p{animation:drop .8s .35s cubic-bezier(.18,1.22,.4,1) forwards,float 3.2s 1.4s ease-in-out infinite}
:host([data-go]) .w1{animation:rise .45s cubic-bezier(.2,.9,.3,1) forwards}
:host([data-go]) .tx:not(.one) .hd{animation:out .4s 3.9s ease-in forwards}
:host([data-go]) .w2{animation:rise .45s cubic-bezier(.2,.9,.3,1) forwards}
:host([data-go]) .cta{animation:pop .5s 1.35s cubic-bezier(.2,1.5,.4,1) forwards}
:host([data-go]) .cta:after{animation:shine 2.6s 2.2s ease-in-out infinite}
:host([data-go]) .x,:host([data-go]) .ad{animation:fade .3s .7s forwards}
@keyframes up{to{transform:none}}
@keyframes ring{to{transform:none;opacity:1}}
@keyframes sweep{0%{opacity:1;left:-40%}100%{opacity:1;left:120%}}
@keyframes pop{to{transform:none;opacity:1}}
@keyframes drop{to{transform:none;opacity:1}}
@keyframes float{0%,100%{translate:0 0}50%{translate:0 -1.1cqw}}
@keyframes rise{to{transform:none;opacity:1}}
@keyframes out{to{transform:translateY(-40%);opacity:0}}
@keyframes shine{0%{left:-60%}45%,100%{left:130%}}
@keyframes fade{to{opacity:1}}
</style>
<div class="w"><div class="s">${scene ? `<div class="sc"><img src="${esc(o.productUrl)}" alt=""></div>` : `${panel ? `<div class="pn"></div>` : ""}<div class="ring"></div>`}<div class="sh"></div>${logo}
<div class="tx${o.subline ? "" : " one"}"><div class="hd">${words(o.headline, "w1", 0.75)}</div>${o.subline ? `<div class="sb">${words(o.subline, "w2", 4.15)}</div>` : ""}</div>
<div class="cta">${esc(o.cta)} &rsaquo;</div></div>
${scene ? "" : `<div class="p ${cut ? "cut" : "card"}"><img src="${esc(o.productUrl)}" alt=""></div>`}
<span class="ad">Ad</span><span class="x">&times;</span></div>`;
}

// Runs inside the page after the strip is placed: shrinks the headline / second line until each fits in two lines
// and above the button, so long copy never spills.
/* global getComputedStyle */
export function fitStrip(host) {
  // layout sizes (offsetTop / offsetHeight), not on-screen boxes: the entry animations scale and move these elements
  const root = host.shadowRoot, q = (s) => /** @type {HTMLElement|null} */ (root.querySelector(s));
  const tx = q(".tx"), cta = q(".cta"), li = /** @type {HTMLImageElement|null} */ (root.querySelector(".lg img"));
  // a round / square logo gets a taller pill when the copy still fits under it; otherwise the standard pill
  const layouts = li && li.naturalWidth / li.naturalHeight < 2.4 ? [[7.4, 10.9], [6.2, 9.7], [5.2, 8.7]] : [[5.2, 8.7]];
  const fits = (el) => el.offsetHeight <= (parseFloat(getComputedStyle(el).lineHeight) || 10) * 2.05 && el.offsetHeight <= cta.offsetTop - tx.offsetTop - el.offsetTop - 3;
  for (const [i, [logoH, top]] of layouts.entries()) {
    q(".lg").style.height = logoH + "cqw"; tx.style.top = top + "cqw";
    let ok = true;
    for (const [sel, v, start] of /** @type {[string, string, number][]} */ ([[".hd", "--fs", 4.8], [".sb", "--fs2", 4.2]])) {
      const el = q(sel); if (!el) continue;
      let k = 0; for (; start - k * 0.2 >= 2.99; k++) { tx.style.setProperty(v, (start - k * 0.2).toFixed(1) + "cqw"); if (fits(el)) break; }
      if (!fits(el)) ok = false;
    }
    if (ok || i === layouts.length - 1) break;
  }
}
