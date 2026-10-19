// Contextual Ad Studio — local app. Type a brand, pick the ad, approve the three checks, get the MP4.
// Start with start.bat (or: node server.mjs). Opens http://localhost:4777
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

const APP = path.dirname(fileURLToPath(import.meta.url));
const PIPE = path.join(APP, "pipeline");
const IS_WIN = process.platform === "win32";
const OUT_ROOT = process.env.OUT_DIR || (IS_WIN ? "D:\\contextual-ads" : path.join(APP, "output"));
const SETTINGS = path.join(APP, "settings.json");
const PORT = +(process.env.PORT || 4777);
const HOST = process.env.PORT ? "0.0.0.0" : "127.0.0.1";   // on Render (PORT set) listen publicly
const PASSWORD = process.env.APP_PASSWORD || "";             // optional login for the hosted app
const MODEL = "claude-opus-5-5";

// ---------- environment: ffmpeg from WinGet, node modules from the app ----------
function findFfmpeg() {
  const base = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  try {
    for (const d of fs.readdirSync(base).filter((n) => n.startsWith("Gyan.FFmpeg"))) {
      for (const e of fs.readdirSync(path.join(base, d))) {
        const bin = path.join(base, d, e, "bin");
        if (fs.existsSync(path.join(bin, "ffmpeg.exe"))) return bin;
      }
    }
  } catch {}
  return null;
}
const FF = findFfmpeg();
const ENV = { ...process.env, NODE_PATH: path.join(APP, "node_modules"), PYTHONIOENCODING: "utf-8" };
if (FF) ENV.PATH = FF + path.delimiter + ENV.PATH;
const PY = IS_WIN ? "python" : "python3";

// ---------- settings / AI providers (Gemini free tier or Claude) ----------
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch { return {}; } };
const geminiKey = () => loadSettings().geminiKey || process.env.GEMINI_API_KEY;
const claudeKey = () => loadSettings().apiKey || process.env.ANTHROPIC_API_KEY;
const provider = () => { const p = loadSettings().provider || process.env.AI_PROVIDER; if (p) return p; return geminiKey() ? "gemini" : claudeKey() ? "claude" : "none"; };
const GEMINI_MODEL = () => loadSettings().geminiModel || process.env.GEMINI_MODEL || "gemini-flash-latest";
function claude() {
  const key = claudeKey();
  if (!key) throw new Error("Add your Claude API key in Settings first.");
  return new Anthropic({ apiKey: key });
}
class AIError extends Error {}
// One structured-JSON call. Images are [{label, file}] JPEG/PNG paths.
async function ask(system, text, schema, images = [], effort = "high") {
  const p = provider();
  if (p === "none") throw new AIError("No AI key set — using manual mode.");
  try { return p === "gemini" ? await askGemini(system, text, schema, images) : await askClaude(system, text, schema, images, effort); }
  catch (e) { if (e instanceof AIError) throw e; throw new AIError(e.message || String(e)); }
}
async function askGemini(system, text, schema, images) {
  const ai = new GoogleGenAI({ apiKey: geminiKey() });
  const parts = [];
  for (const im of images) {
    parts.push({ text: im.label });
    parts.push({ inlineData: { mimeType: im.file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg", data: fs.readFileSync(im.file).toString("base64") } });
  }
  parts.push({ text });
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await ai.models.generateContent({ model: GEMINI_MODEL(), contents: [{ role: "user", parts }],
        config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema } });
      return JSON.parse(r.text);
    } catch (e) {
      const msg = String(e.message || e); const busy = /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i.test(msg);
      if (busy && attempt < 3) { await sleep(15000 * (attempt + 1)); continue; }   // free tier: wait and retry
      throw new AIError(/429|RESOURCE_EXHAUSTED/.test(msg) ? "Gemini free quota used up for now — switching to manual mode." : "Gemini: " + msg.slice(0, 200));
    }
  }
}
async function askClaude(system, text, schema, images, effort) {
  const content = [];
  for (const im of images) {
    content.push({ type: "text", text: im.label });
    const media = im.file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    content.push({ type: "image", source: { type: "base64", media_type: media, data: fs.readFileSync(im.file).toString("base64") } });
  }
  content.push({ type: "text", text });
  const res = await claude().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined this step: " + (res.stop_details?.explanation || "refusal"));
  const t = res.content.find((b) => b.type === "text");
  if (!t) throw new Error("No answer from Claude (stop: " + res.stop_reason + ")");
  return JSON.parse(t.text);
}

// ---------- process helpers ----------
function run(cmd, args, { log, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: ENV, cwd: cwd || APP, windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; if (log) String(d).split(/\r?\n/).filter(Boolean).forEach(log); });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(args[0] || cmd)} failed (${code}): ${(err || out).slice(-600)}`))));
  });
}
const yt = (args, opts) => run("node", [path.join(PIPE, "scripts", "yt.js"), ...args], opts);
const ytBrowserJson = async (args) => { const s = (await yt(args)).trim(); const i = [s.indexOf("["), s.indexOf("{")].filter((x) => x >= 0); return JSON.parse(s.slice(Math.min(...i))); };

// ---------- YouTube Data API v3 (official): search + video details without a browser ----------
// Key from Google Cloud Console (APIs & Services → enable "YouTube Data API v3" → Credentials → API key).
// Free quota: 10,000 units/day; a search costs 100, video details cost 1 → roughly 80–90 searches a day.
const youtubeKey = () => loadSettings().youtubeKey || process.env.YOUTUBE_API_KEY;
let ytApiDisabledUntil = 0;   // after a quota error, use the browser until midnight Pacific time
async function ytApi(endpoint, params) {
  const url = `https://www.googleapis.com/youtube/v3/${endpoint}?` + new URLSearchParams({ ...params, key: youtubeKey() });
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) { const reason = j.error?.errors?.[0]?.reason || j.error?.status || r.status; const e = new Error(`YouTube API ${reason}: ${j.error?.message || ""}`.slice(0, 240)); e.reason = reason; throw e; }
  return j;
}
const playerSize = (v) => { const w = +v.player?.embedWidth, h = +v.player?.embedHeight; return w && h ? [w, h] : v.contentDetails.definition === "hd" ? [1280, 720] : [640, 360]; };
const aspectOf = (v) => { const [w, h] = playerSize(v); return +(w / h).toFixed(3); };
const isCTV = (r) => (r.aspect == null || r.aspect >= 1.5) && !/#shorts?\b|\bshorts\b|\breels?\b|vertical/i.test(r.title || "");   // 16:9 TV / CTV only
const isoSec = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || "") || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const views = (n) => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n); };
async function ytApiDetails(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const j = await ytApi("videos", { part: "snippet,contentDetails,statistics,player", id: ids.slice(i, i + 50).join(","), maxWidth: "1280" });
    for (const v of j.items || []) out.set(v.id, v);
  }
  return out;
}
async function ytApiSearch(queries, n) {
  const all = [];
  for (const q of queries) {
    const s = await ytApi("search", { part: "snippet", type: "video", q, maxResults: String(Math.min(+n || 10, 25)), regionCode: "IN", relevanceLanguage: "en", safeSearch: "moderate" });
    const ids = (s.items || []).map((x) => x.id.videoId).filter(Boolean);
    const det = await ytApiDetails(ids);
    for (const id of ids) {
      const v = det.get(id); if (!v) continue;
      const sec = isoSec(v.contentDetails.duration);
      all.push({ id, title: v.snippet.title, channel: v.snippet.channelTitle, meta: `${views(v.statistics.viewCount)} views · ${v.snippet.publishedAt.slice(0, 10)}`, length: mmss(sec), query: q, definition: v.contentDetails.definition, aspect: aspectOf(v) });
    }
  }
  return all;
}
async function ytApiMeta(id) {
  const v = (await ytApiDetails([id])).get(id);
  if (!v) throw new Error("video not found or private: " + id);
  const desc = v.snippet.description || "", chapters = [];
  for (const line of desc.split(/\r?\n/)) { const m = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:]?\s*(.+)$/.exec(line); if (m) chapters.push([(+m[1] || 0) * 3600 + +m[2] * 60 + +m[3], m[4].trim()]); }
  return { title: v.snippet.title, channel: v.snippet.channelTitle, views: v.statistics.viewCount, length: isoSec(v.contentDetails.duration), keywords: v.snippet.tags || [],
    chapters: chapters.length >= 2 && chapters[0][0] === 0 ? chapters : [], captions: v.contentDetails.caption === "true" ? ["available"] : [],
    size: playerSize(v), description: desc.slice(0, 800) };
}
// searchjson / meta go through the official API when a key is set; everything else (and any API failure) uses the browser.
async function ytJson(args) {
  if (youtubeKey() && Date.now() > ytApiDisabledUntil && (args[0] === "searchjson" || args[0] === "meta")) {
    try { return args[0] === "meta" ? await ytApiMeta(args[1]) : await ytApiSearch(String(args[1]).split("||"), args[2]); }
    catch (e) {
      console.error(e.message);
      if (e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded") ytApiDisabledUntil = Date.now() + 6 * 3600e3;
      if (e.reason === "keyInvalid" || e.reason === "API_KEY_INVALID" || e.reason === "accessNotConfigured" || e.reason === 403) ytApiDisabledUntil = Date.now() + 600e3;
    }
  }
  return ytBrowserJson(args);
}
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
const vidOf = (s) => (String(s).match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/) || String(s).match(/^([A-Za-z0-9_-]{11})$/) || [])[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lenSec = (l) => { const p = String(l || "").split(":").map(Number); return p.some(isNaN) ? 0 : p.reduce((a, b) => a * 60 + b, 0); };

// ---------- jobs ----------
const jobs = {}, adJobs = {};
function newJob(data) {
  const id = Date.now().toString(36);
  jobs[id] = { id, status: "running", step: "", log: [], ...data };
  return jobs[id];
}
const say = (job, msg) => { job.step = msg; job.log.push(new Date().toLocaleTimeString() + "  " + msg); };

const RULES = `House rules for Mediakart contextual-ad demos:
- Content videos must be premium and professional: studio/clean footage, a well-known professional channel, good lighting, 720p or better. Reject street/roadside footage, shaky vlogs, celebrity home tours, pranks, anything unhygienic or unprofessional.
- All three AI checks must literally match the brand's product:
  Visual Identify = the product category in action (e.g. potato chips frying, cream being applied, tea being poured).
  Keywords = exact phrases from the video's title about the product category.
  Object Identify = the product itself or its direct equivalent clearly visible (bowl of chips, cream tube or jar, teacup...).
- No stretches: never a bathrobe for a moisturiser, a rival's drink for chips, a breakfast plate for a snack, or "home tour" as a keyword.
- If the clearest object is a competitor's product, it may be used but must be flagged in "notes".
- Never invent claims, numbers or slogans.`;
const ICONS = ["mesh", "pan", "chip", "bowl", "plate", "tube", "jar", "bottle", "cup", "shirt", "people", "hand", "phone", "shoe", "car"];

// Step A: find the brand's official ads (AI ranks them; without AI: the brand's own channel first)
async function findAds({ brand, product }) {
  const qs = [`${brand} ad`, `${brand} TVC`, `${brand} ${product || ""} ad`.replace(/\s+/g, " ").trim(), `${brand} official commercial`];
  const seen = new Map();
  try { for (const r of await ytJson(["searchjson", [...new Set(qs)].join("||"), "12"])) if (!seen.has(r.id)) seen.set(r.id, r); }
  catch (e) { console.error("ad search failed:", e.message); throw new Error("YouTube search failed on this server: " + e.message.slice(0, 200)); }
  const list = [...seen.values()].filter((r) => { const s = lenSec(r.length); return s >= 6 && s <= 90 && isCTV(r); });   // TV/CTV (16:9) only — no vertical mobile/Shorts ads
  if (!list.length) return [];
  try {
    const pick = await ask(
      "You help an ad agency find a brand's own official TV/YouTube commercials.",
      `Brand: ${brand}${product ? `\nProduct focus: ${product}` : ""}\nYouTube results (JSON):\n${JSON.stringify(list)}\n\n` +
        `Return up to 6 that are the brand's OWN official TV / CTV commercials (16:9 TVCs uploaded by the brand's or its parent company's official channel; not vertical mobile/Shorts/Reels ads, not reactions, reviews, compilations or fan uploads). Prefer recent ads that show the product clearly. Rank best first, and say in one short line why each fits.`,
      { type: "object", additionalProperties: false, required: ["ads"],
        properties: { ads: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "why"], properties: { id: { type: "string" }, why: { type: "string" } } } } } },
      [], "medium");
    const ads = pick.ads.map((a) => ({ ...seen.get(a.id), why: a.why })).filter((a) => a.id);
    if (ads.length) return ads;
  } catch (e) { if (!(e instanceof AIError)) throw e; }
  // without AI: the brand's own channel first, then titles that mention the product, then TVC-style titles
  const b = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const own = (r) => (r.channel || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(b);
  const words = (product || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && w !== b);
  const stem = (w) => w.replace(/(ising|izing|ing|ers|er|es|s)$/, "");
  const score = (r) => { const t = (r.title || "").toLowerCase();
    return (own(r) ? 100 : 0) + words.filter((w) => t.includes(stem(w))).length * 20 + (/\btvc\b|commercial|\bad\b/.test(t) ? 5 : 0); };
  return [...list].sort((x, y) => score(y) - score(x)).slice(0, 8)
    .map((r) => ({ ...r, why: (own(r) ? "From the brand's channel" : "Check this is official") + (words.some((w) => (r.title || "").toLowerCase().includes(stem(w))) ? " · mentions the product" : "") + " · 16:9 TV ad" }));
}

const stillAt = (dir, t) => path.join(dir, `f_${String(Math.round(t * 10)).padStart(5, "0")}.png`);
const nearest = (stills, t) => stills.reduce((a, s) => (Math.abs(s.t - t) < Math.abs(a.t - t) ? s : a), stills[0]);
const titleQuery = (title) => title.split(/[|\-–(]/)[0].trim().split(/\s+/).slice(0, 8).join(" ");

// Step B: find a premium content video where all three checks match.
// With AI (Gemini free tier or Claude) the moments and boxes are proposed; without it — or when the free quota
// runs out — the app switches to manual mode: you pick the frames, drag the boxes and choose the keywords.
async function proposeMoments(job) {
  const { brand, product, adTitle } = job.input;
  const W = job.work;
  if (!job.candidates) {
    const seen = new Map(); let queries;
    if (!job.aiDown) {
      try {
        say(job, `Planning searches for premium videos (AI: ${provider()})…`);
        const plan = await ask("You plan YouTube searches for contextual ad placement.", `${RULES}\n\nBrand: ${brand}\nProduct: ${product || "(infer from the ad)"}\nAd being placed: ${adTitle}\n\nGive 6 YouTube search queries likely to surface premium, professional videos where this product category is clearly on screen (recipes, routines, tutorials, reviews...). Also state the product category in a few words.`,
          { type: "object", additionalProperties: false, required: ["category", "queries"], properties: { category: { type: "string" }, queries: { type: "array", items: { type: "string" } } } }, [], "medium");
        job.category = plan.category; queries = plan.queries.slice(0, 6);
      } catch (e) { if (!(e instanceof AIError)) throw e; job.aiDown = true; say(job, e.message); }
    }
    if (!queries) { const p = product || brand; job.category = p; queries = [`${p} recipe`, `${p} review`, `how to use ${p}`, p]; }
    say(job, `Searching YouTube: ${queries.map((q) => `“${q}”`).join(", ")}`);
    try { for (const r of await ytJson(["searchjson", queries.join("||"), "10"])) if (!seen.has(r.id)) seen.set(r.id, r); }
    catch (e) { console.error("video search failed:", e.message); say(job, "YouTube search failed: " + e.message.slice(0, 160)); }
    const pool = [...seen.values()].filter((r) => { const s = lenSec(r.length); return s >= 60 && s <= 1800; });
    job.candidates = pool.slice(0, 8);
    if (!job.aiDown) {
      try {
        say(job, `Ranking ${pool.length} candidate videos…`);
        const ranked = await ask("You choose premium YouTube videos for contextual ad placement.", `${RULES}\n\nBrand: ${brand}. Product category: ${job.category}.\nCandidates (JSON):\n${JSON.stringify(pool)}\n\nPick up to 5 candidates, best first: professional channels, the product category clearly the subject (it should appear on screen), titles containing product-category words.`,
          { type: "object", additionalProperties: false, required: ["ids"], properties: { ids: { type: "array", items: { type: "string" } } } }, [], "high");
        const c = ranked.ids.map((id) => seen.get(id)).filter(Boolean); if (c.length) job.candidates = c;
      } catch (e) { if (!(e instanceof AIError)) throw e; job.aiDown = true; say(job, e.message); }
    }
    job.tried = 0;
  }
  while (job.tried < job.candidates.length) {
    const cand = job.candidates[job.tried++];
    say(job, `Checking video ${job.tried}/${job.candidates.length}: “${cand.title}” (${cand.channel})`);
    let meta; try { meta = await ytJson(["meta", cand.id]); } catch { continue; }
    if (meta.size && Math.min(...meta.size) < 480) { say(job, "  skipped: low resolution"); continue; }
    const L = +meta.length, ts = [];
    for (let i = 0; i < 16; i++) ts.push(+(Math.max(2, L * 0.03) + (L * 0.9 - Math.max(2, L * 0.03)) * i / 15).toFixed(1));
    const sdir = path.join(W, "scan", cand.id); fs.mkdirSync(sdir, { recursive: true });
    say(job, "  scanning 16 frames…");
    const parts = [ts.filter((_, i) => i % 3 === 0), ts.filter((_, i) => i % 3 === 1), ts.filter((_, i) => i % 3 === 2)];
    await Promise.all(parts.map((p) => yt(["scan", cand.id, sdir, ...p.map(String)]).catch(() => {})));
    const stills = ts.map((t) => ({ t, file: stillAt(sdir, t) })).filter((s) => fs.existsSync(s.file));
    if (stills.length < 8) { say(job, "  skipped: could not capture frames"); continue; }
    for (const s of stills) { const j = s.file.replace(".png", "_s.jpg"); await run("ffmpeg", ["-loglevel", "error", "-y", "-i", s.file, "-vf", "scale=640:-2", "-q:v", "4", j]); s.small = j; }
    let pick = null;
    if (!job.aiDown) {
      try {
        say(job, "  AI is checking the frames (free Gemini can take ~2 min)…");
        pick = await ask("You pick the moments for a contextual-ad demo, strictly.", `${RULES}\n\nBrand: ${brand}. Product category: ${job.category}. Ad: ${adTitle}\nVideo title (exact): ${meta.title}\nChannel: ${meta.channel}, ${meta.views} views, length ${L}s${meta.chapters?.length ? `\nChapters: ${JSON.stringify(meta.chapters)}` : ""}\n\nThe ${stills.length} frames above are labelled with their time in seconds.\n` +
          `Decide whether this video passes the house rules. If it does, choose: open_t (a strong 2-second opening shot), visual (time + what the Visual Identify shows), object (time + the object), keyword phrases that are EXACT substrings of the title (1–3 phrases, product-category words), a 2-line keyword card (max ~10 characters per line, use \\n), an icon for each mark (one of ${ICONS.join(", ")}; use mesh only when a face is the subject), and a YouTube search query that should return this exact video near the top (use distinctive title words).` +
          ` Times must be among the labelled frame times. Reject (accept=false) if any of the three checks would be a stretch.`,
          { type: "object", additionalProperties: false, required: ["accept", "reason", "open_t", "visual", "object", "keywords", "card", "query", "notes"],
            properties: { accept: { type: "boolean" }, reason: { type: "string" }, open_t: { type: "number" },
              visual: { type: "object", additionalProperties: false, required: ["t", "what", "why", "icon"], properties: { t: { type: "number" }, what: { type: "string" }, why: { type: "string" }, icon: { type: "string", enum: ICONS } } },
              object: { type: "object", additionalProperties: false, required: ["t", "what", "why", "icon"], properties: { t: { type: "number" }, what: { type: "string" }, why: { type: "string" }, icon: { type: "string", enum: ICONS } } },
              keywords: { type: "array", items: { type: "string" } }, card: { type: "string" }, query: { type: "string" }, notes: { type: "string" } } },
          stills.map((s) => ({ label: `t=${s.t}s`, file: s.small })), "high");
        if (!pick.accept) { say(job, "  rejected: " + pick.reason); continue; }
      } catch (e) { if (!(e instanceof AIError)) throw e; job.aiDown = true; pick = null; say(job, e.message); }
    }
    const manual = !pick;
    if (manual) {   // starting point for manual picking
      const n = stills.length;
      pick = { open_t: stills[1].t, notes: "", query: "", keywords: [], card: "",
        visual: { t: stills[Math.floor(n * 0.35)].t, what: "", why: "", icon: "hand" },
        object: { t: stills[Math.floor(n * 0.65)].t, what: "", why: "", icon: "bowl" } };
    }
    pick.open_t = nearest(stills, pick.open_t).t;
    for (const k of ["visual", "object"]) { const s = nearest(stills, pick[k].t); pick[k].t = s.t; pick[k].still = s.file; }
    const tl = meta.title.toLowerCase();
    pick.keywords = (pick.keywords || []).filter((k) => k && tl.includes(k.toLowerCase())).slice(0, 3);
    if (!manual && !pick.keywords.length) { say(job, "  rejected: no exact title keywords"); continue; }
    const c = (v) => Math.max(0, Math.min(1, v));
    for (const k of ["visual", "object"]) {
      pick[k].box = [0.2, 0.2, 0.6, 0.6];
      if (manual || job.aiDown) continue;
      const g = pick[k].still.replace(".png", "_grid.jpg");
      await run("ffmpeg", ["-loglevel", "error", "-y", "-i", pick[k].still, "-vf", "drawgrid=w=iw/10:h=ih/10:t=1:c=yellow@0.8", "-q:v", "3", g]);
      try {
        say(job, `  AI is placing the ${k} box…`);
        const b = await ask("You place a highlight box on a video frame.", `Draw a tight box around: ${pick[k].what}.\nThe yellow grid lines are every 10% of width and height. Return the box as fractions of the frame: x, y (top-left) and w, h, all between 0 and 1. Keep it on the subject; leave out on-screen captions where possible.`,
          { type: "object", additionalProperties: false, required: ["x", "y", "w", "h"], properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } } },
          [{ label: `${k} frame`, file: g }], "medium");
        pick[k].box = [c(b.x), c(b.y), Math.min(c(b.w), 1 - c(b.x)), Math.min(c(b.h), 1 - c(b.y))];
      } catch (e) { if (!(e instanceof AIError)) throw e; job.aiDown = true; say(job, e.message); }
    }
    // the search query must show this video on the first screen
    let q = pick.query || titleQuery(meta.title);
    for (const tryQ of [q, titleQuery(meta.title)]) {
      try { const r = await ytJson(["searchjson", tryQ, "3"]); if (r.some((x) => x.id === cand.id)) { q = tryQ; break; } } catch {}
    }
    job.scan = stills;
    job.proposal = { video: { id: cand.id, title: meta.title, channel: meta.channel, views: meta.views, length: L }, pick, query: q,
      manual: manual || !!job.aiDown, frames: stills.map((s) => s.t), icons: ICONS };
    return true;
  }
  return false;
}

// Step C: capture → build → render → mux
async function produce(job) {
  const W = job.work, P = job.proposal, I = job.input;
  const cfg = {
    brand: I.brand, titleSuffix: "Contextual ads", logo: I.logo,
    search: { query: P.query },
    video: { id: P.video.id, tabTitle: P.video.title.length > 46 ? P.video.title.slice(0, 44) + "…" : P.video.title },
    open: { t: P.pick.open_t },
    visual: { t: P.pick.visual.t, box: P.pick.visual.box, icon: P.pick.visual.icon },
    keywords: { phrases: P.pick.keywords, card: P.pick.card },
    object: { t: P.pick.object.t, box: P.pick.object.box, icon: P.pick.object.icon },
    ad: { id: I.adId },
    endcard: I.endcard && I.packs?.length ? { tagline: I.tagline || "", sub: "", color: "#111", packs: I.packs } : null,
  };
  if (I.adSeconds) cfg.ad.seconds = Math.min(45, I.adSeconds);
  fs.writeFileSync(path.join(W, "config.json"), JSON.stringify(cfg, null, 1));
  say(job, "Capturing YouTube pages, the three moments and the ad (about 3–6 minutes)…");
  await run(PY, [path.join(PIPE, "scripts", "capture.py"), W], { log: (l) => job.log.push("   " + l) });
  const pj = JSON.parse(fs.readFileSync(path.join(W, "pages", "pages.json"), "utf8"));
  if (!pj.results.some((r) => r.target)) {
    say(job, "Search didn't show the video on the first screen; retrying with its title…");
    cfg.search.query = P.video.title.split(/[|]/)[0].trim(); fs.writeFileSync(path.join(W, "config.json"), JSON.stringify(cfg, null, 1));
    await yt(["pages", P.video.id, cfg.search.query, path.join(W, "pages"), P.pick.keywords.join("|")]);
  }
  say(job, "Building the template…");
  await run(PY, [path.join(PIPE, "scripts", "build_ad.py"), W]);
  say(job, "Rendering (about 5 minutes)…");
  const raw = path.join(W, "out_noaudio.mp4");
  await run("node", [path.join(PIPE, "scripts", "render.js"), path.join(W, "dist", "contextual-ad.html"), raw, "25", process.env.RENDER_SUBFRAMES || "4"], { log: (l) => { const m = l.match(/frame (\d+) \/ (\d+)/); if (m) job.step = `Rendering… ${Math.round((100 * m[1]) / m[2])}%`; } });
  say(job, "Adding music and the ad's sound…");
  const final = path.join(W, `${slug(I.brand)}-contextual-ad.mp4`);
  const args = [path.join(PIPE, "scripts", "mux.py"), raw, fs.existsSync(path.join(W, "ad_audio.webm")) ? path.join(W, "ad_audio.webm") : "none", final];
  if (!I.music) args.push("--no-music");
  await run(PY, args);
  job.output = final;
  fs.writeFileSync(path.join(W, "TIMING.md"), `# ${I.brand} contextual ad\n\n- Content video: ${P.video.title} — ${P.video.channel} — https://www.youtube.com/watch?v=${P.video.id}\n- Ad placed: ${I.adTitle} — https://www.youtube.com/watch?v=${I.adId}\n- Search typed: “${cfg.search.query}”\n\n| Check | Time | What | Why it matches |\n|---|---|---|---|\n| Visual Identify | ${P.pick.visual.t}s | ${P.pick.visual.what} | ${P.pick.visual.why} |\n| Keywords | title | ${P.pick.keywords.join(", ")} | exact title phrases |\n| Object Identify | ${P.pick.object.t}s | ${P.pick.object.what} | ${P.pick.object.why} |\n\nNotes: ${P.pick.notes || "—"}\nThe YouTube player was captured as screenshots and recorded audio; nothing was downloaded as a file.\n`);
}

// ---------- HTTP ----------
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });
function saveData(dataUrl, file) { const m = /^data:[^;]+;base64,(.*)$/.exec(dataUrl || ""); if (!m) return null; fs.writeFileSync(file, Buffer.from(m[1], "base64")); return file; }

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/healthz") return send(res, 200, { ok: true });
  if (u.pathname === "/api/diag") {   // memory + can this server reach YouTube?
    const rd = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return null; } };
    const t0 = Date.now(); let yt1 = null, err = null;
    try {
      if (u.searchParams.get("mode") === "scan") {   // heavier: a real player frame
        const d = path.join(OUT_ROOT, "_diag"); fs.mkdirSync(d, { recursive: true });
        await yt(["scan", "5DW0ixWjn7U", d, "81"]); yt1 = fs.readdirSync(d);
      } else yt1 = (await ytJson(["searchjson", "potato chips recipe", "3"])).map((r) => r.title);
    } catch (e) { err = e.message.slice(0, 400); }
    return send(res, 200, { youtube: yt1, error: err, seconds: (Date.now() - t0) / 1000, memLimit: rd("/sys/fs/cgroup/memory.max"), memPeak: rd("/sys/fs/cgroup/memory.peak"), memNow: rd("/sys/fs/cgroup/memory.current"), provider: provider() });
  }
  if (PASSWORD) {   // basic auth so a public URL can't spend your API key
    const [, b64] = (req.headers.authorization || "").split(" ");
    const pw = b64 ? Buffer.from(b64, "base64").toString().split(":").slice(1).join(":") : "";
    if (pw !== PASSWORD) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Contextual Ad Studio"' }); return res.end("Login required"); }
  }
  try {
    if (req.method === "GET" && u.pathname === "/") return send(res, 200, fs.readFileSync(path.join(APP, "ui.html")), "text/html; charset=utf-8");
    if (u.pathname === "/api/status") return send(res, 200, { hasKey: provider() !== "none", provider: provider(), youtube: youtubeKey() ? (Date.now() > ytApiDisabledUntil ? "api" : "browser (API paused)") : "browser", keyFromEnv: !!(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY), ffmpeg: !!FF || !IS_WIN, hosted: !IS_WIN, outDir: OUT_ROOT });
    if (req.method === "POST" && u.pathname === "/api/settings") { const b = await body(req); const s = loadSettings(); if (b.apiKey) s.apiKey = b.apiKey.trim(); if (b.geminiKey) s.geminiKey = b.geminiKey.trim(); if (b.youtubeKey) { s.youtubeKey = b.youtubeKey.trim(); ytApiDisabledUntil = 0; } if (b.provider) s.provider = b.provider; fs.writeFileSync(SETTINGS, JSON.stringify(s)); return send(res, 200, { ok: true, provider: provider() }); }
    if (req.method === "POST" && u.pathname === "/api/ads") {   // runs in the background (share links cut requests at ~100 s)
      const b = await body(req); const id = "a" + Date.now().toString(36); adJobs[id] = { status: "running" };
      findAds(b).then((ads) => { adJobs[id] = { status: "done", ads }; }).catch((e) => { adJobs[id] = { status: "failed", error: e.message }; });
      return send(res, 200, { id });
    }
    const am = u.pathname.match(/^\/api\/ads\/(\w+)$/);
    if (am) return adJobs[am[1]] ? send(res, 200, adJobs[am[1]]) : send(res, 404, { error: "unknown search" });
    if (req.method === "POST" && u.pathname === "/api/start") {
      const b = await body(req);
      const adId = vidOf(b.adId || b.adUrl); if (!adId) return send(res, 400, { error: "Pick an ad or paste a YouTube link." });
      const work = path.join(OUT_ROOT, slug(b.brand)); fs.mkdirSync(path.join(work, "assets"), { recursive: true });
      const logoExt = (/^data:image\/(\w+)/.exec(b.logo || "") || [, "png"])[1].replace("jpeg", "jpg");
      if (!saveData(b.logo, path.join(work, "assets", "logo." + logoExt))) return send(res, 400, { error: "Upload the brand logo." });
      const packs = (b.packs || []).map((p, i) => { const e = (/^data:image\/(\w+)/.exec(p) || [, "png"])[1].replace("jpeg", "jpg"); return saveData(p, path.join(work, "assets", `pack${i + 1}.${e}`)) ? `assets/pack${i + 1}.${e}` : null; }).filter(Boolean);
      let adTitle = b.adTitle, adSeconds;
      try {
        const m = await ytJson(["meta", adId]); adTitle = adTitle || m.title; adSeconds = +m.length;
        if (m.size && m.size[0] / m.size[1] < 1.5) return send(res, 400, { error: `This ad is vertical (${m.size[0]}×${m.size[1]}) — a mobile/Shorts ad. Pick a 16:9 TV / CTV commercial.` });
      } catch {}
      const job = newJob({ work, input: { brand: b.brand, product: b.product, adId, adTitle: adTitle || adId, adSeconds, logo: "assets/logo." + logoExt, packs, endcard: !!b.endcard, tagline: b.tagline, music: b.music !== false } });
      (async () => {
        try { const ok = await proposeMoments(job); job.status = ok ? "approve" : "failed"; if (!ok) say(job, "No video passed all three checks. Try a different product focus."); }
        catch (e) { job.status = "failed"; say(job, "Error: " + e.message); }
      })();
      return send(res, 200, { id: job.id });
    }
    const jm = u.pathname.match(/^\/api\/job\/(\w+)(\/(\w+))?$/);
    if (jm && jobs[jm[1]]) {
      const job = jobs[jm[1]], act = jm[3];
      if (!act) return send(res, 200, { status: job.status, step: job.step, log: job.log.slice(-40), proposal: job.proposal && { ...job.proposal, pick: { ...job.proposal.pick, visual: { ...job.proposal.pick.visual, still: undefined }, object: { ...job.proposal.pick.object, still: undefined } } }, output: job.output });
      if (act === "frame") { const s = job.scan?.[+u.searchParams.get("i")]; return s ? send(res, 200, fs.readFileSync(s.small), "image/jpeg") : send(res, 404, {}); }
      if (act === "still") { const k = u.searchParams.get("k"); const f = job.proposal?.pick?.[k]?.still; return f ? send(res, 200, fs.readFileSync(f), "image/png") : send(res, 404, {}); }
      if (act === "video" && job.output) { const st = fs.statSync(job.output); res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": st.size, "Content-Disposition": u.searchParams.get("dl") ? `attachment; filename="${path.basename(job.output)}"` : "inline" }); return fs.createReadStream(job.output).pipe(res); }
      if (act === "approve" && req.method === "POST") {
        if (job.status !== "approve") return send(res, 409, { error: "This job is already " + job.status + "." });
        const e = (await body(req)).edits, P = job.proposal;
        if (e && P) {   // manual adjustments from the approval screen
          for (const k of ["visual", "object"]) if (e[k]) {
            if (e[k].t != null) { const s = nearest(job.scan, +e[k].t); P.pick[k].t = s.t; P.pick[k].still = s.file; }
            if (Array.isArray(e[k].box) && e[k].box.length === 4) P.pick[k].box = e[k].box.map((v) => Math.max(0, Math.min(1, +v)));
            if (ICONS.includes(e[k].icon)) P.pick[k].icon = e[k].icon;
          }
          if (Array.isArray(e.keywords)) P.pick.keywords = e.keywords.map((k) => String(k).trim()).filter((k) => k && P.video.title.toLowerCase().includes(k.toLowerCase())).slice(0, 3);
          if (typeof e.card === "string" && e.card.trim()) P.pick.card = e.card.trim();
        }
        if (!P.pick.keywords.length) return send(res, 400, { error: "Add at least one keyword — it must be words copied exactly from the video title." });
        if (!P.pick.card) P.pick.card = P.pick.keywords[0].split(/\s+/).slice(0, 2).join("\n");
        job.status = "running";
        (async () => { try { await produce(job); job.status = "done"; say(job, "Done — saved to " + job.output); } catch (e) { job.status = "failed"; say(job, "Error: " + e.message); } })();
        return send(res, 200, { ok: true });
      }
      if (act === "next" && req.method === "POST") {
        if (job.status !== "approve") return send(res, 409, { error: "This job is already " + job.status + "." });
        job.status = "running"; job.proposal = null;
        (async () => { try { const ok = await proposeMoments(job); job.status = ok ? "approve" : "failed"; if (!ok) say(job, "No more candidates passed all three checks."); } catch (e) { job.status = "failed"; say(job, "Error: " + e.message); } })();
        return send(res, 200, { ok: true });
      }
      if (act === "open" && job.output && IS_WIN) { spawn("explorer.exe", ["/select,", job.output], { detached: true }); return send(res, 200, { ok: true }); }
    }
    send(res, 404, { error: "not found" });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, HOST, () => {
  console.log(`Contextual Ad Studio running on ${HOST}:${PORT}`);
  if (IS_WIN && !process.env.PORT && !process.argv.includes("--no-open")) spawn("cmd", ["/c", "start", "", `http://localhost:${PORT}`], { detached: true, windowsHide: true });
});
