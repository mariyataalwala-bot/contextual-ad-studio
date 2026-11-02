// The creative director: every ad gets its own idea instead of one template. An AI brief (directorPrompt /
// DIRECTOR_SCHEMA) picks a storytelling device for this brand, product and article picture, the art direction, how
// the product is beautified, and the line for each beat; sceneHtml() stages it. Devices (all ~6 s, then the brand strip
// of strip.mjs stays, started on data-go2 like the story of story.mjs):
//   frost     — cold: frost creeps over the photo, the ice-cold product rises with condensation, a line etched in the glass
//   pour      — flow: a stream pours in and the photo fills with the product's liquid, the pack rises out with a splash
//   spotlight — luxury: the photo dims to velvet, a spotlight sweeps in, the piece appears with glints and a mirror floor
//   portal    — escape: an arch opens in the photo onto the brand's sky, the product arrives, a boarding pass slides up
//   shatter   — energy: impact, the photo cracks and breaks apart, the product bursts through, big type slams in
//   medallion — problem / solution: the story of story.mjs (hook over the page, frosted takeover, medallion, message)
// Product beautification (any device): a light sweep across the product only (masked by its own cut-out), condensation
// drops (masked too), a rim light, a mirror reflection, glints and a soft contact shadow.
// Every class and keyframe here starts with "d" (dz, dHero …): the strip's CSS shares the same shadow root.
import { stripHtml, luminance, logoMode, STRIP_VERSION } from "./strip.mjs";
import { storyHtml, STORY_MS, STORY_VERSION } from "./story.mjs";

export const DIRECTOR_VERSION = "director.v3";   // v2 (2026-10-30): no invented slogans; copy never ties to health, diet, fasting, religion, money or news; v3: richer pour (ingredients, splash crown, caustics) and spotlight (velvet, flares, gold foil, frame)
export const DEVICES = ["frost", "pour", "spotlight", "portal", "shatter", "medallion"];
export const FX = ["shine", "droplets", "rim", "reflection", "glints", "float"];
// what floats in a pour and flies out with its splash (viewBox 0 0 40 40, one <g id="dIng">)
const INGREDIENTS = {
  beans: `<g id="dIng"><ellipse cx="20" cy="20" rx="11" ry="15" fill="#4a2a17" transform="rotate(-25 20 20)"/><ellipse cx="16" cy="14" rx="3.2" ry="5.5" fill="#7a4a2c" opacity=".7" transform="rotate(-25 16 14)"/><path d="M15 8 C23 15 17 25 25 32" stroke="#22120a" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>`,
  citrus: `<g id="dIng"><circle cx="20" cy="20" r="17" fill="#f39a12"/><circle cx="20" cy="20" r="14.5" fill="#fff4d6"/><circle cx="20" cy="20" r="13" fill="#ffb93a"/>${Array.from({ length: 8 }, (_, i) => `<path d="M20 20 L${(20 + 13 * Math.cos(i * Math.PI / 4)).toFixed(1)} ${(20 + 13 * Math.sin(i * Math.PI / 4)).toFixed(1)}" stroke="#fff4d6" stroke-width="1.3"/>`).join("")}<circle cx="20" cy="20" r="2" fill="#fff4d6"/></g>`,
  ice: `<g id="dIng"><rect x="7" y="7" width="26" height="26" rx="5" fill="rgba(222,242,255,.72)" stroke="#fff" stroke-width="1.4" transform="rotate(14 20 20)"/><path d="M12 14 L20 11" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".9"/><rect x="15" y="17" width="9" height="9" rx="2" fill="rgba(255,255,255,.35)" transform="rotate(14 20 20)"/></g>`,
  mango: `<g id="dIng"><path d="M8 15 L20 8 L32 15 L32 29 L20 36 L8 29 Z" fill="#f7a800"/><path d="M8 15 L20 8 L32 15 L20 22 Z" fill="#ffd25a"/><path d="M20 22 L32 15 L32 29 L20 36 Z" fill="#e08a00"/></g>`,
  berries: `<g id="dIng"><circle cx="15" cy="23" r="8" fill="#9b1238"/><circle cx="25" cy="25" r="7.5" fill="#6d0f4a"/><circle cx="20" cy="15" r="7" fill="#c21d45"/><circle cx="17.5" cy="12.5" r="2" fill="#fff" opacity=".6"/><circle cx="12.5" cy="20.5" r="1.8" fill="#fff" opacity=".5"/><path d="M20 8 C22 4 26 3 29 4 C27 7 24 8 20 8Z" fill="#3c9a3f"/></g>`,
  leaves: `<g id="dIng"><path d="M6 34 C6 16 18 5 36 4 C35 22 24 34 6 34Z" fill="#37a554"/><path d="M8 32 C16 24 24 16 32 8" stroke="#d9f5d0" stroke-width="1.3" fill="none" stroke-linecap="round"/></g>`,
  chocolate: `<g id="dIng"><rect x="6" y="9" width="28" height="22" rx="2.5" fill="#4b2615"/><rect x="9" y="12" width="10" height="7" rx="1" fill="#6a3a22"/><rect x="21" y="12" width="10" height="7" rx="1" fill="#6a3a22"/><rect x="9" y="21" width="10" height="7" rx="1" fill="#6a3a22"/><rect x="21" y="21" width="10" height="7" rx="1" fill="#6a3a22"/></g>`,
};
export const INGREDIENT_NAMES = ["none", ...Object.keys(INGREDIENTS)];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim()); return m ? "#" + m[1].toLowerCase() : null; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (h, to, k) => toHex(rgb(h).map((v, i) => v + (rgb(to)[i] - v) * k));
const inkOn = (bg) => luminance(bg) > 0.58 ? "#161616" : "#ffffff";
const seeded = (s) => { let x = [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 2166136261) || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); };
const n = (k, f) => Array.from({ length: k }, (_, i) => f(i)).join("");
const words = (t, cls, d0, step = 0.09) => esc(t).split(/\s+/).filter(Boolean).map((w, i) => `<span class="${cls}" style="animation-delay:${(d0 + i * step).toFixed(2)}s">${w}</span>`).join(" ");

// ---------- the brief ----------
export const DIRECTOR_SCHEMA = { type: "object", properties: {
  device: { type: "string", enum: DEVICES },
  big_idea: { type: "string" },
  why: { type: "string" },
  base: { type: "string" }, accent: { type: "string" }, liquid: { type: "string" }, ingredients: { type: "string", enum: INGREDIENT_NAMES },
  sky_top: { type: "string" }, sky_bottom: { type: "string" },
  kicker: { type: "string" }, message: { type: "string" },
  pass_from: { type: "string" }, pass_to: { type: "string" },
  product_fx: { type: "array", items: { type: "string", enum: FX } },
}, required: ["device", "big_idea", "why", "base", "accent", "message", "product_fx"] };

/** The creative director's brief: text of the request (the product photo and the article picture go with it). */
export function directorPrompt({ brand, product, category, headline, articleHeadline, imageAlt, colours, recent = [], recentAds = [] }) {
  return `You are the executive creative director of a premium in-image ad studio (the ad plays over a news article's photo on a phone, about 6 seconds, muted, then a brand strip stays). Brand: ${brand}. Product: ${product}${category ? ` (${category})` : ""}. Brand colours: ${colours.join(", ")}.
Article: "${articleHeadline}"${imageAlt ? `; its photo shows: ${imageAlt}` : ""}. Picture 1 is the product, picture 2 the article photo the ad plays on.${recentAds.length ? `\nThe brand's recent ads: ${recentAds.slice(0, 4).join(" · ")}.` : ""}
Invent ONE idea that makes ${product} look desirable and premium and connects to this article's moment — the way a top agency would, never generic. Pick the storytelling device that best dramatises what the product does or how it feels:
- frost: the photo frosts over, the product rises ice-cold with condensation (cold drinks, ice cream, coolers, ACs, menthol)
- pour: the photo fills with the product's liquid, the pack rises out with a splash (juices, coffee, tea, sauces, oils, paints, shampoo)
- spotlight: velvet darkness, a spotlight finds the piece, glints, mirror floor (jewellery, watches, perfume, premium beauty, luxury)
- portal: an arch opens in the photo onto the brand's sky, the product arrives, a boarding pass slides up (travel, stays, luggage, cars, escapes)
- shatter: the photo cracks and breaks, the product bursts through, big type (sport, shoes, energy drinks, bikes, gaming, launches)
- medallion: a brand medallion with the product over frosted glass, then the message (a product that solves a problem shown in the photo)
${recent.length ? `Recent ads already used: ${recent.join(", ")} — choose a different device unless only one truly fits this product.\n` : ""}Return:
device; big_idea (one sentence, the concept); why (how it ties product, brand and this article); base and accent (#rrggbb art-direction colours true to ${brand}); liquid (#rrggbb, pour only: the real colour of the product's liquid); ingredients (pour only: what really goes into or with this product — beans for coffee, citrus for orange or lemon drinks, ice for cold drinks, mango, berries, leaves for tea or mint, chocolate; none if nothing true fits); sky_top and sky_bottom (#rrggbb, portal only); kicker (2–3 words shown first, optional); message (at most 6 words, the line of the idea — no prices, offers, numbers or claims the brand has not made); pass_from and pass_to (portal only, 1–2 words each, e.g. "Weekday" → "Anywhere"); product_fx (the beautification that suits this product: shine, droplets (cold only), rim (always when the product is dark or the scene is dark, so it never melts into the background), reflection, glints (jewellery, glass, metal), float).
Copy in the brand's voice, English, sentence case. Current headline for reference: "${headline}".
Never invent a slogan or tagline and never present a line as the brand's own. Tie the idea to the article's mood or setting (a breakfast table, a trip, a festive evening), never to health conditions, diets, fasting, religion, money worries or news events — those stay out of the copy even when the article is about them.`;
}

// a sensible device when the AI is not available
export function deviceFor({ style, hook, category = "" }) {
  const c = `${category} ${hook || ""}`.toLowerCase();
  if (/juice|coffee|tea|sauce|oil|paint|shampoo|ketchup/.test(c)) return "pour";
  if (/bubbles|flakes|cold|ice|cool|soft drink|cola/.test(c)) return "frost";
  if (style === "luxe" || /sparkle|jewel|watch|perfume/.test(c)) return "spotlight";
  if (style === "journey" || /flight|travel|stay|luggage/.test(c)) return "portal";
  if (style === "sport" || /speed|sport|shoe|energy/.test(c)) return "shatter";
  return "medallion";
}

// ---------- product beautification ----------
function dewTexture(seed) {
  const r = seeded(seed + "dew");
  const drops = n(46, () => { const x = r() * 200, y = r() * 200, s = 1.2 + r() * r() * 5.5;
    return `<ellipse cx='${x.toFixed(1)}' cy='${y.toFixed(1)}' rx='${(s * 0.8).toFixed(1)}' ry='${s.toFixed(1)}' fill='rgba(255,255,255,.16)' stroke='rgba(0,30,60,.22)' stroke-width='.6'/><circle cx='${(x - s * 0.3).toFixed(1)}' cy='${(y - s * 0.4).toFixed(1)}' r='${(s * 0.32).toFixed(1)}' fill='rgba(255,255,255,.9)'/>`; });
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>${drops}</svg>`)}")`;
}
const HERO_CSS = (rim) => `
.dHero{position:absolute;opacity:0}
.dHero .dHb{position:absolute;inset:0;filter:${rim ? `drop-shadow(0 0 .5cqw ${rim}) drop-shadow(0 0 1.6cqw ${rim}88) ` : ""}drop-shadow(0 1.4cqw 1.6cqw rgba(0,0,0,.35))}
.dHero .dHi{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom;display:block}
.dHero.dRefl .dHi{-webkit-box-reflect:below .2cqw linear-gradient(transparent 62%,rgba(255,255,255,.28))}
.dHero .dSpec,.dHero .dDew{position:absolute;inset:0;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-position:center bottom;mask-position:center bottom;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;pointer-events:none}
.dHero .dSpec{background:linear-gradient(104deg,transparent 40%,rgba(255,255,255,.85) 50%,transparent 60%) no-repeat;background-size:320% 100%;background-position:120% 0}
.dHero .dDew{background-size:16cqw;opacity:0}
.dHero .dCs{position:absolute;left:12%;right:12%;bottom:-2.2cqh;height:5cqh;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.42),transparent)}
.dHero.dPh .dHb{border-radius:3cqw;overflow:hidden;box-shadow:0 1.4cqw 3cqw rgba(0,0,0,.35)}
.dHero.dPh .dHb{background:#fff}
.dHero.dPh .dHi{object-fit:contain;object-position:center}
.dHero.dLo{display:grid;place-items:center}.dHero.dLo img{max-width:80%;max-height:60%;object-fit:contain}
.dGt{position:absolute;width:3.4cqw;height:3.4cqw;opacity:0;background:radial-gradient(circle,#fff 0 16%,transparent 18%),conic-gradient(from 45deg,transparent 0 10%,#fff 12% 13%,transparent 15% 35%,#fff 37% 38%,transparent 40% 60%,#fff 62% 63%,transparent 65% 85%,#fff 87% 88%,transparent 90%);filter:drop-shadow(0 0 .6cqw #fff)}
:host([data-go]) .dHero .dSpec{animation:dSpec 1.2s var(--sd,2.6s) ease-in-out forwards}
:host([data-go]) .dHero .dDew{animation:dIn .8s var(--dd,1.8s) forwards}
:host([data-go]) .dHero{animation-name:var(--enter),dFloat;animation-duration:var(--ed,.9s),3s;animation-delay:var(--ein,1.4s),calc(var(--ein,1.4s) + var(--ed,.9s));animation-timing-function:cubic-bezier(.2,1.2,.35,1),ease-in-out;animation-iteration-count:1,infinite;animation-fill-mode:forwards,none}
:host([data-go]) .dGt{animation:dTw 1.6s ease-in-out infinite}
@keyframes dSpec{from{background-position:120% 0}to{background-position:-20% 0}}
@keyframes dIn{to{opacity:1}}
@keyframes dFloat{0%,100%{translate:0 0}50%{translate:0 -1.6cqh}}
@keyframes dTw{0%,100%{opacity:0;transform:scale(.3) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}`;

// the product, beautified: every product makes its entrance and floats after it, and gets the light sweep (what makes a
// pack look premium); a cut-out also gets the condensation and the mirror when the brief asks for them
function hero(o, fx, seed) {
  const u = esc(o.productUrl), cut = o.productMode === "alpha" || o.productMode === "plain-bg";
  if (!o.productUrl || o.productMode === "none") return `<div class="dHero dLo">${o.logoUrl ? `<img src="${esc(o.logoUrl)}" alt="">` : ""}</div>`;
  const m = `-webkit-mask-image:url('${u}');mask-image:url('${u}')`;
  const cls = ["dHero", cut ? "" : "dPh", fx.includes("reflection") && cut ? "dRefl" : ""].filter(Boolean).join(" ");
  const glints = fx.includes("glints") ? n(4, (i) => `<i class="dGt" style="left:${[22, 70, 46, 82][i]}%;top:${[18, 34, 8, 62][i]}%;animation-delay:${(2.2 + i * 0.4).toFixed(1)}s"></i>`) : "";
  return `<div class="${cls}"><i class="dCs"></i><div class="dHb"><img class="dHi" src="${u}" alt=""><i class="dSpec" style="${cut ? m : ""}"></i>${fx.includes("droplets") && cut ? `<i class="dDew" style="${m};background-image:${dewTexture(seed)}"></i>` : ""}</div>${glints}</div>`;
}

// ---------- the devices: { css, html } staged inside the picture box ----------
function device(name, o, b, t) {
  const { base, deepBase, logo, seed } = t, r = seeded(seed + name);
  const kick = b.kicker ? `<div class="dKk">${words(b.kicker, "dKw", t.kickAt)}</div>` : "";
  const msg = (d0, step) => `<div class="dMs">${words(b.message, "dMw", d0, step)}</div>`;
  if (name === "frost") {
    return { rim: "#bfe8ff", css: `
.dFz{position:absolute;inset:-12%;opacity:0;transform:scale(1.5);-webkit-backdrop-filter:blur(2.6cqw) saturate(.7) brightness(1.12);backdrop-filter:blur(2.6cqw) saturate(.7) brightness(1.12);background:radial-gradient(ellipse at 70% 55%,rgba(228,244,255,.5) 0%,rgba(232,246,255,.74) 50%,rgba(244,251,255,.93) 100%)}
.dFz:after{content:"";position:absolute;inset:0;opacity:.35;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .7 0'/></filter><rect width='100%' height='100%' filter='url(%23f)'/></svg>");background-size:22cqw}
.dCr{position:absolute;inset:0;width:100%;height:100%;opacity:0}
.dCr path{fill:none;stroke:#fff;stroke-width:.35;stroke-linecap:round;opacity:.85}
.dTr{position:absolute;top:-10%;width:.55cqw;height:24cqh;border-radius:1cqw;background:linear-gradient(transparent,rgba(255,255,255,.75),rgba(255,255,255,.2));opacity:0}
.dVp{position:absolute;width:30cqw;height:30cqw;border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.55),transparent);filter:blur(1.4cqw);opacity:0}
.dHero{right:10cqw;bottom:6cqh;width:34cqw;height:84cqh;--enter:dRiseCold;--ein:1.3s;--ed:1s;--sd:2.7s;--dd:1.9s}
.dHero.dPh{width:40cqw;height:70cqh;bottom:15cqh}
.dMsg{position:absolute;left:6cqw;top:50%;width:48cqw;transform:translateY(-50%)}
.dKk{font:600 2.6cqw/1.2 Poppins,system-ui;letter-spacing:.18em;text-transform:uppercase;color:#2b6d97;margin-bottom:1.4cqw}
.dMs{font:700 6.2cqw/1.04 Poppins,system-ui;letter-spacing:-.015em;text-wrap:balance;color:#0e2f4a;text-shadow:0 0 1.4cqw rgba(255,255,255,.9),0 .1cqw 0 rgba(255,255,255,.8)}
.dLg{height:5cqw;margin-bottom:1.6cqw;opacity:0}
:host([data-go]) .dFz{animation:dFzIn 1.3s .1s cubic-bezier(.2,.8,.3,1) forwards,dOut .55s 5.75s cubic-bezier(.5,0,.75,0) forwards}
:host([data-go]) .dCr{animation:dIn 1s .6s forwards}
:host([data-go]) .dTr{animation:dTrickle 2.4s ease-in forwards}
:host([data-go]) .dVp{animation:dVapour 3s ease-out forwards}
:host([data-go]) .dLg{animation:dIn .5s 2.6s forwards}
@keyframes dFzIn{to{opacity:1;transform:none}}
@keyframes dTrickle{0%{opacity:0;transform:translateY(0)}15%{opacity:.9}100%{opacity:0;transform:translateY(110cqh)}}
@keyframes dVapour{0%{opacity:0;transform:translateY(0) scale(.6)}40%{opacity:.7}100%{opacity:0;transform:translateY(-14cqh) scale(1.4)}}
@keyframes dRiseCold{from{opacity:0;transform:translateY(60cqh) rotate(6deg)}to{opacity:1;transform:rotate(-3deg)}}`,
      under: `<div class="dFz"></div>`,
      html: `<svg class="dCr" viewBox="0 0 100 56" preserveAspectRatio="none">${n(14, (i) => { const left = i % 2 === 0, x = left ? r() * 14 : 100 - r() * 14, y = r() * 56; let d = `M${x.toFixed(1)} ${y.toFixed(1)}`; for (let k = 0; k < 4; k++) d += ` l${((left ? 1 : -1) * (2 + r() * 4)).toFixed(1)} ${(r() * 6 - 3).toFixed(1)}`; return `<path d="${d}"/>`; })}</svg>
${n(5, (i) => `<i class="dTr" style="left:${(8 + i * 9 + r() * 4).toFixed(1)}%;animation-delay:${(1 + i * 0.5).toFixed(1)}s"></i>`)}
<div class="dMsg"><div class="dLg">${logo}</div>${kick}${msg(3.0)}</div>
${hero(o, t.fx, seed)}${n(2, (i) => `<i class="dVp" style="right:${12 + i * 10}cqw;bottom:${50 + i * 12}cqh;animation-delay:${(1.8 + i * 0.6).toFixed(1)}s"></i>`)}` };
  }
  if (name === "pour") {
    // pour v3: a stream with highlights and droplets fills the photo with three layers of liquid (glossy crest, moving
    // light caustics, wobbling bubbles); the product rises out with a splash crown, droplets and the product's own
    // ingredients flying in arcs; the line wipes in on the liquid, the kicker sits in a frosted pill
    const liq = hex(b.liquid) || base, hiL = mix(liq, "#ffffff", 0.38), dkL = mix(liq, "#000000", 0.4), lInk = inkOn(liq);
    const ing = null;   // drawn ingredients looked like clip-art: they come back only as photographic elements (brand kit / AI photo)
    const arc = (cls, k, x0, spread, up, delay0) => n(k, (i) => { const dx = (i / (k - 1 || 1) - 0.5) * spread + (r() - 0.5) * 6, h = up * (0.6 + r() * 0.5);
      return `<i class="${cls}" style="left:${(x0 + (r() - 0.5) * 6).toFixed(1)}%;--dx:${dx.toFixed(1)}cqw;--up:${h.toFixed(1)}cqh;--rot:${(r() * 540 - 270).toFixed(0)}deg;animation-delay:${(delay0 + r() * 0.15).toFixed(2)}s"><b${cls === "dIa" ? ` style="--s:${(6.5 + r() * 3).toFixed(1)}cqw"` : ""}>${cls === "dIa" ? `<svg viewBox="0 0 40 40"><use href="#dIng"/></svg>` : ""}</b></i>`; });
    return { css: `
.dLq{position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(180deg,${hiL} 0%,${liq} 18%,${mix(liq, dkL, 0.5)} 70%,${dkL} 100%)}
.dLq:before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 30% 40% at 25% 30%,rgba(255,255,255,.35),transparent 70%),radial-gradient(ellipse 22% 30% at 70% 60%,rgba(255,255,255,.18),transparent 70%);background-size:60cqw 40cqh;mix-blend-mode:screen;opacity:.55}
.dLq:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.25),transparent 18%,transparent 82%,rgba(0,0,0,.25))}
.dWv{position:absolute;left:0;bottom:100%;width:200%;margin-bottom:-.3cqh}
.dWv.dW1{height:9cqh;opacity:.45}.dWv.dW2{height:7cqh;opacity:.7}.dWv.dW3{height:5.5cqh}
.dWv path{fill:${hiL}}.dWv .dCrest{fill:none;stroke:#fff;stroke-width:.35;opacity:.75}
.dSt{position:absolute;left:73%;top:-6%;width:4.6cqw;height:0;border-radius:0 0 3cqw 3cqw;background:linear-gradient(90deg,${dkL},${liq} 35%,${hiL} 55%,${liq} 75%,${dkL});box-shadow:0 0 1.4cqw ${liq}88}
.dSt:after{content:"";position:absolute;left:30%;top:0;bottom:0;width:18%;background:linear-gradient(transparent,rgba(255,255,255,.7) 30%,rgba(255,255,255,.2) 70%,transparent);animation:dFlow .5s linear infinite}
.dDp{position:absolute;left:74%;top:10%;width:1.3cqw;height:1.8cqw;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;background:radial-gradient(circle at 35% 30%,#fff 0 18%,${hiL} 30%,${liq} 70%);opacity:0}
.dBu{position:absolute;bottom:0;opacity:0}
.dBu b{display:block;width:var(--s);height:var(--s);border-radius:50%;border:.22cqw solid rgba(255,255,255,.75);background:radial-gradient(circle at 32% 30%,rgba(255,255,255,.9) 0 12%,rgba(255,255,255,.12) 40%,transparent 70%)}
.dIf{position:absolute;bottom:30cqh;width:6cqw;opacity:0;filter:drop-shadow(0 0 .25cqw rgba(255,255,255,.85)) drop-shadow(0 .4cqw .6cqw rgba(0,0,0,.35))}
.dIf svg{width:100%;height:auto;display:block}
.dCw{position:absolute;left:52%;bottom:44cqh;width:46cqw;height:22cqh;margin-left:-23cqw;opacity:0;transform-origin:50% 100%}
.dCw path{fill:url(#dCwG);stroke:${mix(hiL, "#ffffff", 0.5)};stroke-width:.3;stroke-opacity:.8}
.dCw circle{fill:url(#dCwD)}
.dSd,.dIa{position:absolute;bottom:52cqh;opacity:0}
.dSd b{display:block;width:1.6cqw;height:2.1cqw;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;background:radial-gradient(circle at 35% 30%,#fff 0 16%,${hiL} 32%,${liq} 75%)}
.dIa b{display:block;width:var(--s);filter:drop-shadow(0 0 .3cqw rgba(255,255,255,.85)) drop-shadow(0 .5cqw .8cqw rgba(0,0,0,.35))}.dIa svg{width:100%;height:auto;display:block}
.dHero{left:56%;width:34cqw;height:80cqh;bottom:7cqh;--enter:dRiseLiq;--ein:2s;--ed:1.05s;--sd:3.2s}
.dHero.dPh{width:38cqw;height:62cqh;bottom:18cqh}
.dGl{position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.22) 45%,transparent 60%);transform:translateX(-100%);mix-blend-mode:screen}
.dMsg{position:absolute;left:5cqw;width:46cqw;bottom:7cqh;color:${lInk}}
.dKk{display:inline-block;font:600 2.3cqw/1 Poppins,system-ui;letter-spacing:.14em;text-transform:uppercase;padding:1cqw 1.8cqw;border-radius:5cqw;background:rgba(255,255,255,.18);border:.18cqw solid rgba(255,255,255,.45);-webkit-backdrop-filter:blur(1cqw);backdrop-filter:blur(1cqw);margin-bottom:1.6cqw;opacity:0}
.dMs{font:700 6cqw/1.04 Poppins,system-ui;letter-spacing:-.015em;text-wrap:balance;text-shadow:0 .4cqw 1.6cqw rgba(0,0,0,.3)}
.dMs .dMw{clip-path:inset(0 100% 0 0);transform:none;opacity:1}
.dLg{position:absolute;left:4.5cqw;top:5cqh;height:5.4cqw;opacity:0;filter:drop-shadow(0 .3cqw .8cqw rgba(0,0,0,.25))}
:host([data-go]) .dSt{animation:dPourIn .65s .05s cubic-bezier(.4,0,.2,1) forwards,dPourOut .45s 1.75s ease-in forwards}
:host([data-go]) .dDp{animation:dDrip .7s ease-in infinite}
:host([data-go]) .dLq{animation:dFill 1.9s .45s cubic-bezier(.3,.7,.3,1) forwards,dDrain .7s 5.5s cubic-bezier(.5,0,.75,0) forwards}
:host([data-go]) .dLq:before{animation:dCaustic 6s linear infinite}
:host([data-go]) .dW1{animation:dWave 3.6s linear infinite reverse}
:host([data-go]) .dW2{animation:dWave 2.7s linear infinite}
:host([data-go]) .dW3{animation:dWave 2s linear infinite}
:host([data-go]) .dBu{animation:dBubble 2.8s ease-in infinite}
:host([data-go]) .dBu b{animation:dWobble .7s ease-in-out infinite alternate}
:host([data-go]) .dIf{animation:dIn .6s 1.6s forwards,dBob 2.4s 1.6s ease-in-out infinite}
:host([data-go]) .dCw{animation:dCrown .9s 2.05s cubic-bezier(.2,1.1,.4,1) forwards}
:host([data-go]) .dSd,:host([data-go]) .dIa{animation:dArcX 1.25s cubic-bezier(.3,.6,.5,1) forwards}
:host([data-go]) .dSd b,:host([data-go]) .dIa b{animation:dArcY 1.25s linear forwards}
:host([data-go]) .dGl{animation:dSheen 1.6s 2.9s ease-in-out forwards}
:host([data-go]) .dKk{animation:dIn .5s 2.85s forwards}
:host([data-go]) .dMs .dMw{animation:dWipe .55s cubic-bezier(.3,.8,.3,1) forwards}
:host([data-go]) .dLg{animation:dIn .5s 2.5s forwards}
@keyframes dPourIn{to{height:62cqh}}
@keyframes dPourOut{to{top:62%;height:0}}
@keyframes dFlow{from{transform:translateY(-100%)}to{transform:translateY(100%)}}
@keyframes dDrip{0%{opacity:0;transform:translate(0,0)}20%{opacity:1}100%{opacity:0;transform:translate(-1cqw,40cqh)}}
@keyframes dFill{to{height:50cqh}}
@keyframes dDrain{to{height:0}}
@keyframes dCaustic{to{background-position:60cqw 40cqh,-60cqw 20cqh}}
@keyframes dWave{to{transform:translateX(-50%)}}
@keyframes dBubble{0%{opacity:0;transform:translateY(0)}15%{opacity:1}100%{opacity:0;transform:translateY(-44cqh)}}
@keyframes dWobble{to{transform:translateX(1cqw) scale(1.08,.94)}}
@keyframes dBob{0%,100%{translate:0 0;rotate:-8deg}50%{translate:0 -2cqh;rotate:10deg}}
@keyframes dCrown{0%{opacity:0;transform:scale(.4,.05)}55%{opacity:1;transform:scale(1.1,1.05)}100%{opacity:0;transform:scale(1.25,.7)}}
@keyframes dArcX{0%{opacity:0;transform:translateX(0)}8%{opacity:1}85%{opacity:1}100%{opacity:0;transform:translateX(var(--dx))}}
@keyframes dArcY{0%{transform:translateY(0) rotate(0)}45%{transform:translateY(calc(var(--up) * -1)) rotate(calc(var(--rot) * .45));animation-timing-function:ease-in}100%{transform:translateY(calc(var(--up) * .35)) rotate(var(--rot))}}
@keyframes dSheen{to{transform:translateX(100%)}}
@keyframes dWipe{to{clip-path:inset(0 0 0 0)}}
@keyframes dRiseLiq{from{opacity:0;transform:translateY(58cqh) rotate(-10deg) scale(.92)}to{opacity:1;transform:rotate(-4deg)}}`,
      html: `<svg width="0" height="0" style="position:absolute"><defs>${ing ? INGREDIENTS[ing] : ""}</defs></svg>
<div class="dSt"></div>
<div class="dLq"><svg class="dWv dW1" viewBox="0 0 200 10" preserveAspectRatio="none"><path d="M0 5 Q12.5 0 25 5 T50 5 T75 5 T100 5 T125 5 T150 5 T175 5 T200 5 V10 H0Z"/></svg><svg class="dWv dW2" viewBox="0 0 200 10" preserveAspectRatio="none"><path d="M0 6 Q10 1 20 6 T40 6 T60 6 T80 6 T100 6 T120 6 T140 6 T160 6 T180 6 T200 6 V10 H0Z"/></svg><svg class="dWv dW3" viewBox="0 0 200 10" preserveAspectRatio="none"><path d="M0 5 Q8 9 16 5 T32 5 T48 5 T64 5 T80 5 T96 5 T112 5 T128 5 T144 5 T160 5 T176 5 T192 5 T200 5 V10 H0Z"/><path class="dCrest" d="M0 5 Q8 9 16 5 T32 5 T48 5 T64 5 T80 5 T96 5 T112 5 T128 5 T144 5 T160 5 T176 5 T192 5 T200 5"/></svg>
${n(14, (i) => `<i class="dBu" style="left:${(3 + i * 6.8 + r() * 3).toFixed(1)}%;animation-delay:${(1.2 + r() * 2.2).toFixed(1)}s;animation-duration:${(2.2 + r() * 1.4).toFixed(1)}s"><b style="--s:${(0.9 + r() * 1.9).toFixed(1)}cqw;animation-delay:${(r()).toFixed(2)}s"></b></i>`)}<div class="dGl"></div></div>
${ing ? n(5, (i) => `<i class="dIf" style="left:${[6, 22, 38, 86, 94][i]}%;bottom:${[34, 28, 36, 30, 38][i]}cqh;width:${(5 + r() * 2.5).toFixed(1)}cqw;animation-delay:${(1.6 + i * 0.15).toFixed(2)}s,${(1.6 + i * 0.15).toFixed(2)}s"><svg viewBox="0 0 40 40"><use href="#dIng"/></svg></i>`) : ""}

${ing ? arc("dIa", 5, 56, 60, 40, 2.15) : ""}
${hero(o, t.fx, seed)}<div class="dLg">${logo}</div><div class="dMsg">${b.kicker ? `<div class="dKk">${esc(b.kicker)}</div>` : ""}${msg(3.25, 0.12)}</div>` };
  }
  if (name === "spotlight") {
    // spotlight v3: textured velvet with drifting gold bokeh; a two-layer beam that flickers and sways, dust in it; a
    // glossy pedestal; the piece rises out of the dark and turns slowly; star glints with anamorphic flares; gold foil
    // flecks falling through the light; a gold frame draws itself around the photo; the line in shimmering gold
    const gold = "#e8c675", gold2 = "#fff1c4", velvet = mix(deepBase, "#000000", 0.45);
    const fabric = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='.012 .09' numOctaves='3' seed='4'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23f)'/></svg>")}")`;
    return { rim: gold2, css: `
.dVv{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse 60% 75% at 66% 58%,${mix(velvet, "#ffffff", 0.08)} 0%,${velvet} 45%,#050407 100%)}
.dVv:before{content:"";position:absolute;inset:0;background-image:${fabric};background-size:46cqw 100%;mix-blend-mode:soft-light;opacity:.55}
.dVv:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(100deg,rgba(255,255,255,.035) 0 3cqw,rgba(0,0,0,.08) 3cqw 7cqw);mix-blend-mode:overlay}
.dBk{position:absolute;border-radius:50%;filter:blur(.9cqw);opacity:0}
.dBm{position:absolute;left:66%;top:-35%;width:70cqw;height:160cqh;margin-left:-35cqw;transform-origin:50% 0;opacity:0}
.dBm i{position:absolute;inset:0;clip-path:polygon(45% 0,55% 0,100% 100%,0 100%);filter:blur(1.2cqw);background:linear-gradient(180deg,rgba(255,240,205,.5),rgba(255,240,205,.07) 80%,transparent)}
.dBm i+i{clip-path:polygon(48% 0,52% 0,74% 100%,26% 100%);filter:blur(.5cqw);background:linear-gradient(180deg,rgba(255,250,232,.65),rgba(255,248,226,.12) 75%,transparent)}
.dMt{position:absolute;width:.45cqw;height:.45cqw;border-radius:50%;background:#fff7e0;box-shadow:0 0 .6cqw #fff3cf;opacity:0}
.dPed{position:absolute;left:66%;bottom:6cqh;width:44cqw;height:15cqh;margin-left:-22cqw;opacity:0}
.dPed:before{content:"";position:absolute;inset:0;border-radius:50%;background:radial-gradient(ellipse at 50% 40%,rgba(255,244,215,.5),rgba(255,236,190,.12) 55%,transparent 72%)}
.dPed:after{content:"";position:absolute;left:8%;right:8%;top:22%;height:30%;border-radius:50%;border-top:.25cqw solid rgba(255,230,170,.55);filter:blur(.15cqw)}
.dHero{left:66%;bottom:13cqh;width:42cqw;height:68cqh;margin-left:-21cqw;--enter:dGlow;--ein:1.45s;--ed:1.4s;--sd:3.1s}
.dHero .dHb{animation:dTurn 5s 2.8s ease-in-out infinite alternate}
.dFlr{position:absolute;width:3cqw;height:3cqw;opacity:0}
.dFlr:before{content:"";position:absolute;left:50%;top:50%;width:26cqw;height:.3cqw;margin:-.15cqw 0 0 -13cqw;background:linear-gradient(90deg,transparent,rgba(255,244,214,.9),transparent);filter:blur(.08cqw)}
.dFlr:after{content:"";position:absolute;inset:0;background:radial-gradient(circle,#fff 0 14%,transparent 18%),conic-gradient(from 45deg,transparent 0 10%,#fff 12% 13%,transparent 15% 35%,#fff 37% 38%,transparent 40% 60%,#fff 62% 63%,transparent 65% 85%,#fff 87% 88%,transparent 90%);filter:drop-shadow(0 0 .8cqw #fff3cf)}
.dFk{position:absolute;top:-6%;width:1.3cqw;height:.75cqw;opacity:0;background:linear-gradient(135deg,#fff5cf,${gold} 45%,#a87b2c);border-radius:.1cqw}
.dFrm{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.dFrm rect{fill:none;stroke:${gold};stroke-width:.35;stroke-dasharray:400;stroke-dashoffset:400;opacity:.9}
.dFrm path{fill:${gold};opacity:0}
.dMsg{position:absolute;left:6cqw;top:50%;width:38cqw;transform:translateY(-50%);color:#fbf3e2}
.dKk{font:500 2.1cqw/1.3 Poppins,system-ui;letter-spacing:.34em;text-transform:uppercase;color:${gold};opacity:0}
.dRl{height:.22cqw;width:0;margin:1.8cqw 0;background:linear-gradient(90deg,${gold},transparent)}
.dMs{font:600 5.4cqw/1.12 'Playfair Display',Georgia,serif;letter-spacing:.005em;text-wrap:balance;color:${gold}}
.dMs .dMw{transform:translateY(30%);filter:blur(.5cqw);background:linear-gradient(100deg,${gold} 0%,${gold2} 22%,${gold} 40%,#b8893a 60%,${gold2} 80%,${gold} 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.dLg{height:5cqw;margin-bottom:2.2cqw;opacity:0}
:host([data-go]) .dVv{animation:dIn 1s .05s ease-out forwards}
:host([data-go]) .dBk{animation:dIn 1.2s .6s forwards,dDriftB 7s .6s ease-in-out infinite alternate}
:host([data-go]) .dBm{animation:dBeamIn 1.25s .55s cubic-bezier(.3,.8,.3,1) forwards,dSway 4s 1.8s ease-in-out infinite alternate}
:host([data-go]) .dBm i+i{animation:dFlicker .18s 1.8s steps(2) 6}
:host([data-go]) .dMt{animation:dMote 4.2s linear infinite}
:host([data-go]) .dPed{animation:dIn .8s 1.3s forwards}
:host([data-go]) .dFlr{animation:dStar 1.3s ease-out forwards}
:host([data-go]) .dFk{animation:dFall 4.4s linear forwards}
:host([data-go]) .dFrm rect{animation:dDraw2 1.8s .3s cubic-bezier(.4,0,.2,1) forwards}
:host([data-go]) .dFrm path{animation:dIn .4s 1.9s forwards}
:host([data-go]) .dKk{animation:dIn .7s 2.8s forwards}
:host([data-go]) .dRl{animation:dRule 1s 3s cubic-bezier(.3,.8,.3,1) forwards}
:host([data-go]) .dMs .dMw{animation:dSoft .7s cubic-bezier(.2,.8,.3,1) forwards,dShimmer 3s linear infinite}
:host([data-go]) .dLg{animation:dIn .8s 2.5s forwards}
@keyframes dDriftB{to{transform:translate(2cqw,-3cqh) scale(1.15)}}
@keyframes dBeamIn{from{opacity:0;transform:rotate(36deg)}to{opacity:1;transform:rotate(0deg)}}
@keyframes dSway{from{transform:rotate(-1.6deg)}to{transform:rotate(1.6deg)}}
@keyframes dFlicker{50%{opacity:.75}}
@keyframes dMote{0%{opacity:0;transform:translate(0,0)}20%,80%{opacity:.85}100%{opacity:0;transform:translate(3cqw,-14cqh)}}
@keyframes dStar{0%{opacity:0;transform:scale(.2) rotate(0)}35%{opacity:1;transform:scale(1.1) rotate(40deg)}100%{opacity:0;transform:scale(.6) rotate(90deg)}}
@keyframes dFall{0%{opacity:0;transform:translate(0,0) rotateX(0) rotate(0)}10%{opacity:1}90%{opacity:.9}100%{opacity:0;transform:translate(var(--fx),110cqh) rotateX(1080deg) rotate(200deg)}}
@keyframes dDraw2{to{stroke-dashoffset:0}}
@keyframes dRule{to{width:20cqw}}
@keyframes dShimmer{to{background-position:-250% 0}}
@keyframes dSoft{to{transform:none;opacity:1;filter:none}}
@keyframes dTurn{from{transform:perspective(60cqw) rotateY(-7deg)}to{transform:perspective(60cqw) rotateY(7deg)}}
@keyframes dGlow{from{opacity:0;filter:brightness(0);transform:translateY(5cqh) scale(.94)}to{opacity:1;filter:none;transform:none}}`,
      html: `<div class="dVv"></div>${n(8, (i) => { const s = 5 + r() * 9; return `<i class="dBk" style="left:${(4 + r() * 50).toFixed(1)}%;top:${(8 + r() * 70).toFixed(1)}%;width:${s.toFixed(1)}cqw;height:${s.toFixed(1)}cqw;background:radial-gradient(circle,${i % 3 ? "rgba(232,198,117,.35)" : mix(base, "#ffffff", 0.4) + "55"},transparent 70%);animation-delay:${(0.6 + r() * 0.6).toFixed(1)}s,${(0.6 + r()).toFixed(1)}s"></i>`; })}
<div class="dBm"><i></i><i></i></div>${n(20, () => `<i class="dMt" style="left:${(52 + r() * 28).toFixed(1)}%;top:${(10 + r() * 70).toFixed(1)}%;animation-delay:${(0.9 + r() * 3).toFixed(1)}s"></i>`)}
<div class="dPed"></div>${hero(o, t.fx, seed)}
<svg class="dFrm" viewBox="0 0 100 56.25" preserveAspectRatio="none"><rect x="2.4" y="3.6" width="95.2" height="49" rx=".6"/>${[[2.4, 3.6], [97.6, 3.6], [2.4, 52.6], [97.6, 52.6]].map(([x, y]) => `<path d="M${x} ${y - 1.4} L${x + 1} ${y} L${x} ${y + 1.4} L${x - 1} ${y} Z"/>`).join("")}</svg>
<div class="dMsg"><div class="dLg">${logo}</div>${b.kicker ? `<div class="dKk">${esc(b.kicker)}</div>` : ""}<div class="dRl"></div>${msg(3.4, 0.13)}</div>` };
  }
  if (name === "portal") {
    const top = hex(b.sky_top) || mix(base, "#ffffff", 0.35), bottom = hex(b.sky_bottom) || "#ffd59e", pInk = "#1d1d1f";
    return { css: `
.dPt{position:absolute;inset:0;overflow:hidden;clip-path:inset(30% 38% 0 38% round 22cqw 22cqw 0 0)}
.dSky{position:absolute;inset:0;background:linear-gradient(180deg,${top} 0%,${mix(top, bottom, 0.5)} 55%,${bottom} 100%)}
.dSun{position:absolute;left:50%;bottom:20cqh;width:22cqw;height:22cqw;margin-left:-11cqw;border-radius:50%;background:radial-gradient(circle,#fffbe8 0 38%,#ffe6a6 52%,rgba(255,214,140,0) 72%);transform:translateY(30cqh)}
.dCl{position:absolute;height:6cqh;border-radius:6cqh;background:rgba(255,255,255,.85);filter:blur(.3cqw)}
.dCl:before{content:"";position:absolute;left:22%;bottom:40%;width:40%;height:150%;border-radius:50%;background:inherit}
.dHz{position:absolute;left:0;right:0;bottom:0;height:20cqh;background:linear-gradient(180deg,${mix(bottom, "#000000", 0.18)},${mix(bottom, "#000000", 0.35)})}
.dRt{position:absolute;inset:0;width:100%;height:100%;clip-path:inset(0 100% 0 0)}
.dRt path{fill:none;stroke:#fff;stroke-width:.5;stroke-dasharray:1.4 1.6;stroke-linecap:round;opacity:.95}
.dHero{left:52%;bottom:14cqh;width:30cqw;height:66cqh;--enter:dArrive;--ein:1.8s;--ed:1s;--sd:2.9s}
.dHero.dPh{width:38cqw;height:58cqh;bottom:22cqh}
.dPass{position:absolute;left:4cqw;bottom:-40cqh;width:44cqw;padding:2.4cqw 3cqw;box-sizing:border-box;border-radius:2cqw;background:#fffdf7;color:${pInk};box-shadow:0 1.6cqw 3.6cqw rgba(0,0,0,.3)}
.dPass:before,.dPass:after{content:"";position:absolute;top:58%;width:3.2cqw;height:3.2cqw;margin-top:-1.6cqw;border-radius:50%;background:${mix(bottom, "#000000", 0.25)}}
.dPass:before{left:-1.6cqw}.dPass:after{right:-1.6cqw}
.dPr{display:flex;justify-content:space-between;align-items:center;font:700 3.6cqw/1.1 Poppins,system-ui;letter-spacing:-.01em}
.dPr i{font-style:normal;color:${base};font-size:3cqw}
.dPl{font:500 1.7cqw/1.2 Poppins,system-ui;letter-spacing:.16em;text-transform:uppercase;color:#8a8a8f;display:flex;justify-content:space-between;margin-bottom:.6cqw}
.dPd{border-top:.25cqw dashed #d8d4ca;margin:1.6cqw 0 1.2cqw}
.dMs{font:600 2.9cqw/1.2 Poppins,system-ui;color:${pInk}}
.dLg{position:absolute;left:4cqw;top:4cqh;height:5cqw;opacity:0}
:host([data-go]) .dPt{animation:dOpen 1.4s .2s cubic-bezier(.6,0,.2,1) forwards}
:host([data-go]) .dSun{animation:dSunUp 2.4s .6s cubic-bezier(.2,.7,.3,1) forwards}
:host([data-go]) .dCl{animation:dDrift 9s linear forwards}
:host([data-go]) .dRt{animation:dDraw 1.6s 1.2s ease-in-out forwards}
:host([data-go]) .dPass{animation:dPassUp .8s 2.8s cubic-bezier(.2,1.2,.35,1) forwards}
:host([data-go]) .dLg{animation:dIn .5s 2.2s forwards}
@keyframes dOpen{to{clip-path:inset(0 0 0 0 round 0)}}
@keyframes dSunUp{to{transform:none}}
@keyframes dDrift{to{transform:translateX(-30cqw)}}
@keyframes dDraw{to{clip-path:inset(0 0 0 0)}}
@keyframes dPassUp{to{bottom:6cqh}}
@keyframes dArrive{from{opacity:0;transform:translateX(50cqw) rotate(4deg)}to{opacity:1;transform:none}}`,
      html: `<div class="dPt"><div class="dSky"></div><div class="dSun"></div>${n(4, (i) => `<i class="dCl" style="left:${[8, 62, 34, 86][i]}%;top:${[14, 24, 34, 10][i]}%;width:${[16, 12, 20, 10][i]}cqw"></i>`)}<div class="dHz"></div>
<svg class="dRt" viewBox="0 0 100 56" preserveAspectRatio="none"><path d="M6 40 C 24 14, 50 10, 70 18 S 92 14, 98 6"/></svg></div>
${hero(o, t.fx, seed)}<div class="dLg">${logo}</div>
<div class="dPass"><div class="dPl"><span>From</span><span>To</span></div><div class="dPr"><span>${esc(b.pass_from || "Here")}</span><i>✈</i><span>${esc(b.pass_to || "Anywhere")}</span></div><div class="dPd"></div>${msg(3.4)}</div>` };
  }
  if (name === "shatter") {
    const sInk = inkOn(base);
    // the shards: a fan of triangles from the impact point, each a piece of the article photo flying apart
    const cx = 58, cy = 46, pts = Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2 + r() * 0.4; return [cx + Math.cos(a) * 160, cy + Math.sin(a) * 160]; });
    const shards = pts.map((p, i) => { const q = pts[(i + 1) % pts.length], mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy, len = Math.hypot(mx, my) || 1;
      return `<i class="dSh" style="clip-path:polygon(${cx}% ${cy}%,${p[0].toFixed(1)}% ${p[1].toFixed(1)}%,${q[0].toFixed(1)}% ${q[1].toFixed(1)}%);--tx:${(mx / len * 70).toFixed(1)}cqw;--ty:${(my / len * 70).toFixed(1)}cqh;--rt:${(r() * 70 - 35).toFixed(0)}deg;animation-delay:${(0.75 + r() * 0.15).toFixed(2)}s"></i>`; }).join("");
    const cracks = n(9, (i) => { const a = (i / 9) * Math.PI * 2 + r(); let x = cx, y = cy * 0.5625, d = `M${x} ${y.toFixed(1)}`; for (let k = 0; k < 4; k++) { x += Math.cos(a + r() * 0.6 - 0.3) * (6 + r() * 8); y += Math.sin(a + r() * 0.6 - 0.3) * (4 + r() * 6); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; } return `<path d="${d}"/>`; });
    return { css: `
.dEn{position:absolute;inset:0;opacity:0;background:radial-gradient(circle at ${cx}% ${cy}%,${mix(base, "#ffffff", 0.35)} 0%,${base} 35%,${deepBase} 100%)}
.dLn{position:absolute;inset:-50%;opacity:0;background:repeating-conic-gradient(from 0deg at 50% 50%,rgba(255,255,255,.14) 0 2deg,transparent 2deg 9deg)}
.dSh{position:absolute;inset:0;background:url("${esc(t.photoUrl)}") center/cover no-repeat}
.dCk{position:absolute;inset:0;width:100%;height:100%;opacity:0}
.dCk path{fill:none;stroke:#fff;stroke-width:.45;stroke-linejoin:bevel;stroke-dasharray:60;stroke-dashoffset:60}
.dFl{position:absolute;left:${cx}%;top:${cy}%;width:10cqw;height:10cqw;margin:-5cqw;border-radius:50%;background:radial-gradient(circle,#fff,rgba(255,255,255,0) 70%);opacity:0}
.dRing{position:absolute;left:${cx}%;top:${cy}%;width:30cqw;height:30cqw;margin:-15cqw;border-radius:50%;border:.6cqw solid rgba(255,255,255,.8);opacity:0}
.dHero{left:${cx}%;top:${cy}%;width:46cqw;height:74cqh;margin:-40cqh 0 0 -23cqw;--enter:dBurst;--ein:1.05s;--ed:.6s;--sd:2.2s}
.dMsg{position:absolute;left:4cqw;top:8cqh;width:44cqw;color:${sInk}}
.dKk{font:700 2.6cqw/1.1 Poppins,system-ui;letter-spacing:.14em;text-transform:uppercase;opacity:.9;margin-bottom:1cqw}
.dMs{font:400 8cqw/.95 Anton,Impact,'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.01em;text-shadow:0 .4cqw 1.4cqw rgba(0,0,0,.3)}
.dMs .dMw{transform:scale(2.2)}
.dLg{position:absolute;left:4cqw;bottom:6cqh;height:5cqw;opacity:0}
:host([data-go]) .dCk{animation:dIn .15s .25s forwards,dOut .1s .8s forwards}
:host([data-go]) .dCk path{animation:dCrack .5s .25s ease-out forwards}
:host([data-go]) .dFl{animation:dFlash .6s .7s ease-out forwards}
:host([data-go]) .dEn{animation:dIn .2s .75s forwards}
:host([data-go]) .dLn{animation:dIn .2s .75s forwards,dSpin 14s .75s linear infinite}
:host([data-go]) .dSh{animation:dFly 1s cubic-bezier(.3,.6,.4,1) forwards}
:host([data-go]) .dRing{animation:dRingOut .9s 1.1s ease-out forwards}
:host([data-go]) .dLg{animation:dIn .4s 2.4s forwards}
@keyframes dCrack{to{stroke-dashoffset:0}}
@keyframes dFlash{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(8)}}
@keyframes dFly{to{transform:translate(var(--tx),var(--ty)) rotate(var(--rt)) scale(.85);opacity:0}}
@keyframes dRingOut{0%{opacity:.9;transform:scale(.5)}100%{opacity:0;transform:scale(2.4)}}
@keyframes dSpin{to{transform:rotate(360deg)}}
@keyframes dBurst{0%{opacity:0;transform:scale(.2) rotate(-25deg);filter:blur(1.2cqw)}60%{opacity:1;transform:scale(1.12) rotate(-12deg);filter:none}100%{opacity:1;transform:rotate(-14deg)}}`,
      html: `<div class="dEn"></div><div class="dLn"></div>${shards}<svg class="dCk" viewBox="0 0 100 56.25" preserveAspectRatio="none">${cracks}</svg><i class="dFl"></i><i class="dRing"></i>
${hero(o, t.fx, seed)}<div class="dMsg">${kick}${msg(1.7, 0.16)}</div><div class="dLg">${logo}</div>` };
  }
  return null;
}

// The end card carries the idea on: the strip that stays is dressed like the scene before it (frost → frosted glass,
// pour → the liquid's colour with a wave on top, spotlight → black and gold, portal → the journey design, shatter → the
// angled sport design), instead of every idea settling into the same strip.
const END_STYLE = { frost: "bold", pour: "bold", spotlight: "luxe", portal: "journey", shatter: "sport" };
/** The strip design an ad ends on (its fonts are loaded by the studio). */
export const endStyle = (device, fallback) => END_STYLE[device] || fallback;
function endCard(dev, brief, base) {
  if (dev === "frost") return { look: { colour: "#e3f1fa", accent: null }, css: `
.w .s{background:linear-gradient(118deg,rgba(240,249,255,.9),rgba(212,234,248,.84));-webkit-backdrop-filter:blur(1.8cqw) saturate(1.3);backdrop-filter:blur(1.8cqw) saturate(1.3);box-shadow:0 -.4cqw 0 rgba(255,255,255,.95) inset,0 -1cqw 3.4cqw rgba(20,60,90,.22)}
.w .s:after{opacity:.05}
.w .tx{color:#0e2f4a}
.w .cta{background:${base};color:${inkOn(base)}}` };
  if (dev === "pour") {
    const liq = hex(brief.liquid) || base, hiL = mix(liq, "#ffffff", 0.3), dkL = mix(liq, "#000000", 0.32);
    const wave = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 10' preserveAspectRatio='none'><path d='M0 6 Q12.5 0 25 5 T50 5 T75 5 T100 4 V10 H0Z'/></svg>")}")`;
    return { look: { colour: liq, accent: null }, css: `
.w .s{background:linear-gradient(180deg,${hiL} 0%,${liq} 30%,${dkL} 100%);box-shadow:none;-webkit-mask:${wave} top/100% 4.2cqw no-repeat,linear-gradient(#000,#000) 0 4cqw/100% 100% no-repeat;mask:${wave} top/100% 4.2cqw no-repeat,linear-gradient(#000,#000) 0 4cqw/100% 100% no-repeat}
.w .s:before{display:none}
.w .lg{top:4.6cqw}.w .tx{margin-top:1.6cqw}` };
  }
  return { look: { colour: base }, css: "" };
}

/**
 * The ad as staged by the creative director: the device's ~6 s scene over the picture, then the brand strip.
 * @param {Parameters<typeof stripHtml>[0] & { hook?: string|null, photoUrl?: string|null, seed?: string }} o
 * @param {{ device: string, base?: string, accent?: string, liquid?: string, ingredients?: string, sky_top?: string, sky_bottom?: string, kicker?: string, message: string, pass_from?: string, pass_to?: string, product_fx?: string[] }} brief
 */
export function sceneHtml(o, brief) {
  const dev = DEVICES.includes(brief.device) ? brief.device : "medallion";
  if (dev === "medallion" || (dev === "shatter" && !o.photoUrl)) return storyHtml({ ...o, claim: brief.message || null });
  const base = hex(brief.base) || hex(o.colour) || "#1d2b53";
  const deepBase = mix(base, "#000000", 0.42), seed = String(o.seed || o.brand) + dev;
  const fx = (brief.product_fx || []).filter((x) => FX.includes(x));
  // the logo as it reads on the scene behind it (frost and pour: light; spotlight: dark; shatter: the base colour)
  const behind = { frost: "#e6f4fc", pour: mix(hex(brief.liquid) || base, "#ffffff", 0.2), spotlight: "#08070b", portal: hex(brief.sky_top) || mix(base, "#ffffff", 0.35), shatter: base }[dev];
  const lmode = o.logoUrl ? logoMode({ kind: o.logoKind || "mark", ink: o.logoInk, behind }) : "text";
  const logo = o.logoUrl ? `<span class="dLm ${lmode}"><img src="${esc(o.logoUrl)}" alt=""></span>` : `<b class="dLt">${esc(o.brand)}</b>`;
  const d = device(dev, o, { ...brief, message: brief.message || o.headline }, { base, deepBase, logo, seed, fx, photoUrl: o.photoUrl, kickAt: 2.7 });
  if (!d) return storyHtml(o);
  const end = endCard(dev, brief, base);
  const strip = stripHtml({ ...o, ...end.look, style: endStyle(dev, o.style) }).split(":host([data-go])").join(":host([data-go2])");
  return `${strip}
<style>*{text-decoration:none!important}${end.css}
.dz{position:absolute;inset:0;container-type:size;overflow:hidden;font-family:Poppins,system-ui,sans-serif;-webkit-font-smoothing:antialiased;pointer-events:none}
.w>.ad,.w>.x{display:none}
.dMw,.dKw{display:inline-block;opacity:0;transform:translateY(45%)}
:host([data-go]) .dMw,:host([data-go]) .dKw{animation:dWord .5s cubic-bezier(.2,1.3,.4,1) forwards}
.dLm{display:inline-flex;height:100%}.dLm img{height:100%;width:auto;max-width:26cqw;object-fit:contain}
.dLm.chip{background:#fff;padding:.5cqw 1.2cqw;border-radius:1.2cqw;box-shadow:0 .2cqw .8cqw rgba(0,0,0,.25)}.dLm.chipd{background:#14171f;padding:.5cqw 1.2cqw;border-radius:1.2cqw;box-shadow:0 .2cqw .8cqw rgba(0,0,0,.25)}
.dLt{font:700 3.2cqw/1 Poppins,system-ui;letter-spacing:.04em}
.dAd{position:absolute;right:5.8cqw;top:1.75cqw;font:600 1.8cqw/1 system-ui;letter-spacing:.08em;color:#fff;background:rgba(0,0,0,.32);padding:.55cqw .95cqw;border-radius:.8cqw;opacity:0;z-index:9}
.dX{position:absolute;right:1.4cqw;top:1.4cqw;width:3.6cqw;height:3.6cqw;border-radius:50%;background:rgba(0,0,0,.32);color:#fff;font:500 2.8cqw/3.5cqw system-ui;text-align:center;opacity:0;z-index:9}
:host([data-go]) .dAd,:host([data-go]) .dX{animation:dIn .3s .3s forwards}
/* the scene fades out on an inner wrapper: an animated .dz would cut the frost's backdrop blur off from the photo */
.dzi{position:absolute;inset:0}
:host([data-go]) .dzi{animation:dSceneOut .55s 5.75s cubic-bezier(.5,0,.75,0) forwards}
@keyframes dWord{to{opacity:1;transform:none}}
@keyframes dOut{from{opacity:1}to{opacity:0}}
@keyframes dSceneOut{to{opacity:0;transform:scale(1.04)}}
${HERO_CSS(fx.includes("rim") ? d.rim || mix(base, "#ffffff", 0.5) : null)}
${d.css}
</style>
<div class="dz" data-go2="${STORY_MS}" data-device="${dev}">${d.under || ""}<div class="dzi">${d.html}</div><span class="dAd">Ad</span><span class="dX">&times;</span></div>`;
}

export const sceneVersion = (device) => device === "medallion" ? `${DIRECTOR_VERSION}/${STORY_VERSION}+${STRIP_VERSION}` : `${DIRECTOR_VERSION}/${device}+${STRIP_VERSION}`;
