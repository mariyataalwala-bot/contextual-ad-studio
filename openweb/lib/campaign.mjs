// The campaign image for the VOX formats: a frame of the brand's own TV ad (result.recentAds — already found for the
// studio). Stills are screenshots of the YouTube player by the existing helper (pipeline/scripts/yt.js scan — nothing is
// downloaded as a file); the sharpest well-lit frame that shows the product is chosen, by one vision call when the AI is
// available, else by contrast and sharpness. None usable → null, and the unit falls back to the pack cut-out.
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
  const raw = file + ".grey";
  await ffmpeg(["-loglevel", "error", "-y", "-i", file, "-vf", "scale=96:54:flags=area,format=gray", "-frames:v", "1", "-f", "rawvideo", raw]);
  const px = fs.readFileSync(raw); fs.rmSync(raw, { force: true });
  return statsOf(px, 96, 54);
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
  why: { type: "string" },
}, required: ["pick", "product_x", "why"] };

/**
 * The best frame: one vision call when ask is given (product visible, sharp, well lit, no large face, no on-screen
 * text), else the highest rule score. Returns { file, by, why } or null.
 */
export async function pickCampaignFrame(files, { ffmpeg, ask = null, brand = "", product = "" } = {}) {
  const scored = [];
  for (const f of files) { try { const s = await frameStats(f, ffmpeg); scored.push({ file: f, s, score: frameScore(s) }); } catch { /* unreadable still */ } }
  const usable = scored.filter((x) => x.score > 0);
  if (!usable.length) return null;
  if (ask) {
    try {
      const r = await ask("You choose a still from a brand's TV ad for a premium banner. You judge only what is shown.",
        `These are stills from ${brand}'s TV ad. Pick the ONE frame that best works as the campaign photo for ${product}: the product (or its pack) clearly visible, sharp, well lit, no large human face filling the frame, no big on-screen caption or legal text, not a fade or a black/white end card. Answer 0 if none shows the product. product_x: where the product's centre is across the chosen frame (0 = left edge, 100 = right edge), so a crop keeps it.`,
        PICK_SCHEMA, usable.map((x, i) => ({ label: `Frame ${i + 1}`, file: x.file })), "low");
      const k = Number(r?.pick);
      if (k >= 1 && k <= usable.length) return { file: usable[k - 1].file, by: "AI", focus: Number.isFinite(+r.product_x) ? Math.max(0, Math.min(100, +r.product_x)) : 50, why: String(r.why || "").slice(0, 200) };
      if (k === 0) return null;
    } catch { /* quota or no AI: the rules below */ }
  }
  const best = usable.sort((a, b) => b.score - a.score)[0];
  return { file: best.file, by: "rules", focus: 50, why: `highest contrast × sharpness (${best.score.toFixed(0)})` };
}

/**
 * The campaign image for a run: frames of the first recent ad, the best one saved as <dir>/campaign.jpg (1280 px wide).
 * @returns {Promise<{ file: string, videoId: string, by: string, focus: number, why: string }|null>}
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
    return { file: out, videoId: ad.id, by: pick.by, focus: pick.focus, why: pick.why };
  }
  return null;
}
