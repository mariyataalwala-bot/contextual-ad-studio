// Inventory import (read-only): MediaKart's media-plan site lists, the public creative showcase feed, and the
// source creative files you put in the creatives folder. Every list keeps where it came from and its hash.
import fs from "node:fs";
import path from "node:path";
import { sha256, norm } from "./text.mjs";

export const MEDIA_PLAN_FILE = process.env.MEDIA_PLAN_FILE || "D:\\Media Plan Automation\\media_plan_data.js";
export const SHOWCASE_URL = "https://showcase.mediakart.co.in/api/data.php";
export const SHOWCASE_BASE = "https://showcase.mediakart.co.in/";

// media_plan_data.js is `window.DEFAULT_MEDIA_PLAN = {...};` — parsed as JSON, never executed.
export function parseMediaPlan(src) {
  const i = src.indexOf("{"), j = src.lastIndexOf("}");
  if (!/DEFAULT_MEDIA_PLAN\s*=/.test(src) || i < 0 || j < i) throw new Error("not a media_plan_data.js file");
  const plan = JSON.parse(src.slice(i, j + 1)), sites = [];
  for (const [tab, rows] of Object.entries(plan)) for (const row of rows) for (const [col, v] of Object.entries(row)) {
    const site = norm(v); if (!site || /^__EMPTY/.test(col)) continue;
    sites.push({ tab: norm(tab), column: norm(col), site });   // the sheet has non-breaking spaces in some headers
  }
  return { tabs: Object.keys(plan), sites };
}
// Each publisher format cites "Tab › Column: site" — confirm that cell really is in the media plan.
export function checkPublisherSources(publishers, plan) {
  return publishers.map((p) => ({ id: p.id, formats: Object.fromEntries(Object.entries(p.formats).map(([f, src]) => {
    const m = /^(.+?) › (.+?): (\S+)/.exec(src);
    return [f, !!m && plan.sites.some((s) => s.tab === norm(m[1]) && s.column.toLowerCase() === norm(m[2]).toLowerCase() && s.site.toLowerCase().includes(m[3].toLowerCase()))];
  })) }));
}
/** @returns {Record<string, any>} */
export function loadMediaPlan(file = MEDIA_PLAN_FILE) {
  if (!fs.existsSync(file)) return { ok: false, file, error: "Media plan file not found" };
  const src = fs.readFileSync(file, "utf8");
  return { ok: true, file, sha256: sha256(src), modified: fs.statSync(file).mtime.toISOString(), ...parseMediaPlan(src) };
}

export function parseShowcase(data, cfg) {
  const out = [];
  for (const p of data) {
    const inds = Object.fromEntries((p.industries || []).map((i) => [i.id, i.name]));
    for (const c of p.creativeVideos || []) out.push({
      ref: `${p.id}/${c.id}`, platform: p.name, format: cfg.formats.showcasePlatforms[p.id] || null, brand: String(c.name || "").trim(), product: String(c.subtitle || "").trim(),
      industry: (c.industryIds || []).map((i) => inds[i] || i).join(" | "), type: c.creativeType,
      preview: c.videoUrl || c.imageUrl || c.interactiveUrl ? SHOWCASE_BASE + encodeURI(c.videoUrl || c.imageUrl || c.interactiveUrl) : null,
      thumb: c.thumbnailUrl ? SHOWCASE_BASE + encodeURI(c.thumbnailUrl) : null,
      note: "Showcase preview recording; adSize is the preview frame, not a slot spec",
    });
  }
  return out;
}
// Fetch the feed and keep a dated snapshot (so later runs can say exactly which catalogue they used).
export async function refreshShowcase(store, cfg, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl(SHOWCASE_URL, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`showcase feed → HTTP ${r.status}`);
  const text = await r.text(), data = JSON.parse(text);
  const snap = { url: SHOWCASE_URL, fetchedAt: new Date().toISOString(), sha256: sha256(text), data };
  store.writeJson(store.dir("snapshots", "showcase-latest.json"), snap);
  return { fetchedAt: snap.fetchedAt, sha256: snap.sha256, creatives: parseShowcase(data, cfg).length };
}
export function loadShowcase(store, cfg) {
  const snap = store.readJson(store.dir("snapshots", "showcase-latest.json"), null);
  return snap ? { fetchedAt: snap.fetchedAt, sha256: snap.sha256, creatives: parseShowcase(snap.data, cfg) } : { fetchedAt: null, creatives: [] };
}

const MEDIA = /\.(mp4|webm|mov|png|jpe?g|gif|webp)$/i;
// Source creative files you supplied (creatives folder, any sub-folder), relative paths.
export function creativeFiles(store) {
  const root = store.dir("creatives"), out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (MEDIA.test(e.name)) out.push({ file: path.relative(root, f).split(path.sep).join("/"), bytes: fs.statSync(f).size }); } };
  walk(root);
  return out;
}
