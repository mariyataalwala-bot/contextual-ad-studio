// The campaign image for the VOX formats: a frame of the brand's own TV ad (result.recentAds — already found for the
// studio). Stills are screenshots of the YouTube player by the existing helper (pipeline/scripts/yt.js scan — nothing is
// downloaded as a file); the sharpest well-lit frame that shows the product is chosen, by one vision call when the AI is
// available, else by contrast and sharpness. A frame with burnt-in text (a caption, a super, legal copy) is never used: the
// vision call reports has_text for its pick, and a free deterministic detector (rows of dense vertical strokes in a
// bounded band) screens every frame first, and is all there is when the AI is unavailable. Only a frame the AI confirmed
// text-free may be cover-cropped (crop: true); a rules pick is shown whole. None usable → null, and the unit falls back
// to the pack cut-out, contained.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..", "..");
export const CAMPAIGN_TIMES = [2.5, 5, 8, 11, 14, 17, 21];   // a TV ad is 15–40 s; the pack shot is often near the end

/** yt.js with the app's node modules (as server.mjs runs it); resolves with its output */
export function runYt(args, { timeoutMs = 90000 } = {}) {
  return new Promise((ok, no) => {
    const p = spawn(process.execPath, [path.join(APP, "pipeline", "scripts", "yt.js"), ...args], { env: { ...process.env, NODE_PATH: path.join(APP, "node_modules") }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; p.stdout.on("data", (d) => out += d); p.stderr.on("data", (d) => err += d);
    const t = setTimeout(() => { p.kill(); no(new Error("yt.js scan timed out")); }, timeoutMs);
    p.on("error", (e) => { clearTimeout(t); no(e); });
    p.on("exit", (c) => { clearTimeout(t); c ? no(new Error(err.slice(-300) || "yt.js failed")) : ok(out); });
  });
}

/** 6–8 stills of the ad (full-resolution player screenshots) → their files */
export async function campaignFrames(videoId, dir, { yt = runYt, times = CAMPAIGN_TIMES } = {}) {
  if (!/^[\w-]{11}$/.test(String(videoId || ""))) return [];
  fs.mkdirSync(dir, { recursive: true });
  await yt(["scan", videoId, dir, ...times.map(String)]).catch(() => null);
  return fs.readdirSync(dir).filter((f) => /^f_\d+\.png$/.test(f)).sort().map((f) => path.join(dir, f));
}

/** brightness (mean), contrast (spread) and sharpness (mean gradient) of a frame, from a 96×54 grey copy */
export async function frameStats(file, ffmpeg) {
  const grey = async (/** @type {number} */ w, /** @type {number} */ h) => {
    const raw = file + `.${w}.grey`;
    await ffmpeg(["-loglevel", "error", "-y", "-i", file, "-vf", `scale=${w}:${h}:flags=area,format=gray`, "-frames:v", "1", "-f", "rawvideo", raw]);
    const px = fs.readFileSync(raw); fs.rmSync(raw, { force: true });
    return px;
  };
  const s = statsOf(await grey(96, 54), 96, 54);
  return { ...s, text: textBands(await grey(TEXT_W, TEXT_H), TEXT_W, TEXT_H) };
}
export const TEXT_W = 320, TEXT_H = 180;
/**
 * Free burnt-in text detector. Text is rows of many sharp vertical strokes: a band (3–26 rows at 180 high) where the
 * strong left-right transitions per row are dense, that stands out from the rows just above and below, and spans a
 * stretch of the width. Returns { hasText, box } (box in % of the frame) — conservative: a doubtful frame counts as text.
 */
export function textBands(px, w, h) {
  if (!px || px.length < w * h) return { hasText: false, box: null };
  const d = new Array(h).fill(0), lo = new Array(h).fill(w), hi = new Array(h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) { const i = y * w + x; if (Math.abs(px[i] - px[i + 1]) > 48) { d[y]++; if (x < lo[y]) lo[y] = x; if (x > hi[y]) hi[y] = x; } }
  const hot = d.map((v) => v / w > 0.06);
  for (let y = 0; y < h;) {
    if (!hot[y]) { y++; continue; }
    let z = y; while (z < h && hot[z]) z++;
    const len = z - y;
    if (len >= 3 && len <= 26) {
      const mean = d.slice(y, z).reduce((a, b) => a + b, 0) / len;
      const edge = (/** @type {number} */ r) => (r < 0 || r >= h ? 0 : d[r]);
      const x0 = Math.min(...lo.slice(y, z)), x1 = Math.max(...hi.slice(y, z));
      if (edge(y - 2) < mean * 0.45 && edge(z + 1) < mean * 0.45 && x1 - x0 > w * 0.12)
        return { hasText: true, box: { x: Math.round(x0 / w * 100), y: Math.round(y / h * 100), w: Math.round((x1 - x0) / w * 100), h: Math.round(len / h * 100) } };
    }
    y = z;
  }
  return { hasText: false, box: null };
}
export function statsOf(px, w, h) {
  let sum = 0; for (const v of px) sum += v;
  const mean = sum / px.length;
  let vs = 0; for (const v of px) vs += (v - mean) ** 2;
  let g = 0; for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) { const i = y * w + x; g += Math.abs(px[i] - px[i + 1]) + Math.abs(px[i] - px[i + w]); }
  return { mean, contrast: Math.sqrt(vs / px.length), sharp: g / ((w - 1) * (h - 1)) };
}
/** the rule-based score: well lit (not a black or white card; mid-tones preferred over a murky frame), then contrast × sharpness */
export const frameScore = (s) => s.mean < 45 || s.mean > 215 || s.contrast < 25 ? -1 : s.contrast * s.sharp * (1 - Math.abs(s.mean - 135) / 135) ** 2;

export const PICK_SCHEMA = { type: "object", properties: {
  pick: { type: "integer", description: "the number of the best frame, 0 if none is usable" },
  product_x: { type: "integer", description: "where the product's centre sits across that frame, 0 (left edge) to 100 (right edge)" },
  has_text: { type: "boolean", description: "true if the chosen frame shows ANY burnt-in text: a caption, super, slogan, price, URL, legal line or end-card words (text printed on the product's own pack does not count)" },
  text_box: { type: "object", description: "where that text is, in % of the frame (0 0 0 0 when has_text is false)", properties: { x: { type: "integer" }, y: { type: "integer" }, w: { type: "integer" }, h: { type: "integer" } }, required: ["x", "y", "w", "h"] },
  product_box: { type: "object", description: "the whole product (watch, pack, bottle…) in the chosen frame, in % of the frame: x, y = its top-left corner, w, h = its size", properties: { x: { type: "integer" }, y: { type: "integer" }, w: { type: "integer" }, h: { type: "integer" } }, required: ["x", "y", "w", "h"] },
  why: { type: "string" },
}, required: ["pick", "product_x", "has_text", "text_box", "product_box", "why"] };

/** a product box in % of the frame, clamped; null when missing or empty (the unit then never cover-crops the frame) */
export function cleanBox(b) {
  if (!b || typeof b !== "object") return null;
  const n = (v) => Math.max(0, Math.min(100, Math.round(+v)));
  if (![b.x, b.y, b.w, b.h].every((v) => Number.isFinite(+v))) return null;
  const x = n(b.x), y = n(b.y), w = Math.min(n(b.w), 100 - x), h = Math.min(n(b.h), 100 - y);
  return w >= 2 && h >= 2 ? { x, y, w, h } : null;
}

/**
 * The best frame: one vision call when ask is given (product visible, sharp, well lit, no large face, no on-screen
 * text), else the highest rule score. A frame with text (has_text from the AI, or the detector) is rejected. Returns
 * { file, by, focus, crop, why } or null; crop is true only when the AI confirmed the frame holds no text.
 */
export async function pickCampaignFrame(files, { ffmpeg, ask = null, brand = "", product = "" } = {}) {
  const scored = [];
  for (const f of files) { try { const s = await frameStats(f, ffmpeg); scored.push({ file: f, s, score: frameScore(s) }); } catch { /* unreadable still */ } }
  const usable = scored.filter((x) => x.score > 0 && !x.s.text?.hasText);   // burnt-in text is never used, never cropped
  if (!usable.length) return null;
  if (ask) {
    try {
      const r = await ask("You choose a still from a brand's TV ad for a premium banner. You judge only what is shown.",
        `These are stills from ${brand}'s TV ad. Pick the ONE frame that best works as the campaign photo for ${product}: the product (or its pack) clearly visible, sharp, well lit, no large human face filling the frame, no big on-screen caption or legal text, not a fade or a black/white end card. Answer 0 if none shows the product. product_x: where the product's centre is across the chosen frame (0 = left edge, 100 = right edge), so a crop keeps it. product_box: the box around the WHOLE product in that frame, in % of the frame, so a crop never cuts it. Choose ONLY a frame with no burnt-in text at all (captions, supers, slogans, URLs, legal lines, end-card words; words printed on the product's own pack are fine); has_text must say honestly whether the chosen frame shows any, and text_box where.`,
        PICK_SCHEMA, usable.map((x, i) => ({ label: `Frame ${i + 1}`, file: x.file })), "low");
      const k = Number(r?.pick);
      if (k >= 1 && k <= usable.length) {
        if (r.has_text !== false) return null;   // text in the frame (or not stated): the unit uses the contained pack cut-out
        return { file: usable[k - 1].file, by: "AI", focus: Number.isFinite(+r.product_x) ? Math.max(0, Math.min(100, +r.product_x)) : 50, box: cleanBox(r.product_box), crop: true, why: String(r.why || "").slice(0, 200) };
      }
      if (k === 0) return null;
    } catch { /* quota or no AI: the rules below */ }
  }
  const best = usable.sort((a, b) => b.score - a.score)[0];
  return { file: best.file, by: "rules", focus: 50, crop: false, why: `highest contrast × sharpness (${best.score.toFixed(0)})` };
}

/**
 * The campaign image for a run: frames of the first recent ad, the best one saved as <dir>/campaign.jpg (1280 px wide).
 * @returns {Promise<{ file: string, videoId: string, by: string, focus: number, box: {x:number,y:number,w:number,h:number}|null, crop: boolean, why: string }|null>}
 */
export async function campaignImage({ ads = [], dir, ffmpeg, ask = null, brand = "", product = "", yt = runYt }) {
  if (!ffmpeg) return null;
  for (const ad of ads.slice(0, 2)) {
    const frames = await campaignFrames(ad.id, path.join(dir, "frames_" + ad.id), { yt });
    if (frames.length < 3) continue;
    const pick = await pickCampaignFrame(frames, { ffmpeg, ask, brand, product });
    if (!pick) continue;
    const out = path.join(dir, "campaign.jpg");
    await ffmpeg(["-loglevel", "error", "-y", "-i", pick.file, "-vf", "scale='min(1280,iw)':-2", "-q:v", "2", "-frames:v", "1", out]);
    return { file: out, videoId: ad.id, by: pick.by, focus: pick.focus, box: pick.box || null, crop: pick.crop === true, why: pick.why };
  }
  return null;
}
