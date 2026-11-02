// The premium in-image story (the quality of VOX's "Full + WOW" units, e.g. Dabur Odomos): about 11 seconds in four acts
//   1. hook     — themed elements (bubbles, leaves, sparkles, insects, planes …) burst out of the picture and over the page
//   2. takeover — the article picture goes behind frosted glass and a big brand medallion spins in with the product
//   3. message  — the medallion flips over to the headline (the brand's approved claim when one is given)
//   4. banner   — the medallion leaves, the picture clears and the brand strip (strip.mjs, any of its designs) stays
// The strip is the existing design; its animations are moved from data-go to data-go2, which the host sets after
// STORY_MS (the renderer reads it from data-go2 on the story). Act 1 lives in a second layer over the page
// (after the <!--mk-page--> marker): the image box itself clips, the hook must fly over the headline and text.
import { stripHtml, luminance, logoMode } from "./strip.mjs";

export const STORY_VERSION = "story.v1";
export const STORY_MS = 6400;   // when act 4 (the strip) starts
export const MOTIFS = ["bubbles", "sparkle", "leaves", "confetti", "flight", "coins", "flakes", "insects", "petals", "hearts", "speed", "pin", "bokeh"];
// the older motif names of strip.mjs → the hook that suits them
const ALIAS = { steam: "leaves", none: "bokeh" };
export const hookFor = (motif) => MOTIFS.includes(motif) ? motif : ALIAS[motif] || "bokeh";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim()); return m ? "#" + m[1].toLowerCase() : null; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (h, to, k) => toHex(rgb(h).map((v, i) => v + (rgb(to)[i] - v) * k));
// the same brand always gets the same scatter (a recording can be made again and look the same)
const seeded = (s) => { let x = [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 2166136261) || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); };

// Hook sprites (viewBox 0 0 40 40). Colours read on a white page and on a photo alike (a soft shadow on each).
function sprites(c, accent) {
  const deep = mix(c, "#000000", 0.35), tint = mix(c, "#ffffff", 0.55), a = accent || mix(c, "#ffffff", 0.35);
  return {
    bubbles: `<radialGradient id="kb" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".05"/><stop offset=".72" stop-color="#ffffff" stop-opacity=".18"/><stop offset=".93" stop-color="${tint}" stop-opacity=".75"/><stop offset="1" stop-color="${deep}" stop-opacity=".85"/></radialGradient><g id="k"><circle cx="20" cy="20" r="17" fill="url(#kb)"/><path d="M9 15 A12 12 0 0 1 17 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none" opacity=".95"/><circle cx="27" cy="29" r="1.8" fill="#fff" opacity=".7"/></g>`,
    sparkle: `<linearGradient id="kg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6cf"/><stop offset=".5" stop-color="#f1c94e"/><stop offset="1" stop-color="#c8962a"/></linearGradient><g id="k"><path d="M20 2 C21.6 14 26 18.4 38 20 C26 21.6 21.6 26 20 38 C18.4 26 14 21.6 2 20 C14 18.4 18.4 14 20 2Z" fill="url(#kg)"/><circle cx="20" cy="20" r="3" fill="#fff"/></g>`,
    leaves: `<linearGradient id="kl" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2f7d32"/><stop offset="1" stop-color="#8bc34a"/></linearGradient><g id="k"><path d="M6 34 C6 16 18 5 36 4 C35 22 24 34 6 34Z" fill="url(#kl)"/><path d="M8 32 C16 24 24 16 32 8" stroke="#e8f5d0" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".85"/></g>`,
    confetti: `<g id="k"><rect x="13" y="6" width="9" height="22" rx="2" fill="${c}"/><rect x="24" y="16" width="7" height="16" rx="2" fill="${a}" transform="rotate(25 27 24)"/><circle cx="9" cy="30" r="4" fill="#f4c542"/></g>`,
    flight: `<g id="k"><path d="M3 21.5 L15 19 L25 6 L29 6 L23 19 L33 18 L36 13 L39 13 L37 20 L39 27 L36 27 L33 22 L23 21 L29 34 L25 34 L15 22 Z" fill="${deep}"/></g>`,
    coins: `<linearGradient id="kc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset=".55" stop-color="#e9b43a"/><stop offset="1" stop-color="#b9831d"/></linearGradient><g id="k"><circle cx="20" cy="20" r="17" fill="url(#kc)"/><circle cx="20" cy="20" r="13" fill="none" stroke="#fff3c4" stroke-width="1.4" opacity=".8"/><text x="20" y="26.5" text-anchor="middle" font-size="17" font-weight="700" font-family="Poppins,system-ui" fill="#8a5e10">₹</text></g>`,
    flakes: `<g id="k" stroke="#5fb7e8" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M20 3v34M5.3 11.5l29.4 17M5.3 28.5l29.4-17"/><path d="M15 6l5 4 5-4M15 34l5-4 5 4" stroke-width="1.8"/></g>`,
    insects: `<g id="k"><ellipse cx="13" cy="13" rx="9" ry="4.2" fill="#cfd8dc" opacity=".8" transform="rotate(-25 13 13)"/><ellipse cx="25" cy="11" rx="9" ry="4" fill="#cfd8dc" opacity=".8" transform="rotate(20 25 11)"/><path d="M8 24 C14 21 26 21 33 24" stroke="#37474f" stroke-width="3" stroke-linecap="round" fill="none"/><circle cx="35" cy="23.5" r="2.6" fill="#263238"/><path d="M37 23 l3 -1.5" stroke="#263238" stroke-width="1.2"/><path d="M14 24 l-4 9 M19 24 l-1 11 M24 24 l3 10 M29 24 l6 8" stroke="#455a64" stroke-width="1.1" fill="none"/></g>`,
    petals: `<linearGradient id="kp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe0ea"/><stop offset="1" stop-color="#f48fb1"/></linearGradient><g id="k"><path d="M20 4 C30 10 32 26 20 36 C8 26 10 10 20 4Z" fill="url(#kp)"/><path d="M20 9 V31" stroke="#fff" stroke-width="1" opacity=".6"/></g>`,
    hearts: `<g id="k"><path d="M20 35 C8 26 3 19 3 12.5 C3 7.5 7 4 11.5 4 C15 4 18 6 20 9 C22 6 25 4 28.5 4 C33 4 37 7.5 37 12.5 C37 19 32 26 20 35Z" fill="${luminance(c) > 0.7 ? "#e53950" : c}"/><ellipse cx="12" cy="11" rx="3.5" ry="2.2" fill="#fff" opacity=".55" transform="rotate(-30 12 11)"/></g>`,
    speed: `<g id="k"><rect x="0" y="17" width="40" height="5" rx="2.5" fill="${c}"/></g>`,
    pin: `<g id="k"><path d="M20 38 C20 38 7 23 7 14.5 C7 7.3 12.8 2 20 2 C27.2 2 33 7.3 33 14.5 C33 23 20 38 20 38Z" fill="${c}"/><circle cx="20" cy="14.5" r="5" fill="#fff"/></g>`,
    bokeh: `<radialGradient id="ko"><stop offset="0" stop-color="${tint}" stop-opacity=".95"/><stop offset=".7" stop-color="${c}" stop-opacity=".55"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient><g id="k"><circle cx="20" cy="20" r="19" fill="url(#ko)"/></g>`,
  };
}

// Where each hook travels (in % of the picture's width / height; the layer sits on the picture, the page around it is
// outside 0–100): four points per sprite, a size (cqw), a spin and timing.
function paths(hook, rnd) {
  const r = (a, b) => a + (b - a) * rnd();
  const count = { speed: 9, flight: 4, insects: 11, bokeh: 10, coins: 10, confetti: 16, bubbles: 17 }[hook] || 13;
  return Array.from({ length: count }, (_, i) => {
    const lane = (i + rnd()) / count;   // spread evenly across the width
    let p, size = r(5, 8.5), spin = r(-200, 200), dur = r(2, 2.8), delay = r(0, 0.9);
    if (hook === "bubbles") { const x = lane * 100; p = [[x, r(70, 110)], [x + r(-6, 6), r(20, 50)], [x + r(-8, 8), r(-30, 0)], [x + r(-10, 10), r(-90, -55)]]; size = r(4.5, 11); spin = 0; }
    else if (hook === "flight") { const y = r(-70, 60), dir = i % 2 ? 1 : -1; p = [[dir > 0 ? -25 : 125, y], [dir > 0 ? 25 : 75, y - r(4, 12)], [dir > 0 ? 70 : 30, y - r(10, 20)], [dir > 0 ? 125 : -25, y - r(16, 30)]]; size = r(8, 11); spin = 0; dur = r(2.2, 2.9); delay = i * 0.35; return { p, size, spin, dur, delay, flip: dir < 0, tilt: -8 }; }
    else if (hook === "insects") { const x = lane * 110 - 5, y = r(-70, 95); p = [[x, y], [x + r(-18, 18), y + r(-14, 14)], [x + r(-22, 22), y + r(-18, 18)], [x + (x > 50 ? 1 : -1) * r(40, 70), y + r(-40, -10)]]; size = r(6, 8.5); spin = 0; dur = r(2.3, 3); return { p, size, spin, dur, delay, flip: p[3][0] < x, tilt: r(-12, 12), buzz: true }; }
    else if (hook === "speed") { const y = r(-10, 100); p = [[115, y], [80, y], [30, y], [-30, y]]; size = r(14, 28); spin = 0; dur = r(0.8, 1.2); delay = r(0, 1.2); }
    else if (["sparkle", "hearts", "bokeh", "pin"].includes(hook)) { const x = lane * 104 - 2, y = r(-60, 105); p = [[x, y], [x + r(-3, 3), y - r(2, 6)], [x + r(-4, 4), y - r(4, 10)], [x + r(-5, 5), y - r(8, 16)]]; size = hook === "bokeh" ? r(6, 14) : r(4.5, 8); spin = hook === "sparkle" ? r(-90, 90) : 0; dur = r(1.6, 2.4); delay = r(0, 1.1); return { p, size, spin, dur, delay, pop: true }; }
    else { const x = lane * 100, y = r(-95, -55); p = [[x, y], [x + r(-12, 12), y + r(45, 60)], [x + r(-16, 16), y + r(95, 120)], [x + r(-20, 20), y + r(150, 185)]]; size = hook === "confetti" ? r(3.5, 5.5) : r(5, 8); }   // falling: leaves, confetti, coins, flakes, petals
    return { p, size, spin, dur, delay };
  });
}

/**
 * The full story: the strip of strip.mjs (any design) plus acts 1–3. Same options as stripHtml, plus claim (the brand's
 * approved line for the medallion's back; the headline when none) and hook (one of MOTIFS; the strip motif otherwise).
 * @param {Parameters<typeof stripHtml>[0] & { claim?: string|null, hook?: string|null, seed?: string }} o
 */
export function storyHtml(o) {
  const c = hex(o.colour) || "#1d2b53", light = luminance(c) > 0.62, accent = hex(o.accent);
  const deep = mix(c, "#000000", light ? 0.22 : 0.42), hi = mix(c, "#ffffff", 0.3);
  const hook = hookFor(o.hook || o.motif), rnd = seeded((o.seed || o.brand) + hook);
  // the strip, its animations moved to the second trigger (act 4)
  const strip = stripHtml(o).split(":host([data-go])").join(":host([data-go2])");
  const cut = o.productMode === "alpha" || o.productMode === "plain-bg", bare = o.productMode === "none" || !o.productUrl;
  // the medallion's back: the claim (or the headline) in large type; size from the longest word and the length
  const line = String(o.claim || o.headline || o.brand).trim();
  const longest = Math.max(...line.split(/\s+/).map((w) => w.length), 1);
  const fs = Math.max(3.8, Math.min(8.4, 60 / Math.max(longest + 1, Math.sqrt(line.length) * 3.1)));
  const backInk = luminance(deep) > 0.55 ? "#141414" : "#ffffff";
  const lmode = o.logoUrl ? logoMode({ kind: o.logoKind || "mark", ink: o.logoInk, behind: deep }) : "text";
  const logo = o.logoUrl ? `<div class="bl ${lmode}"><img src="${esc(o.logoUrl)}" alt=""></div>` : `<div class="bl blt">${esc(o.brand)}</div>`;
  const front = bare
    ? (o.logoUrl ? `<div class="fl ${lmode}"><img src="${esc(o.logoUrl)}" alt=""></div>` : `<div class="fl blt">${esc(o.brand)}</div>`)
    : cut ? `<div class="pi"><img src="${esc(o.productUrl)}" alt=""></div>` : `<div class="pc"><img src="${esc(o.productUrl)}" alt=""></div>`;
  const words = line.split(/\s+/).map((w, i) => `<span class="cw" style="animation-delay:${(4.4 + i * 0.09).toFixed(2)}s">${esc(w)}</span>`).join(" ");
  const sp = sprites(c, accent), flyers = paths(hook, rnd).map((s) => {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = s.p;
    const v = `left:${x0.toFixed(1)}%;top:${y0.toFixed(1)}%;width:${s.size.toFixed(1)}cqw;--x1:${(x1 - x0).toFixed(1)};--y1:${(y1 - y0).toFixed(1)};--x2:${(x2 - x0).toFixed(1)};--y2:${(y2 - y0).toFixed(1)};--x3:${(x3 - x0).toFixed(1)};--y3:${(y3 - y0).toFixed(1)};--r:${s.spin.toFixed(0)}deg;--t:${(s.tilt || 0).toFixed(0)}deg;--fx:${s.flip ? -1 : 1};animation-duration:${s.dur.toFixed(2)}s;animation-delay:${s.delay.toFixed(2)}s`;
    return `<svg class="f${s.pop ? " pop" : ""}${s.buzz ? " buzz" : ""}" style="${v}" viewBox="0 0 40 40"><use href="#k"/></svg>`;
  }).join("");
  const story = `<style>
.sw{position:absolute;inset:0;container-type:size;overflow:hidden;font-family:Poppins,system-ui,sans-serif;-webkit-font-smoothing:antialiased;pointer-events:none}
.w>.ad,.w>.x{display:none}
.fr{position:absolute;inset:0;opacity:0;-webkit-backdrop-filter:blur(1.5cqw) saturate(1.15);backdrop-filter:blur(1.5cqw) saturate(1.15);background:radial-gradient(ellipse at 50% 55%,rgba(255,255,255,.18),rgba(255,255,255,.42) 75%),linear-gradient(180deg,${c}14,${c}30)}
.md{position:absolute;left:50%;top:50%;width:var(--d);height:var(--d);margin:calc(var(--d) / -2) 0 0 calc(var(--d) / -2);--d:min(70cqh,48cqw);perspective:120cqw;opacity:0;transform:scale(.2) rotate(-40deg)}
.in{position:absolute;inset:0;transform-style:preserve-3d}
.fa,.ba{position:absolute;inset:0;border-radius:50%;-webkit-backface-visibility:hidden;backface-visibility:hidden}
.fa{background:radial-gradient(circle at 34% 28%,${hi} 0%,${c} 46%,${deep} 100%);box-shadow:0 0 0 .7cqw rgba(255,255,255,.92),0 1.6cqw 4cqw rgba(0,0,0,.35),inset 0 -1.2cqw 3cqw rgba(0,0,0,.25)}
.ba{transform:rotateY(180deg);background:radial-gradient(circle at 34% 28%,${mix(deep, "#ffffff", 0.18)} 0%,${deep} 62%,${mix(deep, "#000000", 0.3)} 100%);box-shadow:0 0 0 .7cqw rgba(255,255,255,.92),0 1.6cqw 4cqw rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.4cqw;text-align:center;color:${backInk};padding:0 12%;box-sizing:border-box}
.rg{position:absolute;inset:-6%;border-radius:50%;border:.5cqw solid ${hi};opacity:0}
.gl{position:absolute;inset:0;border-radius:50%;overflow:hidden}
.gl:after{content:"";position:absolute;top:-20%;bottom:-20%;left:-60%;width:35%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.5),transparent);transform:skewX(-18deg)}
.pi{position:absolute;left:50%;bottom:9%;width:132%;height:110%;margin-left:-66%;transform:translateY(40%) rotate(-24deg) scale(.6);opacity:0;filter:drop-shadow(0 1.4cqw 1.6cqw rgba(0,0,0,.4))}
.pi img{width:100%;height:100%;object-fit:contain;object-position:center bottom;display:block}
.pc{position:absolute;inset:7%;border-radius:50%;overflow:hidden;opacity:0;transform:scale(.7)}
.pc img{width:100%;height:100%;object-fit:cover;display:block}
.fl{position:absolute;inset:22%;display:grid;place-items:center;opacity:0}
.fl img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 .3cqw .8cqw rgba(0,0,0,.3))}
.fl.chip img{background:#fff;padding:2cqw;border-radius:2cqw}.fl.chipd img{background:#14171f;padding:2cqw;border-radius:2cqw}
.bl{height:calc(var(--d) * .13);display:flex;align-items:center;opacity:0}
.bl img{height:100%;width:auto;max-width:calc(var(--d) * .5);object-fit:contain}
.bl.chip{background:#fff;padding:.5cqw 1.2cqw;border-radius:1.2cqw}.bl.chipd{background:#14171f;padding:.5cqw 1.2cqw;border-radius:1.2cqw}
.blt{font:700 calc(var(--d) * .08)/1 Poppins,system-ui;letter-spacing:.04em;color:${backInk};text-transform:uppercase}
.cl{font:700 ${fs.toFixed(2)}cqw/1.06 Poppins,system-ui;letter-spacing:-.01em;text-wrap:balance;text-shadow:0 .3cqw 1.2cqw rgba(0,0,0,.25)}
.cw{display:inline-block;opacity:0;transform:translateY(40%) scale(.85)}
.sad{position:absolute;right:5.8cqw;top:1.75cqw;font:600 1.8cqw/1 system-ui;letter-spacing:.08em;color:#fff;background:rgba(0,0,0,.32);-webkit-backdrop-filter:blur(.6cqw);backdrop-filter:blur(.6cqw);padding:.55cqw .95cqw;border-radius:.8cqw;opacity:0}
.sx{position:absolute;right:1.4cqw;top:1.4cqw;width:3.6cqw;height:3.6cqw;border-radius:50%;background:rgba(0,0,0,.32);-webkit-backdrop-filter:blur(.6cqw);backdrop-filter:blur(.6cqw);color:#fff;font:500 2.8cqw/3.5cqw system-ui;text-align:center;opacity:0}
:host([data-go]) .sad,:host([data-go]) .sx{animation:sFade .3s .3s forwards}
:host([data-go]) .fr{animation:sFade .6s .9s ease-out forwards,sFadeOut .5s 5.9s ease-in forwards}
:host([data-go]) .md{animation:sPop .9s 1.3s cubic-bezier(.2,1.35,.35,1) forwards,sLeave .5s 5.8s cubic-bezier(.5,0,.75,0) forwards}
:host([data-go]) .rg{animation:sRing 1.3s 1.75s ease-out forwards}
:host([data-go]) .pi{animation:sRise .85s 1.6s cubic-bezier(.2,1.3,.35,1) forwards,sBob 2.6s 2.45s ease-in-out infinite}
:host([data-go]) .pc,:host([data-go]) .fl{animation:sZoom .7s 1.6s cubic-bezier(.2,1.2,.35,1) forwards}
:host([data-go]) .gl:after{animation:sSweep 1s 2.7s ease-in-out forwards}
:host([data-go]) .in{animation:sFlip .75s 3.95s cubic-bezier(.45,0,.2,1) forwards}
:host([data-go]) .bl{animation:sFade .4s 4.3s forwards}
:host([data-go]) .cw{animation:sWord .45s cubic-bezier(.2,1.4,.4,1) forwards}
@keyframes sFade{to{opacity:1}}
@keyframes sFadeOut{from{opacity:1}to{opacity:0}}
@keyframes sPop{to{opacity:1;transform:none}}
@keyframes sLeave{from{opacity:1;transform:none}to{opacity:0;transform:translate(26cqw,26cqh) scale(.25)}}
@keyframes sRing{0%{opacity:.9;transform:scale(.9)}100%{opacity:0;transform:scale(1.35)}}
@keyframes sRise{to{opacity:1;transform:rotate(-9deg)}}
@keyframes sBob{0%,100%{translate:0 0}50%{translate:0 -1.4cqh}}
@keyframes sZoom{to{opacity:1;transform:none}}
@keyframes sSweep{from{left:-60%}to{left:140%}}
@keyframes sFlip{to{transform:rotateY(180deg)}}
@keyframes sWord{to{opacity:1;transform:none}}
</style>
<div class="sw" data-go2="${STORY_MS}"><div class="fr"></div>
<div class="md"><div class="rg"></div><div class="in"><div class="fa"><div class="gl"></div>${front}</div><div class="ba">${logo}<div class="cl">${words}</div></div></div></div>
<span class="sad">Ad</span><span class="sx">&times;</span></div>`;
  // act 1: over the page (placed by the host on the picture's box, overflowing it)
  const page = `<style>
:host{display:block}
.pg{position:absolute;inset:0;container-type:size;overflow:visible;pointer-events:none}
.f{position:absolute;height:auto;overflow:visible;opacity:0;filter:drop-shadow(0 .3cqw .5cqw rgba(0,0,0,.25));animation-timing-function:linear;animation-fill-mode:forwards}
:host([data-go]) .f{animation-name:hPath}
:host([data-go]) .f.pop{animation-name:hPop}
:host([data-go]) .f.buzz use{animation:hBuzz .14s linear infinite}
@keyframes hPath{0%{opacity:0;transform:translate(0,0) scaleX(var(--fx)) rotate(var(--t)) scale(.5)}12%{opacity:1}33%{transform:translate(calc(var(--x1) * 1cqw),calc(var(--y1) * 1cqh)) scaleX(var(--fx)) rotate(calc(var(--t) + var(--r) * .33)) scale(.9)}66%{opacity:1;transform:translate(calc(var(--x2) * 1cqw),calc(var(--y2) * 1cqh)) scaleX(var(--fx)) rotate(calc(var(--t) + var(--r) * .66)) scale(1)}100%{opacity:0;transform:translate(calc(var(--x3) * 1cqw),calc(var(--y3) * 1cqh)) scaleX(var(--fx)) rotate(calc(var(--t) + var(--r))) scale(1)}}
@keyframes hPop{0%{opacity:0;transform:scale(0) rotate(0)}25%{opacity:1;transform:translate(calc(var(--x1) * 1cqw),calc(var(--y1) * 1cqh)) scale(1.15) rotate(calc(var(--r) * .4))}70%{opacity:1;transform:translate(calc(var(--x2) * 1cqw),calc(var(--y2) * 1cqh)) scale(.95) rotate(calc(var(--r) * .8))}100%{opacity:0;transform:translate(calc(var(--x3) * 1cqw),calc(var(--y3) * 1cqh)) scale(.4) rotate(var(--r))}}
@keyframes hBuzz{50%{transform:translate(.6px,1.4px)}}
</style><svg width="0" height="0" style="position:absolute"><defs>${sp[hook]}</defs></svg><div class="pg">${flyers}</div>`;
  return `${strip}\n${story}\n<!--mk-page-->\n${page}`;
}

/** Splits a story into the creative over the picture and the hook layer over the page (null for a plain strip). */
export const splitStory = (html) => { const i = String(html).indexOf("<!--mk-page-->"); return i < 0 ? [html, null] : [html.slice(0, i), html.slice(i + 14)]; };

