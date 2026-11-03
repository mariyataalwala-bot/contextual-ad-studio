// VOX-style in-image units (the client's reference: VOX / Hybrid "Stripe" and "Full", e.g. Peugeot PL, Dabur Odomos).
//   Stripe — a thin clean white bar (about a quarter of the picture) slides up over the bottom of the article photo:
//            the brand's campaign photo edge to edge in the left cell, one big bold product name, one short line in
//            small capitals and a small rectangular button in the brand colour in the centre, the logo on the right.
//   Full   — the campaign visual takes over the whole picture for ~4 s with the product name and the button, then
//            collapses into the Stripe.
// Premium = real campaign imagery + crisp type + generous spacing: no particles, glows, loops or decoration. Motion is
// only the slide-up and a soft fade of the text. Same options as stripHtml (strip.mjs) plus campaignUrl (a frame of the
// brand's own TV ad, cover-cropped in its cell) and productName. A pack cut-out is never cropped: it sits contained on
// the white. The logo is shown exactly as supplied (logoMode: on a plate when it would not stand out on white).
// Every class and keyframe starts with "v", so the unit can sit next to the strip inside one shadow root.
import { logoMode, contrast, luminance } from "./strip.mjs";

export const VOX_VERSION = "vox.v1";
export const VOX_LAYOUTS = ["vox-stripe", "vox-full"];
export const VOX_FULL_MS = 4200;   // the takeover holds this long, then the host gets data-go2 and it collapses

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim()); return m ? "#" + m[1].toLowerCase() : null; };

const UNIT = /^(\d+(\.\d+)?)?(cms?|mm|ml|ltr?|l|g|gm|kg|pcs?|pack|inch(es)?)$/i;
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** the model name as VOX shows it ("NOWY 2008"): without the brand, cut before the size, at most 3 words */
export function shortName(name, brand = "") {
  const all = String(name || "").trim().split(/\s+/).filter(Boolean);
  const b = new Set(fold(brand).split(/\s+/).filter(Boolean));
  let w = all.filter((x, i) => !(b.has(fold(x).replace(/[^\w-]/g, "")) && i < 3));
  const cut = w.findIndex((x, i) => i > 0 && UNIT.test(x.replace(/[^\w.]/g, "")));
  if (cut > 0) w = w.slice(0, cut);
  w = w.slice(0, 3);
  return w.length ? w.join(" ") : all.join(" ");
}

/** the shared parts of both formats */
function parts(o) {
  let c = hex(o.colour) || "#1d2b53";
  if (luminance(c) > 0.82) c = hex(o.accent) && luminance(hex(o.accent)) < 0.82 ? hex(o.accent) : "#141414";   // a near-white brand colour would vanish on white
  const ctaInk = contrast(c, "#ffffff") >= 3 ? "#ffffff" : "#141414";
  const name = o.productName ? shortName(o.productName, o.brand) : String(o.headline || o.brand || "").trim();
  const fx = Number.isFinite(+o.campaignFocus) ? Math.max(0, Math.min(100, Math.round(+o.campaignFocus))) : 50;   // where the product sits across the campaign frame
  const line = String(o.productName ? (o.headline || o.subline || "") : (o.subline || "")).trim();
  const campaign = !!o.campaignUrl;
  const pic = campaign ? o.campaignUrl : o.productUrl;
  const lmode = o.logoUrl ? logoMode({ kind: o.logoKind || "mark", ink: o.logoInk, behind: "#ffffff" }) : "text";
  const logo = o.logoUrl ? `<div class="vlg vlg-${lmode}"><img src="${esc(o.logoUrl)}" alt="${esc(o.brand)}"></div>` : `<div class="vlg vlg-text">${esc(o.brand)}</div>`;
  const cell = pic ? `<div class="vph ${campaign ? "vph-cover" : "vph-pack"}"><img src="${esc(pic)}" alt=""${campaign ? ` style="object-position:${fx}% 50%"` : ""}></div>` : "";
  const text = `<div class="vtx"><div class="vnm">${esc(name)}</div>${line ? `<div class="vln">${esc(line)}</div>` : ""}<div class="vcta">${esc(o.cta || "Shop now")}</div></div>`;
  return { c, ctaInk, cell, text, logo };
}

const BASE = (c, ctaInk) => `*{text-decoration:none!important;box-sizing:border-box}
:host{display:block}
.vw{position:absolute;inset:0;container-type:size;overflow:hidden;font-family:Poppins,system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:#111}
.vph{position:absolute;overflow:hidden;background:#fff}
.vph img{display:block;width:100%;height:100%}
.vph-cover img{object-fit:cover;object-position:center}
.vph-pack{padding:6%}
.vph-pack img{object-fit:contain;object-position:center}
.vtx{position:absolute;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;overflow:hidden}
.vnm{font-weight:700;font-size:var(--vfs,5.4cqw);line-height:1.02;letter-spacing:-.02em;text-transform:uppercase;color:#111;text-wrap:balance;max-width:100%}
.vln{margin-top:.55em;font-weight:500;font-size:var(--vfl,2.2cqw);line-height:1.2;letter-spacing:.12em;text-transform:uppercase;color:#555;max-width:100%}
.vcta{margin-top:var(--vgap,1.4cqw);flex:none;font-weight:600;font-size:var(--vfc,2.2cqw);line-height:1;letter-spacing:.06em;text-transform:uppercase;padding:.85em 1.4em;border-radius:.3cqw;background:${c};color:${ctaInk};white-space:nowrap}
.vlg{position:absolute;display:flex;align-items:center;justify-content:center}
.vlg img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
.vlg-chip,.vlg-chipd{padding:.6cqw 1cqw;border-radius:.6cqw}
.vlg-chipd{background:#14171f}
.vlg-text{font-weight:700;font-size:4.2cqw;letter-spacing:.04em;color:${c}}
.vic{position:absolute;top:1cqw;right:1cqw;display:flex;gap:.8cqw;z-index:5}
.vic i{display:block;width:2.8cqw;height:2.8cqw;border-radius:50%;border:.15cqw solid #bbb;color:#888;font:600 1.8cqw/2.5cqw system-ui;font-style:normal;text-align:center;background:#fff}`;

/** the stripe's CSS; trigger = the host attribute that starts it (data-go, or data-go2 after a takeover) */
const STRIPE_CSS = (trigger) => `.vs{position:absolute;left:0;right:0;bottom:0;height:min(max(25cqh,19cqw),42cqh);background:#fff;box-shadow:0 -.4cqw 1.6cqw rgba(0,0,0,.16);transform:translateY(102%)}
.vs .vph{left:0;top:0;bottom:0;width:40%}
.vs .vtx{left:calc(40% + 3.4cqw);right:19cqw;top:1.4cqw;bottom:1.4cqw;opacity:0}
.vs .vlg{right:2.6cqw;width:14cqw;top:4.4cqw;bottom:2.4cqw}
.vs .vic{opacity:0}
:host([${trigger}]) .vs{animation:vsUp .6s cubic-bezier(.2,.8,.2,1) forwards}
:host([${trigger}]) .vs .vtx,:host([${trigger}]) .vs .vic{animation:vFade .5s .45s ease-out forwards}
@keyframes vsUp{to{transform:none}}
@keyframes vFade{to{opacity:1}}`;

const stripeBody = (p) => `<div class="vs">${p.cell}${p.text}${p.logo}<div class="vic"><i>i</i><i>&times;</i></div></div>`;

/**
 * The Stripe on its own. Starts on data-go.
 * @param {Record<string, any>} o stripHtml's options plus campaignUrl, productName
 */
export function voxStripeHtml(o) {
  const p = parts(o);
  return `<style>
${BASE(p.c, p.ctaInk)}
${STRIPE_CSS("data-go")}
</style>
<div class="vw vox-stripe" data-vox="stripe">${stripeBody(p)}</div>`;
}

/**
 * The Full takeover (campaign visual over the whole picture, product name, line and button) for VOX_FULL_MS, then it
 * collapses into the Stripe. Starts on data-go; the host sets data-go2 after data-go2 ms (mock.mjs goCreative).
 * @param {Record<string, any>} o stripHtml's options plus campaignUrl, productName
 */
export function voxFullHtml(o) {
  const p = parts(o);
  return `<style>
${BASE(p.c, p.ctaInk)}
.vf{position:absolute;inset:0;background:#fff;opacity:0;z-index:2}
.vf .vph{left:0;top:0;bottom:0;width:58%}
.vf .vtx{left:calc(58% + 4cqw);right:4cqw;top:15cqh;bottom:7cqh;--vfs:7.6cqw;--vfl:2.6cqw;--vfc:2.6cqw;--vgap:2.4cqw;opacity:0}
.vf .vlg{left:calc(58% + 4cqw);top:6cqh;height:11cqh;width:22cqw;justify-content:flex-start}
:host([data-go]) .vf{animation:vFade .5s ease-out forwards}
:host([data-go]) .vf .vtx{animation:vFade .6s .5s ease-out forwards}
:host([data-go2]) .vf{animation:vfShut .6s cubic-bezier(.4,0,.2,1) forwards}
@keyframes vfShut{from{opacity:1;clip-path:inset(0 0 0 0)}to{opacity:0;clip-path:inset(75% 0 0 0)}}
${STRIPE_CSS("data-go2")}
</style>
<div class="vw vox-full" data-vox="full"><div class="vf" data-go2="${VOX_FULL_MS}">${p.cell}${p.logo}${p.text}<div class="vic"><i>i</i><i>&times;</i></div></div>${stripeBody(p)}</div>`;
}

/** the creative for a layout ("vox-stripe" | "vox-full") */
export const voxHtml = (layout, o) => layout === "vox-stripe" ? voxStripeHtml(o) : voxFullHtml(o);

// Runs inside the page after the unit is placed (self-contained: it is stringified): shrinks the product name, then the
// line, until each text block fits its column (name at most two lines, nothing past the column's bottom); a line that
// still does not fit is dropped. Used instead of fitStrip, which needs the strip's classes.
/* global getComputedStyle */
export function fitVox(host) {
  const root = host.shadowRoot; if (!root) return;
  for (const tx of /** @type {HTMLElement[]} */ ([...root.querySelectorAll(".vtx")])) {
    const nm = /** @type {HTMLElement|null} */ (tx.querySelector(".vnm")), ln = /** @type {HTMLElement|null} */ (tx.querySelector(".vln"));
    if (!nm) continue;
    const cw = tx.offsetWidth || 1;   // 1cqw = the unit's width / 100
    const unit = (/** @type {HTMLElement} */ (root.querySelector(".vw"))).offsetWidth / 100 || 1;
    const fs0 = parseFloat(getComputedStyle(nm).fontSize) / unit, fl0 = ln ? parseFloat(getComputedStyle(ln).fontSize) / unit : 0;
    const lines = (el) => el.offsetHeight / (parseFloat(getComputedStyle(el).lineHeight) || 1);
    const over = () => tx.scrollHeight > tx.clientHeight + 1 || nm.scrollWidth > cw + 1 || lines(nm) > 2.1;
    for (let f = fs0; over() && f > 2.6; f -= 0.2) tx.style.setProperty("--vfs", f.toFixed(1) + "cqw");
    if (ln) {
      for (let f = fl0; over() && f > 1.7; f -= 0.1) tx.style.setProperty("--vfl", f.toFixed(1) + "cqw");
      if (over()) ln.remove();
    }
  }
}
