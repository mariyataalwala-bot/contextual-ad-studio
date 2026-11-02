// MediaKart creative quality checks — run on every 2-in-1 and In-Image video before it is approved. The ten checks of the
// creative guidelines: (1) face / character obstruction, (2) text over text, (3) text over a subject or the original ad,
// (4) logo / product obstruction, (5) frame boundary and safe margins, (6) spelling and brand names, (7) logo and product
// consistency, (8) claims and brand safety, (9) transition and audio continuity, (10) playback and rendering.
//
// Deterministic checks (geometry measured in the page, claim and spelling rules, ffmpeg black / freeze / decode / spec
// checks over the WHOLE file) are combined with an AI look at frames sampled across the video, with extra frames around the
// transition and where text appears. A critical or major issue — or a check that could not run — means the video is NOT
// approved automatically: the report names the timestamp, what is wrong and how to fix it. Nothing is silently accepted.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withTimeout } from "./reader.mjs";

const pexec = promisify(execFile);
export const QA_VERSION = "qa.v1";

export const CHECKS = [
  ["face_obstruction", "Faces and characters stay visible"], ["text_overlap", "Text never overlaps text"], ["text_subject_overlap", "Text never covers a subject or the original ad"],
  ["logo_product_obstruction", "Logo and product are never obstructed"], ["safe_margins", "Text stays inside the frame and safe margins"], ["spelling_brand", "Spelling and brand names are correct"],
  ["consistency", "Logo and product match the originals"], ["claims_safety", "Claims are supported and the context is brand-safe"], ["transition_audio", "Transition and audio are clean"], ["playback", "The file plays from beginning to end"],
];
const TYPE_TO_CHECK = { face_obstructed: "face_obstruction", subject_cropped: "face_obstruction", text_overlap: "text_overlap", text_clipped: "text_overlap", unreadable_text: "text_overlap", crowded: "text_overlap",
  text_over_subject: "text_subject_overlap", overlay_on_original_ad: "text_subject_overlap", platform_ui_over_ad: "text_subject_overlap", logo_obstructed: "logo_product_obstruction", product_obstructed: "logo_product_obstruction",
  misspelling: "spelling_brand", unexpected_text: "spelling_brand", distorted_logo: "consistency", duplicate_product: "consistency", other: "text_overlap" };
const TYPES = Object.keys(TYPE_TO_CHECK);

const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9₹%+#.]+/g, " ").trim();
const words = (s) => norm(s).split(" ").map((w) => w.replace(/^\.+|\.+$/g, "")).filter(Boolean);   // “running.” is the word “running”
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.round((t % 1) * 10)}`;
export const stamp = (t) => (t == null ? "whole video" : mmss(t));
const lev = (a, b) => { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let p = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; };

/** @typedef {{ check: string, severity: "critical"|"major"|"minor", t: number|null, what: string, fix: string, source: string, also?: (number|null)[] }} Issue */
const issue = (check, severity, t, what, fix, source) => /** @type {Issue} */ ({ check, severity, t, what, fix, source });

// ---------- which moments to look at ----------
/**
 * Moments to inspect: evenly across the video, plus extra ones around the given moments (a transition, text appearing),
 * plus just before the end. Thinned to at most `max`, keeping the extra ones.
 * @param {number} duration @param {{ extra?: number[], every?: number, max?: number }} [o]
 */
export function sampleTimes(duration, { extra = [], every = 2.5, max = 12 } = {}) {
  const must = [...extra.flatMap((t) => [t, t + 0.6]), Math.max(0, duration - 0.6)].filter((t) => t >= 0 && t < duration);
  const even = []; for (let t = 0.6; t < duration; t += every) even.push(t);
  const pick = (/** @type {number[]} */ list, /** @type {number[]} */ out) => { for (const t of list) if (out.length < max && !out.some((x) => Math.abs(x - t) < 0.5)) out.push(t); return out; };
  return pick(even, pick(must, [])).map((t) => +t.toFixed(2)).sort((a, b) => a - b);
}

// ---------- claims (guideline 2 and 6) ----------
const CLAIM_RULES = /** @type {[RegExp, "critical"|"major", string][]} */ ([
  [/(₹|\brs\.?|\binr\b|\$)\s?\d|\d\s?%|\b(off|discounts?|cashback|free|freebies?|bogo|coupons?|offers?|deals?|sale|save|savings?)\b/i, "critical", "a price, discount or offer that nobody supplied"],
  [/\b(guarantee[sd]?|risk[- ]free|cures?d?|clinically|proven|award[- ]winning|#1|no\.? ?1|number one|unbeatable)\b/i, "critical", "an unsupported claim"],
  [/\b(best|cheapest|lowest|fastest|greatest|leading|top[- ]rated|most (popular|trusted|loved))\b/i, "major", "a superlative"],
  [/\b(hurry|limited (time|period|stock|offer)|last chance|today only|only today|act now|act fast|don'?t miss|while stocks? last|ends (soon|today)|now or never|before it'?s gone)\b/i, "major", "deceptive urgency"],
  [/\b(customers? (love|say)|testimonials?|trusted by|rated|reviews?)\b/i, "major", "a testimonial or endorsement that was not supplied"],
]);
/**
 * Claims in the text MediaKart wrote. A number is fine only when it appears in what was supplied (the product's own name,
 * the ad's title …): "Redmi Note 17" is, "20% off" is not.
 * @param {{ where: string, text: string }[]} texts @param {{ allowed?: string, supplied?: string[] }} [o] @returns {Issue[]}
 */
export function claimIssues(texts, { allowed = "", supplied = [] } = {}) {
  const ok = new Set(words(allowed)), out = /** @type {Issue[]} */ ([]), mine = supplied.map(norm).filter(Boolean);
  for (const { where, text } of texts) {
    if (!String(text || "").trim()) continue;
    if (mine.some((s) => norm(text).includes(s) || s.includes(norm(text)))) continue;   // the client's or user's own words
    for (const [re, sev, what] of CLAIM_RULES) {
      const m = re.exec(text); if (!m) continue;
      if (/^\d|₹|rs|%/.test(m[0]) && words(m[0]).every((w) => ok.has(w))) continue;
      out.push(issue("claims_safety", sev, null, `${where}: “${text}” contains ${what} (“${m[0].trim()}”)`, `Remove “${m[0].trim()}” — only claims, prices and offers the client supplied may appear.`, "claims"));
    }
    for (const w of words(text)) if (/\d/.test(w) && !ok.has(w) && !CLAIM_RULES.some(([re]) => re.test(text))) out.push(issue("claims_safety", "major", null, `${where}: “${text}” contains the number “${w}” that is not in anything supplied`, `Remove “${w}” or have the client supply it.`, "claims"));
  }
  return out;
}

// ---------- spelling and brand names (guideline 2 and 3) ----------
/** @param {{ where: string, text: string }[]} texts @param {{ brandNames?: string[], productNames?: string[] }} [o] @returns {Issue[]} */
export function textIssues(texts, { brandNames = [], productNames = [] } = {}) {
  const out = /** @type {Issue[]} */ ([]), names = [...new Set([...brandNames, ...productNames].flatMap(words).filter((w) => w.length >= 4))];
  for (const { where, text } of texts) {
    const t = String(text || "").trim(); if (!t) continue;
    const ws = words(t);
    for (let i = 0; i < ws.length; i++) {
      if (ws[i] === ws[i + 1] && /[a-z]{3,}/.test(ws[i])) out.push(issue("spelling_brand", "major", null, `${where}: the word “${ws[i]}” is repeated in “${t}”`, "Remove the repeated word.", "text"));
      if (ws[i].length >= 4 && !names.includes(ws[i])) for (const n of names) if (lev(ws[i], n) === 1 && n.length >= 5) out.push(issue("spelling_brand", "major", null, `${where}: “${ws[i]}” looks like a misspelling of “${n}” in “${t}”`, `Write “${n}” exactly as the brand spells it.`, "text"));
    }
    if (/^[\s\-–—:,;&|+/]|[\s\-–—:,;&|+/]$/.test(t) || /\b(and|with|for|the|a|an|of|to|in|on|at|by|your)$/i.test(t)) out.push(issue("spelling_brand", "major", null, `${where}: “${t}” starts or ends in the middle of a phrase`, "Finish or shorten the line so it ends on a complete word.", "text"));
    if ((t.match(/["“”]/g) || []).length % 2) out.push(issue("spelling_brand", "minor", null, `${where}: “${t}” has an unmatched quotation mark`, "Close or remove the quotation mark.", "text"));
  }
  return out;
}

// ---------- layout measured in the page (2-in-1) ----------
const rgb = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c || ""); return m ? [+m[1], +m[2], +m[3]] : null; };
const hexRgb = (h) => (/^#[0-9a-f]{6}$/i.test(h || "") ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
const relLum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const inter = (a, b) => (a && b ? Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) : 0);
const label = (k) => (k === "close" ? "the Close button" : k === "tag" ? "the Advertisement label" : k.startsWith("headline") ? "the headline" : k.startsWith("chip") ? "a chip" : k === "logo-word" ? "the brand name" : k);

/**
 * Text-to-text, text-to-picture, logo / product obstruction, safe margins, legibility and the advertising label, from the
 * boxes the page reports (see unitParts → geom). `samples` = [{ t, geom }] taken while the unit is on screen.
 * @param {{ t: number, geom: any }[]} samples @returns {Issue[]}
 */
/**
 * The product animation, judged from the page measurements: at every sample the product is on screen inside the card
 * (critical, with the timestamp), and across the samples it moves (major — a still picture is not an animation).
 * @param {{ t: number, geom: any }[]} samples
 */
export function productIssues(samples) {
  const out = /** @type {Issue[]} */ ([]);
  const live = samples.filter((x) => x.geom);
  for (const { t, geom: g } of live) {
    const p = g.product, c = g.card;
    if (!p || p.w < 8 || p.h < 8) out.push(issue("logo_product_obstruction", "critical", t, "The product is not on screen", "Check the product picture and the panel layout.", "geometry"));
    else if (c && (p.x < c.x - 1 || p.x + p.w > c.x + c.w + 1 || p.y < c.y - 1 || p.y + p.h > c.y + c.h + 1)) out.push(issue("logo_product_obstruction", "critical", t, "The product is cut off by the edge of the ad", "Keep the whole product inside the ad.", "geometry"));
  }
  const ys = live.map((x) => x.geom.product).filter(Boolean).map((p) => Math.round((p.y + p.h / 2) * 20) / 20);
  if (ys.length >= 3 && ys.every((y) => y === ys[0]) && !out.length) out.push(issue("consistency", "major", live[0].t, "The product does not move: it is a still picture, not an animation", "The product must spin in and float; check the animation CSS.", "geometry"));
  return out;
}

export function geometryIssues(samples) {
  const out = /** @type {Issue[]} */ ([]), seen = new Set();
  const add = (/** @type {Issue} */ i) => { const k = i.check + i.what; if (!seen.has(k)) { seen.add(k); out.push(i); } };
  for (const { t, geom: g } of samples) {
    if (!g?.card) continue;
    const m = g.card.w * 0.03;   // safe margin: 3% of the card's width
    const texts = (g.texts || []).filter((x) => x.k !== "close" && x.k !== "tag");
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j]; if (a.k.startsWith("headline") && b.k.startsWith("headline")) continue;
      if (inter(a, b) > 2) add(issue("text_overlap", "critical", t, `${label(a.k)} (“${a.text}”) overlaps ${label(b.k)} (“${b.text}”)`, "Shorten the copy or reduce its size so the lines never touch.", "geometry"));
    }
    for (const x of g.texts || []) {
      const over = (/** @type {any} */ r, /** @type {string} */ what) => { if (r && inter(x, r) > 2 && x.k !== "tag" && x.k !== "close") add(issue(what === "the picture" ? "text_subject_overlap" : "text_subject_overlap", "critical", t, `${label(x.k)} (“${x.text}”) is over ${what}`, `Move the words out of ${what}; text may only sit in its own row.`, "geometry")); };
      over(g.picture, "the picture"); over(g.video, "the original video ad");
      if (inter(x, g.logo) > 2) add(issue("logo_product_obstruction", "critical", t, `${label(x.k)} covers the logo`, "Keep a clear space around the logo.", "geometry"));
      if (inter(x, g.product) > 2) add(issue("logo_product_obstruction", "critical", t, `${label(x.k)} covers the product`, "Keep a clear space around the product.", "geometry"));
      const inCard = x.k !== "tag" && x.k !== "close";
      const box = inCard ? { x: g.card.x + m, y: g.card.y + m, w: g.card.w - 2 * m, h: g.card.h - 2 * m } : { x: 0, y: 0, w: g.view.w, h: g.view.h };
      if (x.x < box.x - 0.5 || x.y < box.y - 0.5 || x.x + x.w > box.x + box.w + 0.5 || x.y + x.h > box.y + box.h + 0.5) add(issue("safe_margins", inCard && (x.x < g.card.x || x.x + x.w > g.card.x + g.card.w) ? "critical" : "major", t, `${label(x.k)} (“${x.text}”) is outside the safe margin`, "Shorten the line or reduce its size so it stays inside the margin.", "geometry"));
      if (x.fs < 10) add(issue("text_overlap", "major", t, `${label(x.k)} is set at ${x.fs}px — too small to read on a phone`, "Raise the type size to at least 10px (phone width).", "geometry"));
    }
    const bg = hexRgb(g.panelColour);
    if (bg) for (const x of texts.filter((y) => ["subline", "logo-word"].includes(y.k) || y.k.startsWith("headline"))) {
      const c = rgb(x.color); if (c && ratio(c, bg) < (x.k.startsWith("headline") ? 3 : 4.5)) add(issue("text_overlap", "major", t, `${label(x.k)} has weak contrast against the panel (${ratio(c, bg).toFixed(1)}:1)`, "Use the opposite ink colour for the panel.", "geometry"));
    }
    if (g.ad === false) add(issue("claims_safety", "major", t, "The unit is not labelled “Advertisement”", "Show the “Advertisement” label above the unit.", "geometry"));
  }
  return out;
}

// ---------- the file itself (the whole video, not samples) ----------
/** @param {string} stderr @returns {{ start: number, end: number }[]} */
export function parseBlack(stderr) { return [...String(stderr).matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({ start: +m[1], end: +m[2] })); }
/** @param {string} stderr @returns {{ start: number, end: number }[]} */
export function parseFreeze(stderr) { const s = [...String(stderr).matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => +m[1]), e = [...String(stderr).matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => +m[1]); return s.map((start, i) => ({ start, end: e[i] ?? Infinity })); }

/** @param {any} probe ffprobe JSON @param {{ width?: number, height?: number, minSeconds?: number }} expected @returns {Issue[]} */
export function specIssues(probe, { width, height, minSeconds = 0 }) {
  const v = (probe.streams || []).find((s) => s.codec_type === "video"), out = /** @type {Issue[]} */ ([]);
  if (!v) return [issue("playback", "critical", null, "The file has no video picture", "Render the video again.", "video")];
  if (width && height && (v.width !== width || v.height !== height)) out.push(issue("playback", "critical", null, `The video is ${v.width}×${v.height}, expected ${width}×${height}`, `Render at ${width}×${height} so the aspect ratio and resolution are kept.`, "video"));
  const [n, d] = String(v.r_frame_rate || "0/1").split("/").map(Number), fps = d ? n / d : 0;
  if (fps < 23 || fps > 31) out.push(issue("playback", "major", null, `The frame rate is ${fps.toFixed(1)} fps`, "Render at 25 fps.", "video"));
  if (v.codec_name !== "h264" || !/^yuvj?420p$/.test(v.pix_fmt || "")) out.push(issue("playback", "major", null, `The video is ${v.codec_name}/${v.pix_fmt}, which does not play everywhere`, "Export as H.264 with yuv420p.", "video"));
  else if (v.pix_fmt === "yuvj420p") out.push(issue("playback", "minor", null, "The video uses full-range colour (yuvj420p); a few players show it washed out", "Export with limited-range yuv420p.", "video"));
  const dur = +(probe.format?.duration || v.duration || 0);
  if (dur < minSeconds) out.push(issue("playback", "critical", null, `The video is ${dur.toFixed(1)} s long, expected at least ${minSeconds.toFixed(1)} s`, "The recording stopped early — render it again.", "video"));
  return out;
}

const run = async (cmd, args) => { try { const r = await pexec(cmd, args, { maxBuffer: 64e6, timeout: 180000 }); return { ok: true, stdout: r.stdout, stderr: r.stderr }; } catch (e) { return { ok: false, stdout: e.stdout || "", stderr: e.stderr || String(e.message) }; } };

/** Decodes every frame (errors mean a damaged or incomplete file) and runs the black / freeze detectors over the whole video. */
export async function videoChecks(file, { region = null, introSeconds = 0 } = {}) {
  const probeR = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  let probe = null; try { probe = JSON.parse(probeR.stdout); } catch { /* unreadable */ }
  const dec = await run("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
  const blackR = await run("ffmpeg", ["-hide_banner", "-i", file, "-vf", "blackdetect=d=0.4:pix_th=0.1", "-an", "-f", "null", "-"]);
  /** @type {{ start: number, end: number }[]} */ let stripBlack = [], stripFreeze = /** @type {{ start: number, end: number }[]} */ ([]);
  if (region) {
    const crop = `crop=${region.w}:${region.h}:${region.x}:${region.y}`;
    stripBlack = parseBlack((await run("ffmpeg", ["-hide_banner", "-i", file, "-vf", `${crop},blackdetect=d=2.5:pix_th=0.08`, "-an", "-f", "null", "-"])).stderr);
    stripFreeze = parseFreeze((await run("ffmpeg", ["-hide_banner", "-i", file, "-vf", `${crop},freezedetect=n=0.003:d=4`, "-an", "-f", "null", "-"])).stderr);
  }
  const hasAudio = !!probe?.streams?.some((s) => s.codec_type === "audio");
  return { probe, decodeErrors: dec.ok ? dec.stderr.trim().split("\n").filter(Boolean).slice(0, 5) : ["could not decode the file: " + dec.stderr.slice(0, 160)], black: parseBlack(blackR.stderr), stripBlack, stripFreeze, hasAudio, introSeconds };
}

/** @returns {Promise<{ t: number, file: string }[]>} */
export async function extractFrames(file, times, dir, width = 540) {
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const [i, t] of times.entries()) {
    const f = path.join(dir, `qa_${String(i + 1).padStart(2, "0")}.jpg`);
    const r = await run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3", f]);
    if (r.ok && fs.existsSync(f)) out.push({ t, file: f });
  }
  return out;
}

// ---------- the AI's look at sampled frames ----------
const REVIEW_SCHEMA = { type: "object", additionalProperties: false, required: ["frames", "logo_consistent", "logo_note", "product_consistent", "product_note", "labelled_as_ad", "labelled_note"], properties: {
  frames: { type: "array", items: { type: "object", additionalProperties: false, required: ["k", "texts_read", "issues"], properties: { k: { type: "integer" }, texts_read: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "severity", "what", "fix"], properties: { type: { type: "string", enum: TYPES }, severity: { type: "string", enum: ["critical", "major", "minor"] }, what: { type: "string" }, fix: { type: "string" } } } } } } },
  logo_consistent: { type: "boolean" }, logo_note: { type: "string" }, product_consistent: { type: "boolean" }, product_note: { type: "string" }, labelled_as_ad: { type: "boolean" }, labelled_note: { type: "string" } } };

/**
 * One vision call over the sampled frames. The brand's own original video ad is judged only as "is anything MediaKart added
 * covering it"; its own on-screen text and graphics are never criticised.
 * @param {{ ask: Function, frames: { t: number, file: string }[], refs?: { logo?: string|null, product?: string|null }, kind: string, brand: string, product: string, expected: string[], notes?: string, settleAt?: number }} o
 */
export async function reviewFrames({ ask, frames, settleAt = 0, refs = {}, kind, brand, product, expected, notes = "" }) {
  const images = [...(refs.logo ? [{ label: `REFERENCE LOGO — the brand's real logo file (${brand})`, file: refs.logo }] : []), ...(refs.product ? [{ label: `REFERENCE PRODUCT — the checked product picture (${product})`, file: refs.product }] : []),
    ...frames.map((f, i) => ({ label: `Frame ${i + 1} at ${stamp(f.t)}${f.t < settleAt ? " — the words are still animating into place: judge faces, subjects and the original ad only, NOT the spelling, cropping or position of text" : ""}`, file: f.file }))];
  const ans = await ask("You are the quality-control reviewer of a digital ad studio. You inspect frames of a finished video ad and judge only what you can see. You never invent problems and never miss a real one.",
    `Brand: ${brand}. Product: ${product}. Video type: ${kind === "2in1" ? "a 2-in-1 unit (the brand's own 16:9 video ad on top, a MediaKart-made product panel below, shown over a news article)" : "an in-image ad (a MediaKart-made unit placed over a news article's photo)"}.\n` +
    `The ONLY text MediaKart added is: ${expected.map((t) => `“${t}”`).join(", ") || "(none)"}, plus an “Advertisement” label and a Close button. ${notes}\n` +
    `The brand's own original video and the article page are NOT yours to judge — ignore their text and graphics. YouTube's own player bar or title over the original ad is platform UI: report it as platform_ui_over_ad, severity minor.\n` +
    `For EVERY frame (k = 1…${frames.length}) list issues of these kinds only: face_obstructed (any MediaKart text, logo, graphic, glow or banner over a person's or character's face or body), subject_cropped (a person cut off badly), text_overlap (MediaKart text over other text or a logo), ` +
    `text_over_subject (MediaKart text over a person, product or the key action), overlay_on_original_ad (MediaKart graphics or text over the original video ad), logo_obstructed, product_obstructed, text_clipped (cut off or running outside the frame), unreadable_text (too small or low contrast for a phone), ` +
    `crowded (too much text or too many competing focal points), misspelling (a word spelled wrongly or garbled), unexpected_text (MediaKart text not in the list above), distorted_logo, duplicate_product. ` +
    `severity: critical = a face, subject, logo, product or the original ad is covered, or text overlaps text; major = clipped, unreadable, misspelled or garbled text, distorted logo; minor = anything small. what: one specific sentence; fix: one concrete correction. ` +
    `texts_read: every piece of MediaKart-added text you can read in that frame, exactly as written. ` +
    `Also answer: logo_consistent (does the logo shown match the REFERENCE LOGO — same shape, colours, proportions, not distorted or recoloured; true if no reference or no logo is shown) with logo_note; product_consistent (same for the REFERENCE PRODUCT: no changed shape, packaging or label, no duplicate or invented accessories) with product_note; labelled_as_ad (is the unit clearly distinguishable as advertising, e.g. an “Advertisement” label) with labelled_note.`,
    REVIEW_SCHEMA, images, "medium");
  return ans;
}

// ---------- the whole run ----------
/**
 * @param {{ file: string, kind: "2in1"|"inimage", ask: Function, workDir: string, brand: string, product: string, brandNames?: string[], productNames?: string[],
 *   texts?: { where: string, text: string }[], allowedSource?: string, expected?: { width?: number, height?: number, minSeconds?: number },
 *   geometry?: { t: number, geom: any }[]|null, transitions?: number[], settleAt?: number, region?: { x: number, y: number, w: number, h: number }|null, introSeconds?: number,
 *   refs?: { logo?: string|null, product?: string|null }, safety?: { status?: string, reasons?: string[], note?: string }|null, supplied?: string[], notes?: string[], reviewNotes?: string, frames?: number, aiTimeoutMs?: number }} o
 */
export async function runQa(o) {
  const t0 = Date.now(), issues = /** @type {Issue[]} */ ([]), unchecked = /** @type {Record<string, string>} */ ({}), notes = [...(o.notes || [])];
  const dir = path.join(o.workDir, "qa");
  const vc = await videoChecks(o.file, { region: o.region || null, introSeconds: o.introSeconds || 0 });
  const dur = +(vc.probe?.format?.duration || 0);
  // 10 playback + render
  issues.push(...specIssues(vc.probe || { streams: [] }, o.expected || {}));
  if (vc.decodeErrors.length) issues.push(issue("playback", "critical", null, `The file has decoding errors: ${vc.decodeErrors[0]}`, "Render the video again; do not publish a damaged file.", "video"));
  // 9 transition + audio
  const around = (o.transitions || []).map((t) => [t - 0.3, t + 0.9]);
  for (const b of vc.black) if (around.some(([a, z]) => b.start < z && b.end > a)) issues.push(issue("transition_audio", "major", b.start, `A black frame appears at the transition (${stamp(b.start)}–${stamp(b.end)})`, "Cut straight to the next scene or fade through the brand colour, never through black.", "video"));
  for (const b of vc.stripBlack) if (b.end > (o.introSeconds || 0) + 1 && b.start < dur - 4) issues.push(issue("playback", "critical", b.start, `The original ad area is black from ${stamp(b.start)} to ${stamp(b.end)} — the video did not play`, "Check the video's availability and embedding, then render again.", "video"));
  for (const f of vc.stripFreeze) if (f.start > (o.introSeconds || 0) + 1 && f.start < dur - 5) issues.push(issue("playback", "critical", f.start, `The original ad area is frozen from ${stamp(f.start)}`, "The video stalled — render again.", "video"));
  if (!vc.hasAudio) notes.push("The recording is silent by design (ads are shown muted); the original ad's audio, music and dialogue are not part of this file.");
  // 8 claims + brand safety
  issues.push(...claimIssues(o.texts || [], { allowed: o.allowedSource || "", supplied: o.supplied || [] }));
  if (o.safety && o.safety.status && o.safety.status !== "safe") issues.push(issue("claims_safety", "critical", null, `The article is not a brand-safe place for this ad: ${o.safety.reasons?.join(", ") || o.safety.status}`, "Choose another article.", "safety"));
  if (o.safety?.note) notes.push(o.safety.note);
  // 6 spelling + brand names
  issues.push(...textIssues(o.texts || [], { brandNames: o.brandNames, productNames: o.productNames }));
  // 2–5 layout measured in the page
  if (o.geometry?.length) issues.push(...geometryIssues(o.geometry));
  if (o.expectProduct && o.geometry?.length) issues.push(...productIssues(o.geometry));   // a video without page measurements (In-Image) is judged by eye, from its frames (below)
  // 1–4, 6, 7 the AI's look at the frames
  let frames = /** @type {{ t: number, file: string }[]} */ ([]), review = null, aiError = "";
  try {
    const times = sampleTimes(dur || 10, { extra: o.transitions || [], max: o.frames || 12 });
    frames = await extractFrames(o.file, times, dir);
    if (!frames.length) throw new Error("no frames could be read from the video");
    review = await withTimeout(reviewFrames({ ask: o.ask, frames, settleAt: o.settleAt || 0, refs: o.refs, kind: o.kind, brand: o.brand, product: o.product, expected: [...new Set((o.texts || []).map((x) => x.text).filter(Boolean))], notes: o.reviewNotes || "" }), o.aiTimeoutMs || 90000, "The frame review");
  } catch (e) { aiError = String(e.message).slice(0, 160); }
  if (review) {
    const expectedWords = new Set((o.texts || []).flatMap((x) => words(x.text)).concat(words(`${o.brand} ${o.product}`), ["advertisement", "close", "mock", "preview", "watch", "ad"]));
    for (const f of review.frames || []) {
      const fr = frames[f.k - 1]; if (!fr) continue;
      const animating = fr.t < (o.settleAt || 0);   // text still arriving: only faces, subjects and the original ad are judged
      for (const i of f.issues || []) if (!(animating && ["text_clipped", "unreadable_text", "misspelling", "unexpected_text", "text_overlap", "crowded", "other"].includes(i.type))) issues.push(issue(TYPE_TO_CHECK[i.type] || "text_overlap", i.type === "platform_ui_over_ad" ? "minor" : i.severity, fr.t, i.what, i.fix, "frames"));
      // text read from a frame: a word that is not in the approved copy but is one slip away from a word that is, is a misspelling (a swapped pair of letters counts)
      const closeTo = (/** @type {string} */ w, /** @type {string} */ e) => w !== e && ((w.length >= 5 && lev(w, e) <= 2) || lev(w, e) <= 1 || (w.length === e.length && [...w].sort().join("") === [...e].sort().join("")));
      if (!animating) for (const tx of f.texts_read || []) for (const w of words(tx).filter((x) => x.length >= 3 && !expectedWords.has(x))) {
        const e = [...expectedWords].filter((x) => x.length >= 3 && closeTo(w, x)).sort((a, b) => lev(w, a) - lev(w, b))[0];
        if (e) issues.push(issue("spelling_brand", "major", fr.t, `The text reads “${w}” — expected “${e}”`, `Correct the spelling to “${e}”.`, "frames"));
      }
    }
    if (review.logo_consistent === false) issues.push(issue("consistency", "major", null, `The logo differs from the original: ${review.logo_note}`, "Use the supplied logo file unchanged — no recolouring, stretching or redrawing.", "frames"));
    if (review.product_consistent === false) issues.push(issue("consistency", "major", null, `The product differs from the original: ${review.product_note}`, "Use the checked product picture exactly as it is.", "frames"));
    if (review.labelled_as_ad === false) issues.push(issue("claims_safety", "minor", null, `The unit may not be clearly marked as advertising: ${review.labelled_note}`, "Add an “Advertisement” label.", "frames"));
  } else for (const id of ["face_obstruction", "text_overlap", "text_subject_overlap", "logo_product_obstruction", "spelling_brand", "consistency"]) unchecked[id] = `the frame review could not run (${aiError})`;
  // the report — the same finding at several moments is one issue that lists them all
  const rank = { critical: 0, major: 1, minor: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.t ?? -1) - (b.t ?? -1));
  /** @type {Issue[]} */ const merged = [];
  for (const i of issues) { const same = merged.find((m) => m.check === i.check && m.what === i.what && m.severity === i.severity); if (same) { (same.also ||= []).push(i.t); } else merged.push({ ...i }); }
  issues.length = 0; issues.push(...merged);
  const checks = CHECKS.map(([id, name]) => {
    const mine = issues.filter((i) => i.check === id), bad = mine.some((i) => i.severity !== "minor");
    const status = bad ? "fail" : unchecked[id] ? "unchecked" : mine.length ? "warn" : "pass";
    return { id, name, status, ...(unchecked[id] ? { reason: unchecked[id] } : {}), issues: mine };
  });
  const blocked = checks.some((c) => c.status === "fail" || c.status === "unchecked");
  const status = checks.some((c) => c.status === "fail") ? "needs_fix" : blocked ? "incomplete" : "approved";
  return { version: QA_VERSION, approved: status === "approved", status, checks, issues, sampled: frames.map((f) => +f.t.toFixed(1)), notes, seconds: +((Date.now() - t0) / 1000).toFixed(1),
    summary: status === "approved" ? `Approved — ${CHECKS.length} checks passed${issues.length ? ` (${issues.length} minor note${issues.length === 1 ? "" : "s"})` : ""}.` : status === "needs_fix"
      ? `Not approved — ${issues.filter((i) => i.severity !== "minor").length} issue(s) to fix. First: ${issues[0].what} (${stamp(issues[0].t)}).` : `Not approved yet — ${Object.keys(unchecked).filter((k) => unchecked[k]).length} check(s) could not run${aiError ? ": " + aiError : ""}.` };
}
