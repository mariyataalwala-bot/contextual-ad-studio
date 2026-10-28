// The in-image creative: a branded strip over the lower part of the article image, in the style of MediaKart's
// in-image units (Bata, Maggi, Airbnb, IndiGo references). Six designs, picked to suit the brand and product:
//   bold    — FMCG, sales, snacks: brand-colour strip, product breaks out above it, contrast panel (the original)
//   luxe    — jewellery, beauty, premium fashion: deep gradient, gold lines, serif type, product in a gold-ringed
//             circle, twinkling sparkles, slow and elegant
//   sport   — shoes, sportswear, fitness: angled strip, diagonal stripes, condensed capitals, speed lines, product slams in
//   fresh   — drinks, food: floating rounded card, bubbles (drinks) or steam (food), playful type, product bounces in on a splash
//   tech    — phones, electronics: dark glass with a fine grid, a light beam, product rises tilted with a reflection
//   journey — travel, stays, services: photo-led with a slow zoom, curved brand panel, a dotted route drawing to a plane / pin
// No white patches: the logo sits directly on the ad (in its colours when it stands out, otherwise all-white or
// all-black like a brand's reversed logo; a self-contained badge as it is; a faint frosted chip only when the logo could
// not be separated), and a product photo that could not be cut out melts into a soft brand-tinted glow.
// Plain HTML + CSS, sized with container units so it fits any image; the animation starts when the host gets data-go.
export const STRIP_VERSION = "strip.v3";
export const STYLES = ["bold", "luxe", "sport", "fresh", "tech", "journey"];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim()); return m ? "#" + m[1].toLowerCase() : null; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (h, to, k) => toHex(rgb(h).map((v, i) => v + (rgb(to)[i] - v) * k));
export const luminance = (h) => { const [r, g, b] = rgb(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// WCAG contrast between two colours (relative luminance, gamma-corrected)
const relLum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// how the logo is shown on the colour behind it: "colour" (stands out as it is), "white" / "black" (reversed, one colour),
// "badge" (a filled logo with its own background, e.g. Maggi's oval), "chip" (could not be separated: faint frosted chip)
// A logo with light parts (Sprite's white outline, a white letter inside a coloured disc) loses them when shown
// all-white, so it keeps its colours (or, when even that does not stand out, sits on a faint frosted chip).
export function logoMode({ kind, ink, light = 0, behind, style }) {
  if (kind === "badge") return "badge";
  if (kind === "photo") return "chip";
  const k = hex(ink) || "#222222";
  if (light >= 0.08) return contrast(k, behind) >= 2 ? "colour" : "chip";
  if ((style === "tech" || style === "luxe") && relLum(behind) < 0.25) return "white";   // sleek and elegant designs: one-colour logo
  if (contrast(k, behind) >= 3.2) return "colour";
  return relLum(behind) < 0.4 ? "white" : "black";
}
// fine film grain over the strips (print-like texture instead of flat digital colour)
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;
const ARROW = `<svg class="ar" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9.2M8.6 4.4 12.2 8l-3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Display fonts of the designs (Google Fonts, loaded into the page when the mock is recorded; Poppins is served locally)
const FONTS = { luxe: "Playfair+Display:ital,wght@0,600;0,700;1,500", sport: "Anton", fresh: "Baloo+2:wght@600;800", tech: "Space+Grotesk:wght@500;700" };
export const styleFontsUrl = (style) => FONTS[style] ? `https://fonts.googleapis.com/css2?family=${FONTS[style]}&display=block` : null;
export const styleFontFaces = (style) => ({ luxe: ["600 20px 'Playfair Display'", "italic 500 20px 'Playfair Display'"], sport: ["20px Anton"], fresh: ["800 20px 'Baloo 2'", "600 20px 'Baloo 2'"], tech: ["700 20px 'Space Grotesk'", "500 20px 'Space Grotesk'"] })[style] || [];

// words wrapped for the word-by-word entrance
const words = (t, cls, d0, step = 0.08) => esc(t).split(/\s+/).filter(Boolean).map((w, i) => `<span class="wd"><span class="${cls}" style="animation-delay:${(d0 + i * step).toFixed(2)}s">${w}</span></span>`).join(" ");
const n = (k, f) => Array.from({ length: k }, (_, i) => f(i)).join("");

// Each design: starting sizes for fitStrip (logo height, text top, headline / second-line font size, in cqw),
// its own CSS (on top of the shared base) and its decorations.
function design(style, o, t) {
  const { c, light, deep, panel, scene } = t;
  if (style === "luxe") {
    const gold = "#d6b46a", base = mix(c, "#000000", luminance(c) > 0.5 ? 0.55 : 0.25);
    return { lg: 4.8, tx: 8.6, fs: 5, fs2: 3.9, ink: "#fff8ec", css: `
.s{background:linear-gradient(118deg,${base} 0%,${mix(base, c, 0.55)} 58%,${mix(c, "#ffffff", 0.08)} 100%);box-shadow:0 -1cqw 3cqw rgba(0,0,0,.3)}
.s:before{height:.3cqw;background:linear-gradient(90deg,transparent,${gold} 20%,#fff3cf 50%,${gold} 80%,transparent)}
.hd,.sb{font-family:'Playfair Display',Georgia,serif;font-weight:600;letter-spacing:.005em;line-height:1.1}
.sb{font-style:italic;font-weight:500}
.cta{background:transparent;color:${gold};border:.25cqw solid ${gold};border-radius:.6cqw;font:600 2.3cqw/1.2 Poppins,system-ui;letter-spacing:.16em;text-transform:uppercase;box-shadow:none}
.cta:after{background:linear-gradient(100deg,transparent,rgba(255,240,200,.45),transparent)}
.ring{right:-2cqw;width:40cqw;height:40cqw;margin-top:-20cqw;background:radial-gradient(circle,rgba(255,244,214,.38) 0%,rgba(255,244,214,.1) 50%,transparent 70%)}
.p.photo{right:6cqw}
.sp{position:absolute;width:2.2cqw;height:2.2cqw;opacity:0;z-index:4;background:radial-gradient(circle,#fff 0 18%,transparent 19%),conic-gradient(from 45deg,transparent 0 10%,#fff6d8 12% 13%,transparent 15% 35%,#fff6d8 37% 38%,transparent 40% 60%,#fff6d8 62% 63%,transparent 65% 85%,#fff6d8 87% 88%,transparent 90%);filter:drop-shadow(0 0 .6cqw #ffe9a8)}
:host([data-go]) .s{animation:upSoft .9s cubic-bezier(.25,.8,.25,1) forwards}
:host([data-go]) .w1,:host([data-go]) .w2{animation:fadeIn .8s ease-out forwards}
.w1,.w2{transform:translateY(30%);filter:blur(.6cqw)}
:host([data-go]) .p{animation:glide 1.1s .45s cubic-bezier(.25,.8,.25,1) forwards,float 4.5s 1.6s ease-in-out infinite}
.p{transform:translateY(12%) scale(.92)}
:host([data-go]) .sp{animation:twinkle 2.4s ease-in-out infinite}
@keyframes upSoft{0%{transform:translateY(105%)}100%{transform:none}}
@keyframes fadeIn{to{transform:none;opacity:1;filter:none}}
@keyframes glide{to{transform:none;opacity:1}}
@keyframes twinkle{0%,100%{opacity:0;transform:scale(.3) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}`,
      deco: n(6, (i) => `<i class="sp" style="right:${[30, 8, 22, 4, 34, 14][i]}cqw;bottom:${[20, 24, 4, 12, 9, 28][i]}cqw;animation-delay:${(1.4 + i * 0.37).toFixed(2)}s"></i>`),
      words: { d: 0.8, step: 0.13 } };
  }
  if (style === "sport") {
    const pop = panel || (light ? "#111111" : "#ffd400"), popInk = luminance(pop) > 0.55 ? "#111" : "#fff";
    return { lg: 4.8, tx: 10, fs: 6.2, fs2: 4.4, ink: light ? "#111" : "#fff", css: `
.s{clip-path:polygon(0 16%,100% 0,100% 100%,0 100%);background:linear-gradient(100deg,${mix(c, "#000000", 0.15)} 0%,${c} 60%,${deep} 100%);box-shadow:none}
.s:before{display:none}
.st{position:absolute;inset:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.07) 0 1.6cqw,transparent 1.6cqw 4.2cqw)}
.lg{top:4.4cqw}
.hd,.sb{font-family:Anton,Impact,'Arial Narrow',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.015em;line-height:1}
.sb{font-family:Poppins,system-ui;font-weight:700;text-transform:none;line-height:1.1}
.cta{background:${pop};color:${popInk};border-radius:0;transform:skewX(-12deg) scale(.4);font:700 2.7cqw/1.15 Poppins,system-ui;text-transform:uppercase;letter-spacing:.06em;padding:1.1cqw 3.2cqw}
.sl{position:absolute;height:.45cqw;border-radius:1cqw;background:linear-gradient(90deg,transparent,rgba(255,255,255,.85));opacity:0;z-index:3}
.w1,.w2{transform:scale(1.8);opacity:0}
.p{transform:translateX(70cqw) skewX(-14deg);filter:blur(.8cqw)}
:host([data-go]) .s{animation:slam .45s cubic-bezier(.3,1.2,.4,1) forwards}
:host([data-go]) .w1,:host([data-go]) .w2{animation:stamp .32s cubic-bezier(.3,1.4,.5,1) forwards}
:host([data-go]) .p{animation:dash .55s .35s cubic-bezier(.2,1.25,.35,1) forwards,float 2.6s 1.2s ease-in-out infinite}
:host([data-go]) .sl{animation:streak .7s ease-out forwards}
:host([data-go]) .cta{animation:popSk .45s 1.3s cubic-bezier(.2,1.5,.4,1) forwards}
@keyframes slam{0%{transform:translateY(105%)}100%{transform:none}}
@keyframes stamp{to{transform:none;opacity:1}}
@keyframes dash{to{transform:none;opacity:1;filter:none}}
@keyframes streak{0%{opacity:0;transform:translateX(40cqw)}30%{opacity:1}100%{opacity:0;transform:translateX(-60cqw)}}
@keyframes popSk{to{transform:skewX(-12deg);opacity:1}}`,
      deco: `<div class="st"></div>`, after: n(5, (i) => `<i class="sl" style="right:${4 + i * 3}cqw;width:${18 + i * 4}cqw;bottom:${6 + i * 4.2}cqw;animation-delay:${(0.3 + i * 0.06).toFixed(2)}s"></i>`),
      words: { d: 0.7, step: 0.07 } };
  }
  if (style === "fresh") {
    const splash = panel || mix(c, "#ffffff", 0.45), drink = o.motif !== "steam";
    return { lg: 4.8, tx: 8.4, fs: 5.4, fs2: 4.1, ink: light ? "#13231a" : "#ffffff", css: `
.s{left:2.4cqw;right:2.4cqw;bottom:2.2cqw;height:calc(var(--sh) - 2cqw);border-radius:4.2cqw;background:linear-gradient(125deg,${mix(c, "#ffffff", 0.12)} 0%,${c} 55%,${deep} 100%);box-shadow:0 1.4cqw 3.6cqw rgba(0,0,0,.3)}
.s:before{display:none}
.lg{left:3.4cqw;top:2.2cqw}
.tx{left:3.4cqw}.cta{left:3.4cqw;bottom:2.4cqw}
.hd,.sb{font-family:'Baloo 2',Poppins,system-ui;font-weight:800;line-height:1.02;letter-spacing:0}
.sb{font-weight:600}
.cta{background:${light ? "#13231a" : "#ffffff"};color:${light ? "#ffffff" : contrast(c, "#ffffff") >= 3 ? c : "#13231a"};border-radius:5cqw;font:800 2.9cqw/1.15 'Baloo 2',Poppins,system-ui}
.sp{position:absolute;right:5cqw;bottom:2.2cqw;width:25cqw;height:25cqw;border-radius:50%;background:radial-gradient(circle at 38% 32%,${mix(splash, "#ffffff", 0.4)},${splash} 62%,transparent 64%);opacity:.92;transform:scale(0);z-index:1}
.p{z-index:2;transform:translateY(70%) scale(.6)}
.bb{position:absolute;border-radius:50%;border:.3cqw solid rgba(255,255,255,.75);background:rgba(255,255,255,.18);opacity:0;z-index:3}
.stm{position:absolute;width:1.1cqw;height:8cqw;border-radius:2cqw;background:linear-gradient(transparent,rgba(255,255,255,.55),transparent);filter:blur(.6cqw);opacity:0;z-index:3}
.w1,.w2{transform:scale(.3);opacity:0}
:host([data-go]) .s{animation:bounceUp .7s cubic-bezier(.2,1.35,.4,1) forwards}
:host([data-go]) .w1,:host([data-go]) .w2{animation:boing .5s cubic-bezier(.2,1.6,.4,1) forwards}
:host([data-go]) .sp{animation:splash .7s .3s cubic-bezier(.2,1.5,.4,1) forwards}
:host([data-go]) .p{animation:hop .75s .45s cubic-bezier(.2,1.5,.4,1) forwards,float 2.8s 1.3s ease-in-out infinite}
:host([data-go]) .bb{animation:bubble 3.2s ease-in infinite}
:host([data-go]) .stm{animation:steam 2.8s ease-in-out infinite}
:host([data-go]) .cta{animation:pop .5s 1.35s cubic-bezier(.2,1.5,.4,1) forwards,wiggle 3s 2.4s ease-in-out infinite}
@keyframes bounceUp{0%{transform:translateY(120%)}100%{transform:none}}
@keyframes boing{to{transform:none;opacity:1}}
@keyframes splash{to{transform:none}}
@keyframes hop{to{transform:none;opacity:1}}
@keyframes bubble{0%{opacity:0;transform:translateY(0) scale(.6)}15%{opacity:1}100%{opacity:0;transform:translateY(-30cqw) scale(1.1)}}
@keyframes steam{0%{opacity:0;transform:translateY(0) scaleX(1)}45%{opacity:.5}100%{opacity:0;transform:translateY(-6cqw) scaleX(1.8) rotate(6deg)}}
@keyframes wiggle{0%,90%,100%{rotate:0deg}93%{rotate:-4deg}96%{rotate:4deg}}`,
      deco: "", after: `<div class="sp"></div>` + (drink
        ? n(9, (i) => `<i class="bb" style="right:${[8, 16, 26, 12, 30, 20, 6, 24, 34][i]}cqw;bottom:${[3, 6, 2, 10, 5, 1, 8, 12, 4][i]}cqw;width:${[1.6, 2.6, 1.2, 2, 1.4, 3, 1.1, 1.8, 2.2][i]}cqw;height:${[1.6, 2.6, 1.2, 2, 1.4, 3, 1.1, 1.8, 2.2][i]}cqw;animation-delay:${(1 + i * 0.33).toFixed(2)}s"></i>`)
        : n(3, (i) => `<i class="stm" style="right:${14 + i * 6}cqw;bottom:${24 + (i % 2) * 2}cqw;animation-delay:${(1.2 + i * 0.6).toFixed(2)}s"></i>`)),
      words: { d: 0.8, step: 0.1 } };
  }
  if (style === "tech") {
    const neon = panel && luminance(panel) > 0.15 ? panel : mix(c, "#ffffff", 0.25);
    return { lg: 4.6, tx: 8.4, fs: 4.9, fs2: 3.8, ink: "#f2f5ff", css: `
.s{background:linear-gradient(100deg,#07090e 0%,#101521 55%,${mix(c, "#000000", 0.45)} 100%);box-shadow:0 -1cqw 3cqw rgba(0,0,0,.45)}
.s:before{height:.3cqw;background:linear-gradient(90deg,transparent,${neon},transparent)}
.gr{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:3.2cqw 3.2cqw;-webkit-mask-image:linear-gradient(90deg,transparent,#000 60%);mask-image:linear-gradient(90deg,transparent,#000 60%)}
.bm{position:absolute;top:-30%;bottom:-30%;left:-30%;width:14cqw;background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);transform:skewX(-24deg);opacity:0;z-index:4}
.hd,.sb{font-family:'Space Grotesk',Poppins,system-ui;font-weight:700;letter-spacing:-.015em}
.sb{font-weight:500;color:#c8d2ea}
.cta{background:rgba(255,255,255,.06);color:#fff;border:.25cqw solid ${neon};font:500 2.7cqw/1.15 'Space Grotesk',Poppins,system-ui;box-shadow:0 0 2cqw ${neon}55}
.p{perspective:60cqw}
.p img{-webkit-box-reflect:below .3cqw linear-gradient(transparent 70%,rgba(255,255,255,.22))}
.p.cut{filter:drop-shadow(0 0 2.4cqw ${neon}66) drop-shadow(0 1.2cqw 1.6cqw rgba(0,0,0,.5))}
.p{transform:translateY(40%) rotateY(-28deg)}
.w1,.w2{clip-path:inset(0 100% 0 0);transform:none;opacity:1}
:host([data-go]) .w1,:host([data-go]) .w2{animation:wipe .5s cubic-bezier(.4,0,.2,1) forwards}
:host([data-go]) .p{animation:rise3d 1s .35s cubic-bezier(.2,.9,.3,1) forwards,float 4s 1.5s ease-in-out infinite}
:host([data-go]) .bm{animation:beam 1.4s 1.1s ease-in-out forwards,beam 1.4s 5.2s ease-in-out forwards}
@keyframes wipe{to{clip-path:inset(0 0 0 0)}}
@keyframes rise3d{to{transform:rotateY(-8deg);opacity:1}}
@keyframes beam{0%{opacity:0;left:-30%}20%{opacity:1}100%{opacity:0;left:130%}}`,
      deco: `<div class="gr"></div>`, after: `<i class="bm"></i>`, words: { d: 0.75, step: 0.09 } };
  }
  if (style === "journey") {
    const fly = o.motif !== "pin";
    return { lg: 5.2, tx: 8.7, fs: 4.8, fs2: 4.1, ink: light ? "#141414" : "#fff", css: `
.s{background:${scene ? "transparent" : `linear-gradient(105deg,${c},${deep})`};box-shadow:0 -1cqw 3.4cqw rgba(0,0,0,.28)}
.s:before{display:none}
.pa{position:absolute;left:0;top:0;bottom:0;width:62%;background:linear-gradient(105deg,${c} 0%,${mix(c, "#000000", 0.1)} 100%);clip-path:ellipse(100% 140% at 0% 50%);z-index:1;transform:translateX(-100%)}
.sc{width:62%;-webkit-mask-image:none;mask-image:none}
.lg,.tx,.cta{z-index:2}
.rt{position:absolute;right:4cqw;bottom:3cqw;width:30cqw;height:calc(var(--sh) - 7cqw);max-height:48cqh;z-index:3;overflow:visible}
.rt path{fill:none;stroke:#fff;stroke-width:1.1;stroke-dasharray:2.2 2.6;stroke-linecap:round;stroke-dashoffset:0;opacity:.95;filter:drop-shadow(0 0 .4cqw rgba(0,0,0,.5))}
.rt .mk{opacity:0}
:host([data-go]) .pa{animation:panIn .7s .1s cubic-bezier(.2,.9,.25,1) forwards}
:host([data-go]) .rt path{animation:drawPath 1.8s 1.1s ease-in-out forwards}
:host([data-go]) .rt .mk{animation:fade .4s 2.7s forwards}
.rt path{clip-path:inset(0 100% 0 0)}
@keyframes panIn{to{transform:none}}
@keyframes drawPath{to{clip-path:inset(0 0 0 0)}}`,
      deco: `<div class="pa"></div>`,
      after: `<svg class="rt" viewBox="0 0 100 60" preserveAspectRatio="none"><path d="M4 54 C 26 50, 30 18, 58 24 S 86 10, 94 6"/><text class="mk" x="${fly ? 88 : 89}" y="${fly ? 10 : 9}" font-size="${fly ? 10 : 11}" fill="#fff">${fly ? "✈" : "📍"}</text></svg>`,
      words: { d: 0.8, step: 0.08 } };
  }
  return { lg: 5.2, tx: 8.7, fs: 4.8, fs2: 4.2, ink: light ? "#141414" : "#ffffff", css: "", deco: "", words: { d: 0.75, step: 0.08 } };   // bold: the base CSS below
}

/**
 * @param {{ brand: string, headline: string, subline?: string, cta: string, colour: string, accent?: string|null, productUrl: string, productMode: "alpha"|"plain-bg"|"photo"|"scene", logoUrl?: string|null, logoKind?: string|null, logoInk?: string|null, logoLight?: number, style?: string, motif?: string }} o
 */
export function stripHtml(o) {
  const style = STYLES.includes(o.style) ? o.style : "bold";
  const c = hex(o.colour) || "#1d2b53", light = luminance(c) > 0.62;
  const deep = mix(c, "#000000", light ? 0.18 : 0.38), glow = mix(c, "#ffffff", 0.35);
  // the product sits on a panel of the second brand colour (when it differs enough), so a pack the colour of the strip still stands out
  const a2 = hex(o.accent), panel = a2 && Math.abs(luminance(a2) - luminance(c)) > 0.18 ? a2 : null;
  const cut = o.productMode === "alpha" || o.productMode === "plain-bg", scene = o.productMode === "scene";
  const d = design(style, o, { c, light, deep, glow, panel, cut, scene });
  const ink = d.ink;
  const ctaBg = light ? "#141414" : "#ffffff", ctaInk = light ? "#ffffff" : contrast(c, "#ffffff") >= 3 ? c : "#141414";
  // the colour right behind the logo in each design, for the contrast check
  const behind = { bold: c, luxe: mix(c, "#000000", luminance(c) > 0.5 ? 0.55 : 0.25), sport: mix(c, "#000000", 0.15), fresh: mix(c, "#ffffff", 0.12), tech: "#0b0e15", journey: c }[style];
  const lmode = o.logoUrl ? logoMode({ kind: o.logoKind || "mark", ink: o.logoInk, light: o.logoLight || 0, behind, style }) : "text";
  const logo = o.logoUrl ? `<div class="lg ${lmode}"><img src="${esc(o.logoUrl)}" alt="${esc(o.brand)}"></div>` : `<div class="lg lgt">${esc(o.brand)}</div>`;
  const halo = style === "luxe" ? "#f4e7cf" : mix(c, "#ffffff", 0.86);
  const back = style === "bold" ? `${scene ? "" : panel ? `<div class="pn"></div>` : ""}<div class="ring"></div>` : style === "luxe" ? `<div class="ring"></div>` : "";
  return `<style>
:host{display:block}
.w{position:absolute;inset:0;container-type:size;overflow:hidden;font-family:Poppins,system-ui,sans-serif;-webkit-font-smoothing:antialiased;--sh:max(46cqh,26cqw)}
.s{position:absolute;left:0;right:0;bottom:0;height:max(46cqh,26cqw);max-height:56cqh;background:linear-gradient(105deg,${c} 0%,${c} 52%,${deep} 100%);box-shadow:0 -1cqw 3.4cqw rgba(0,0,0,.28);transform:translateY(105%)}
.s:before{content:"";position:absolute;left:0;right:0;top:0;height:.3cqw;background:linear-gradient(90deg,transparent,rgba(255,255,255,.6) 30%,rgba(255,255,255,.6) 70%,transparent);opacity:.8}
.s:after{content:"";position:absolute;inset:0;background-image:${GRAIN};background-size:24cqw;opacity:.09;mix-blend-mode:overlay;pointer-events:none;border-radius:inherit}
.pn{position:absolute;right:0;top:0;bottom:0;width:44%;background:linear-gradient(160deg,${panel ? mix(panel, "#ffffff", 0.12) : "transparent"},${panel || "transparent"} 70%);clip-path:polygon(22% 0,100% 0,100% 100%,0 100%);transform:translateX(100%)}
:host([data-go]) .pn{animation:up .6s .2s cubic-bezier(.2,.9,.25,1) forwards}
.ring{position:absolute;right:-6cqw;top:50%;width:46cqw;height:46cqw;margin-top:-23cqw;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.26) 0%,rgba(255,255,255,.08) 55%,rgba(255,255,255,0) 70%);transform:scale(.3);opacity:0}
.sh{position:absolute;top:0;bottom:0;left:-40%;width:28%;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.28),rgba(255,255,255,0));transform:skewX(-18deg);opacity:0}
.lg{position:absolute;left:3.6cqw;top:2.3cqw;height:5.2cqw;box-sizing:border-box;display:flex;align-items:center;opacity:0;transform:translateY(35%);transform-origin:left center;z-index:2}
.lg img{height:100%;width:auto;max-width:28cqw;object-fit:contain;display:block}
.lg.colour img{filter:drop-shadow(0 .2cqw .6cqw rgba(0,0,0,.18))}
.lg.white img{filter:brightness(0) invert(1) drop-shadow(0 .2cqw .7cqw rgba(0,0,0,.28))}
.lg.black img{filter:brightness(0);opacity:.86}
.lg.badge img{filter:drop-shadow(0 .35cqw .9cqw rgba(0,0,0,.3))}
.lg.chip{padding:.5cqw 1.4cqw;border-radius:1.2cqw;background:rgba(255,255,255,.14);border:.15cqw solid rgba(255,255,255,.32);-webkit-backdrop-filter:blur(.8cqw);backdrop-filter:blur(.8cqw)}
.lgt{font:800 3.5cqw/1 Poppins,system-ui;color:${ink};letter-spacing:.03em;text-shadow:0 .2cqw .8cqw rgba(0,0,0,.2)}
.tx{position:absolute;left:3.6cqw;width:52cqw;top:8.7cqw;color:${ink}}
.hd,.sb{position:absolute;left:0;right:0;top:0;text-wrap:balance;font-weight:700;font-size:var(--fs,${d.fs}cqw);line-height:1.08;letter-spacing:-.01em;text-shadow:${light && style === "bold" ? "none" : "0 .3cqw 1.2cqw rgba(0,0,0,.22)"}}
.sb{font-weight:600;font-size:var(--fs2,${d.fs2}cqw);line-height:1.12}
.wd{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.4cqw}
.w1,.w2{display:inline-block;transform:translateY(115%);opacity:0}
.cta{position:absolute;left:3.6cqw;bottom:2.3cqw;display:inline-flex;align-items:center;gap:.9cqw;padding:1.05cqw 2.4cqw 1.05cqw 3cqw;border-radius:5cqw;background:${ctaBg};color:${ctaInk};font:600 2.9cqw/1.15 Poppins,system-ui;letter-spacing:.02em;overflow:hidden;transform:scale(.4);opacity:0;transform-origin:left center;box-shadow:0 .5cqw 1.6cqw rgba(0,0,0,.2),inset 0 0 0 .12cqw rgba(255,255,255,.18)}
.ar{width:1.05em;height:1.05em;flex:none;transition:none}
:host([data-go]) .ar{animation:nudge 2.6s 2.4s ease-in-out infinite}
@keyframes nudge{0%,70%,100%{transform:none}80%{transform:translateX(.5cqw)}90%{transform:none}}
.cta:after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:40%;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0));transform:skewX(-20deg)}
.p{position:absolute;right:2.4cqw;bottom:1.4cqw;opacity:0;transform:translateX(60cqw) rotate(12deg)}
.p img{display:block;width:auto;height:100%;max-width:100%;object-fit:contain;object-position:right bottom}
.p.cut{height:calc(max(46cqh,26cqw) * 1.2);max-height:60cqh;width:40cqw;display:flex;justify-content:flex-end;align-items:flex-end;filter:drop-shadow(0 1.2cqw 1.6cqw rgba(0,0,0,.35))}
.p.cut img{height:auto;max-height:100%;position:relative;z-index:1}
.p.cut:after{content:"";position:absolute;right:6%;width:70%;bottom:-.8cqw;height:2.6cqw;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.38),transparent)}
/* a product photo that could not be cut out: it melts into a soft brand-tinted glow — no card, no rectangle */
.p.photo{height:calc(var(--sh) - 4cqw);max-height:48cqh;aspect-ratio:1/1;bottom:2cqw;right:4cqw;display:grid;place-items:center;isolation:isolate}
.p.photo:before{content:"";position:absolute;inset:-14%;border-radius:50%;background:radial-gradient(closest-side,${halo} 0%,${halo}f2 34%,${halo}80 58%,${halo}00 100%);filter:blur(.4cqw)}
.p.photo img{position:relative;width:100%;height:100%;max-width:none;object-fit:contain;object-position:center;mix-blend-mode:multiply;-webkit-mask-image:radial-gradient(closest-side,#000 58%,transparent 92%);mask-image:radial-gradient(closest-side,#000 58%,transparent 92%)}
.sc{position:absolute;right:0;top:0;bottom:0;width:50%;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 34%);mask-image:linear-gradient(90deg,transparent 0,#000 34%);opacity:0;transform:scale(1.12)}
.sc img{width:100%;height:100%;object-fit:cover;display:block}
:host([data-go]) .sc{animation:scene 1.1s .3s cubic-bezier(.2,.8,.3,1) forwards,drift 9s 1.4s ease-in-out infinite alternate}
@keyframes scene{to{opacity:1;transform:scale(1.02)}}
@keyframes drift{to{transform:scale(1.08) translateX(-1.5%)}}
.x{position:absolute;right:1.4cqw;top:1.4cqw;width:3.6cqw;height:3.6cqw;border-radius:50%;background:rgba(0,0,0,.32);-webkit-backdrop-filter:blur(.6cqw);backdrop-filter:blur(.6cqw);color:#fff;font:500 2.8cqw/3.5cqw system-ui;text-align:center;z-index:5;opacity:0}
.ad{position:absolute;right:5.8cqw;top:1.75cqw;font:600 1.8cqw/1 system-ui;letter-spacing:.08em;color:#fff;background:rgba(0,0,0,.32);-webkit-backdrop-filter:blur(.6cqw);backdrop-filter:blur(.6cqw);padding:.55cqw .95cqw;border-radius:.8cqw;z-index:5;opacity:0}
:host([data-go]) .s{animation:up .55s cubic-bezier(.2,.9,.25,1) forwards}
:host([data-go]) .ring{animation:ring .8s .25s cubic-bezier(.2,.9,.3,1) forwards}
:host([data-go]) .sh{animation:sweep 1s 1s ease-in-out forwards}
:host([data-go]) .lg{animation:lgIn .6s .5s cubic-bezier(.2,.9,.3,1) forwards}
@keyframes lgIn{to{transform:none;opacity:1}}
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
${d.css}
</style>
<div class="w st-${style}" data-lg="${d.lg}" data-tx="${d.tx}" data-fs="${d.fs}" data-fs2="${d.fs2}"><div class="s">${d.deco}${scene ? `<div class="sc"><img src="${esc(o.productUrl)}" alt=""></div>` : back}<div class="sh"></div>${logo}
<div class="tx${o.subline ? "" : " one"}"><div class="hd">${words(o.headline, "w1", d.words.d, d.words.step)}</div>${o.subline ? `<div class="sb">${words(o.subline, "w2", 4.15, d.words.step)}</div>` : ""}</div>
<div class="cta">${esc(o.cta)}${ARROW}</div></div>
${d.after || ""}${scene ? "" : `<div class="p ${cut ? "cut" : "photo"}"><img src="${esc(o.productUrl)}" alt=""></div>`}
<span class="ad">Ad</span><span class="x">&times;</span></div>`;
}

// Runs inside the page after the strip is placed: shrinks the headline / second line until each fits in two lines
// and above the button, so long copy never spills. Starting sizes come from the design (data-* on .w).
/* global getComputedStyle */
export function fitStrip(host) {
  // layout sizes (offsetTop / offsetHeight), not on-screen boxes: the entry animations scale and move these elements
  const root = host.shadowRoot, q = (s) => /** @type {HTMLElement|null} */ (root.querySelector(s));
  const w = q(".w"), tx = q(".tx"), cta = q(".cta"), li = /** @type {HTMLImageElement|null} */ (root.querySelector(".lg img"));
  const lg0 = +w.dataset.lg || 5.2, tx0 = +w.dataset.tx || 8.7, fs0 = +w.dataset.fs || 4.8, fs20 = +w.dataset.fs2 || 4.2;
  // a round / square logo gets a taller pill when the copy still fits under it; otherwise the design's own pill
  const layouts = li && li.naturalWidth / li.naturalHeight < 2.4 ? [[lg0 * 1.42, tx0 + 2.2], [lg0 * 1.2, tx0 + 1], [lg0, tx0]] : [[lg0, tx0]];
  const fits = (el) => el.offsetHeight <= (parseFloat(getComputedStyle(el).lineHeight) || 10) * 2.05 && el.offsetHeight <= cta.offsetTop - tx.offsetTop - el.offsetTop - 3;
  for (const [i, [logoH, top]] of layouts.entries()) {
    q(".lg").style.height = logoH.toFixed(2) + "cqw"; tx.style.top = top.toFixed(2) + "cqw";
    let ok = true;
    for (const [sel, v, start] of /** @type {[string, string, number][]} */ ([[".hd", "--fs", fs0], [".sb", "--fs2", fs20]])) {
      const el = q(sel); if (!el) continue;
      let k = 0; for (; start - k * 0.2 >= 2.99; k++) { tx.style.setProperty(v, (start - k * 0.2).toFixed(1) + "cqw"); if (fits(el)) break; }
      if (!fits(el)) ok = false;
    }
    if (ok || i === layouts.length - 1) break;
  }
}
