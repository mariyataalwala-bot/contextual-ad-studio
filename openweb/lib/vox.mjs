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

/** a product box in % of the frame ({x,y,w,h}), or null when missing / empty */
export function productBox(b) {
  if (!b || typeof b !== "object" || ![b.x, b.y, b.w, b.h].every((v) => Number.isFinite(+v))) return null;
  const n = (/** @type {any} */ v) => Math.max(0, Math.min(100, +v));
  const x = n(b.x), y = n(b.y), w = Math.min(n(b.w), 100 - x), h = Math.min(n(b.h), 100 - y);
  return w >= 2 && h >= 2 ? { x, y, w, h } : null;
}

/**
 * Where a cover-filled frame must sit so the whole product box (in % of the frame) stays inside the cell with a margin
 * (pad, a fraction of the cell's shorter side): { px, py } object-position in %, or null when no position keeps it whole
 * (the frame is then contained). Pure; fitVox runs the same sums inside the page.
 */
export function coverPosition(iw, ih, cw, ch, box, pad = 0.04) {
  if (!(iw > 0 && ih > 0 && cw > 0 && ch > 0) || !box) return null;
  const s = Math.max(cw / iw, ch / ih), DW = iw * s, DH = ih * s, m = Math.min(cw, ch) * pad;
  const axis = (/** @type {number} */ D, /** @type {number} */ c, /** @type {number} */ b0, /** @type {number} */ bl) => {
    const over = D - c, a = b0 / 100 * D, z = (b0 + bl) / 100 * D;
    if (over < 0.5) return a >= -0.5 && z <= D + 0.5 ? 50 : null;   // this axis is not cropped
    const lo = Math.max(0, (z + m - c) / over), hi = Math.min(1, (a - m) / over);
    if (lo > hi + 1e-9) return null;
    const want = ((a + z) / 2 - c / 2) / over;
    return Math.round(Math.max(lo, Math.min(hi, want)) * 1000) / 10;
  };
  const px = axis(DW, cw, box.x, box.w), py = axis(DH, ch, box.y, box.h);
  return px == null || py == null ? null : { px, py };
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
  // a product photo or pack cut-out is always contained, with padding. A campaign frame is cover-filled only when the
  // vision call confirmed it holds no burnt-in text (campaignCrop) AND gave the product's box (campaignBox); fitVox then
  // checks on the page that the whole box stays inside the cell with a margin, else it contains the frame instead
  const box = campaign && o.campaignCrop === true ? productBox(o.campaignBox) : null;
  const crop = !!box;
  const cls = crop ? "vph-cover" : campaign ? "vph-fit" : "vph-pack";
  const cell = pic ? `<div class="vph ${cls}"><img src="${esc(pic)}" alt=""${crop ? ` data-box="${box.x},${box.y},${box.w},${box.h}" style="object-position:${fx}% 50%"` : ""}></div>` : "";
  const text = `<div class="vtx"><div class="vnm">${esc(name)}</div>${line ? `<div class="vln">${esc(line)}</div>` : ""}<div class="vcta">${esc(o.cta || "Shop now")}</div></div>`;
  return { c, ctaInk, cell, text, logo };
}

const BASE = (c, ctaInk) => `*{text-decoration:none!important;box-sizing:border-box}
:host{display:block}
.vw{position:absolute;inset:0;container-type:size;overflow:hidden;font-family:Poppins,system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:#111}
.vph{position:absolute;overflow:hidden;background:#fff}
.vph img{display:block;width:100%;height:100%}
.vph-cover img{object-fit:cover;object-position:center}
.vph-fit{padding:4%}
.vph-fit img{object-fit:contain;object-position:center}
.vph-pack{padding:6%}
.vph-pack img{object-fit:contain;object-position:center}
.vtx{position:absolute;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;overflow:hidden}
.vnm{font-weight:700;font-size:var(--vfs,5.4cqw);line-height:1.02;letter-spacing:-.02em;text-transform:uppercase;color:#111;text-wrap:balance;max-width:100%}
.vln{margin-top:.55em;font-weight:500;font-size:var(--vfl,2.2cqw);line-height:1.2;letter-spacing:.12em;text-transform:uppercase;color:#555;max-width:100%}
.vcta{margin-top:var(--vgap,1.4cqw);flex:none;font-weight:600;font-size:var(--vfc,2.2cqw);line-height:1;letter-spacing:.06em;text-transform:uppercase;padding:.7em 1.3em;border-radius:.3cqw;background:${c};color:${ctaInk};white-space:nowrap}
.vlg{position:absolute;display:flex;align-items:center;justify-content:center}
.vlg img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
.vlg-chip,.vlg-chipd{padding:.6cqw 1cqw;border-radius:.6cqw}
.vlg-chipd{background:#14171f}
.vlg-text{font-weight:700;font-size:4.2cqw;letter-spacing:.04em;color:${c}}
.vic{position:absolute;top:1cqw;right:1cqw;display:flex;gap:.8cqw;z-index:5}
.vic i{display:block;width:2.8cqw;height:2.8cqw;border-radius:50%;border:.15cqw solid #bbb;color:#888;font:600 1.8cqw/2.5cqw system-ui;font-style:normal;text-align:center;background:#fff}`;

/** the stripe's CSS; trigger = the host attribute that starts it (data-go, or data-go2 after a takeover) */
const STRIPE_CSS = (trigger) => `.vs{position:absolute;left:0;right:0;bottom:0;height:min(max(25cqh,24cqw),42cqh);background:#fff;box-shadow:0 -.4cqw 1.6cqw rgba(0,0,0,.16);transform:translateY(102%)}
.vs .vph{left:0;top:0;bottom:0;width:38%}
.vs .vtx{left:calc(38% + 3.4cqw);right:19cqw;top:3.2cqw;bottom:3.2cqw;opacity:0}
.vs .vlg{right:3.4cqw;width:12cqw;top:4.6cqw;bottom:4.6cqw}
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

// Runs inside the page after the unit is placed (self-contained: it is stringified). The client's hard rule: text, logo
// and product are never cut, trimmed or overlapping. Every size starts at least 10 px (legible on a phone); then, in
// this order, until the column fits (name at most two lines, nothing past the column) and the logo, name, line and
// button each lie inside their bar with a 3% safe margin and touch neither each other nor the photo cell:
//   the name shrinks → the logo shrinks (scaled, so its aspect ratio is kept) → the line shrinks, then is dropped →
//   the button's text shrinks. Nothing is ever clipped; whatever still does not fit is reported on the host
//   (data-vox-fit="fail: …"), which the QA geometry check turns into a blocking issue.
/* global getComputedStyle, document, innerWidth, innerHeight, DOMMatrix */
export function fitVox(host) {
  const root = host.shadowRoot; if (!root) return;
  const vw = /** @type {HTMLElement|null} */ (root.querySelector(".vw")); if (!vw) return;
  const unit = vw.offsetWidth / 100 || 1, px10 = 10.1 / unit;   // 1cqw = the unit's width / 100; px10 = 10 px in cqw
  const R = (/** @type {Element} */ el) => el.getBoundingClientRect();
  const ink = (/** @type {Element} */ el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return b.width ? b : R(el); };
  const fails = [];
  // a cover-filled frame keeps the whole product box inside its cell (with a margin), else it is contained instead
  for (const img of /** @type {HTMLImageElement[]} */ ([...root.querySelectorAll(".vph-cover img")])) {
    const cell = /** @type {HTMLElement} */ (img.parentElement), b = String(img.dataset.box || "").split(",").map(Number);
    const iw = img.naturalWidth, ih = img.naturalHeight, cw = cell.clientWidth, ch = cell.clientHeight;
    let pos = null;
    if (b.length === 4 && b.every(Number.isFinite) && iw > 0 && ih > 0 && cw > 0 && ch > 0) {
      const s = Math.max(cw / iw, ch / ih), DW = iw * s, DH = ih * s, m = Math.min(cw, ch) * 0.04;
      const axis = (/** @type {number} */ D, /** @type {number} */ c, /** @type {number} */ b0, /** @type {number} */ bl) => {
        const over = D - c, a = b0 / 100 * D, z = (b0 + bl) / 100 * D;
        if (over < 0.5) return a >= -0.5 && z <= D + 0.5 ? 50 : null;
        const lo = Math.max(0, (z + m - c) / over), hi = Math.min(1, (a - m) / over);
        if (lo > hi + 1e-9) return null;
        return Math.round(Math.max(lo, Math.min(hi, ((a + z) / 2 - c / 2) / over)) * 1000) / 10;
      };
      const px = axis(DW, cw, b[0], b[2]), py = axis(DH, ch, b[1], b[3]);
      if (px != null && py != null) pos = px + "% " + py + "%";
    }
    if (pos) img.style.objectPosition = pos;
    else { cell.classList.remove("vph-cover"); cell.classList.add("vph-fit"); img.style.objectPosition = ""; delete img.dataset.box; }
  }
  for (const tx of /** @type {HTMLElement[]} */ ([...root.querySelectorAll(".vtx")])) {
    const bar = /** @type {HTMLElement} */ (tx.parentElement);
    const nm = /** @type {HTMLElement|null} */ (tx.querySelector(".vnm")), ln = /** @type {HTMLElement|null} */ (tx.querySelector(".vln")), cta = /** @type {HTMLElement|null} */ (tx.querySelector(".vcta"));
    const lg = /** @type {HTMLElement|null} */ (bar.querySelector(":scope > .vlg")), cell = bar.querySelector(":scope > .vph");
    if (!nm) continue;
    const size = (/** @type {HTMLElement|null} */ el) => (el ? parseFloat(getComputedStyle(el).fontSize) / unit : 0);
    const set = (/** @type {string} */ v, /** @type {number} */ f) => tx.style.setProperty(v, f.toFixed(2) + "cqw");
    for (const [v, el] of /** @type {[string, HTMLElement|null][]} */ ([["--vfs", nm], ["--vfl", ln], ["--vfc", cta]])) if (el && size(el) < px10) set(v, px10);
    const lines = (/** @type {HTMLElement} */ el) => el.offsetHeight / (parseFloat(getComputedStyle(el).lineHeight) || 1);
    const over = () => tx.scrollHeight > tx.clientHeight + 1 || tx.scrollWidth > tx.clientWidth + 1 || nm.scrollWidth > nm.clientWidth + 1 || (!!cta && cta.scrollWidth > cta.clientWidth + 1) || lines(nm) > 2.1;
    const clash = () => {
      const b = R(bar), m = b.width * 0.03, pic = cell ? R(cell) : null;
      const img = lg && lg.querySelector("img");
      const boxes = /** @type {[string, DOMRect|null][]} */ ([["logo", lg ? (img ? R(img) : ink(lg)) : null], ["name", ink(nm)], ["line", ln && ln.isConnected ? ink(ln) : null], ["button", cta ? R(cta) : null]]).filter((x) => x[1] && x[1].width > 0);
      const inside = (/** @type {DOMRect} */ r) => r.left >= b.left + m - 0.5 && r.right <= b.right - m + 0.5 && r.top >= b.top + m - 0.5 && r.bottom <= b.bottom - m + 0.5;
      const hit = (/** @type {DOMRect} */ a, /** @type {DOMRect} */ c) => Math.min(a.right, c.right) - Math.max(a.left, c.left) > 0.5 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 0.5;
      for (let i = 0; i < boxes.length; i++) {
        const [k, r] = /** @type {[string, DOMRect]} */ (boxes[i]);
        if (!inside(r)) return `the ${k} is outside the safe margin`;
        if (pic && hit(r, pic)) return `the ${k} overlaps the photo`;
        for (let j = i + 1; j < boxes.length; j++) if (hit(r, /** @type {DOMRect} */ (boxes[j][1]))) return `the ${k} overlaps the ${boxes[j][0]}`;
      }
      return "";
    };
    const bad = () => over() || !!clash();
    for (let f = size(nm); over() && f > Math.max(2.6, px10); f -= 0.2) set("--vfs", Math.max(f - 0.2, px10));
    if (lg) for (let k = 0.95; clash() && k >= 0.5; k -= 0.05) lg.style.scale = k.toFixed(2);   // smaller, never cut or stretched
    if (ln && bad()) { for (let f = size(ln); bad() && f > Math.max(1.7, px10); f -= 0.1) set("--vfl", Math.max(f - 0.1, px10)); if (bad()) ln.remove(); }
    if (cta) for (let f = size(cta); bad() && f > Math.max(1.4, px10); f -= 0.1) set("--vfc", Math.max(f - 0.1, px10));
    if (cta && bad()) {   // a button wider than its column: its words wrap inside the button (never cut), and the name makes room
      Object.assign(cta.style, { whiteSpace: "normal", maxWidth: "100%", textAlign: "center", lineHeight: "1.15" });
      for (let f = size(nm); bad() && f > px10; f -= 0.2) set("--vfs", Math.max(f - 0.2, px10));
    }
    if (bad()) fails.push(clash() || "the copy does not fit its column");
  }
  host.dataset.voxFit = fails.length ? "fail: " + fails.join("; ") : "ok";
}

// Runs inside the page while the unit is recorded (self-contained): the boxes of the bar on screen (the takeover while it
// is shown, else the stripe once it is fully up), in the shape qa.geometryIssues reads. null while a part is moving.
export function voxGeom(host) {
  const root = host && host.shadowRoot; if (!root) return null;
  const vf = /** @type {HTMLElement|null} */ (root.querySelector(".vf")), vs = /** @type {HTMLElement|null} */ (root.querySelector(".vs"));
  const op = (/** @type {Element} */ el) => parseFloat(getComputedStyle(el).opacity);
  const bar = vf && op(vf) > 0.95 ? vf : vs; if (!bar) return null;
  const tx = bar.querySelector(".vtx"); if (!tx || op(tx) < 0.95) return null;
  if (bar === vs) { const t = getComputedStyle(vs).transform; if (t && t !== "none" && Math.abs(new DOMMatrix(t).f) > 1) return null; }
  const R = (/** @type {Element} */ el) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const ink = (/** @type {Element} */ el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return b.width ? { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } : R(el); };
  const t = (/** @type {string} */ k, /** @type {Element|null} */ el, box = ink) => { if (!el) return null; const cs = getComputedStyle(el); return { k, text: (el.textContent || "").trim(), ...box(el), fs: parseFloat(cs.fontSize), color: cs.color }; };
  const lg = bar.querySelector(":scope > .vlg"), img = lg && lg.querySelector("img"), cell = bar.querySelector(":scope > .vph");
  // the product on screen: the drawn picture when contained, the AI's product box when cover-filled
  const shown = (/** @type {Element} */ c) => {
    const im = /** @type {HTMLImageElement|null} */ (c.querySelector("img")); if (!im || !im.naturalWidth) return null;
    const b = im.getBoundingClientRect(), cs = getComputedStyle(im), iw = im.naturalWidth, ih = im.naturalHeight;
    const cover = cs.objectFit === "cover", s = cover ? Math.max(b.width / iw, b.height / ih) : Math.min(b.width / iw, b.height / ih);
    const DW = iw * s, DH = ih * s, [ox, oy] = (cs.objectPosition || "50% 50%").split(" ").map((v) => (parseFloat(v) || 0) / 100);
    const x0 = b.x + (b.width - DW) * ox, y0 = b.y + (b.height - DH) * oy;
    const k = cover ? String(im.dataset.box || "").split(",").map(Number) : [0, 0, 100, 100];
    if (k.length !== 4 || !k.every(Number.isFinite)) return { x: +x0.toFixed(1), y: +y0.toFixed(1), w: +DW.toFixed(1), h: +DH.toFixed(1) };   // a cover with no box: the whole frame (so a crop is caught)
    return { x: +(x0 + k[0] / 100 * DW).toFixed(1), y: +(y0 + k[1] / 100 * DH).toFixed(1), w: +(k[2] / 100 * DW).toFixed(1), h: +(k[3] / 100 * DH).toFixed(1) };
  };
  return { kind: "vox", bar: bar === vf ? "full" : "stripe", card: R(bar), view: { w: innerWidth, h: innerHeight }, panelColour: "#ffffff", fit: host.dataset.voxFit || "",
    texts: [t("headline", tx.querySelector(".vnm")), t("subline", tx.querySelector(".vln")), t("cta", tx.querySelector(".vcta"), R)].filter(Boolean),
    logo: lg ? (img ? R(img) : ink(lg)) : null, picture: cell ? R(cell) : null, productBox: cell ? shown(cell) : null };
}
