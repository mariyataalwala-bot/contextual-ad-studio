// Contextual Ad Studio — local app. Type a brand, pick the ad, approve the three checks, get the MP4.
// Start with start.bat (or: node server.mjs). Opens http://localhost:4777
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { createOpenWeb } from "./openweb/routes.mjs";

const APP = path.dirname(fileURLToPath(import.meta.url));
const PIPE = path.join(APP, "pipeline");
const IS_WIN = process.platform === "win32";
const OUT_ROOT = process.env.OUT_DIR || (IS_WIN ? "D:\\contextual-ads" : path.join(APP, "output"));
const SETTINGS = path.join(APP, "settings.json");
const PORT = +(process.env.PORT || 4777);
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");   // on Render (PORT set) listen publicly
const sharePassword = () => process.env.APP_PASSWORD || loadSettings().sharePassword || "";   // login for anyone using the share link / hosted app
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
// fastest first (measured: 3.5/3.6-flash ~6 s, 3-flash-preview ~11 s; flash-latest and 3.8-flash can take 40–60 s+)
const GEMINI_MODELS = () => [...new Set([loadSettings().geminiModel || process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.7-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"].filter(Boolean))];
const geminiOut = new Map();   // model → time its quota is expected back
function claude() {
  const key = claudeKey();
  if (!key) throw new Error("Add your Claude API key in Settings first.");
  return new Anthropic({ apiKey: key });
}
class AIError extends Error {}
// One structured-JSON call. Images are [{label, file}] JPEG/PNG paths.
async function ask(system, text, schema, images = [], effort = "high") {   // effort "medium" + no images → fast lite model first
  const p = provider();
  if (p === "none") throw new AIError("No AI key set — using manual mode.");
  try { return p === "gemini" ? await askGemini(system, text, schema, images, !images.length && effort === "medium", images.length && effort === "high" ? 4000 : 0) : await askClaude(system, text, schema, images, effort); }
  catch (e) { if (e instanceof AIError) throw e; throw new AIError(e.message || String(e)); }
}
async function askGemini(system, text, schema, images, fast = false, grace = 0) {
  const ai = new GoogleGenAI({ apiKey: geminiKey() });
  const parts = [];
  for (const im of images) {
    parts.push({ text: im.label });
    parts.push({ inlineData: { mimeType: im.file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg", data: fs.readFileSync(im.file).toString("base64") } });
  }
  parts.push({ text });
  // a flash and a lite model start together (lite answers in ~3–8 s; flash can take 5–20 s on the free tier)
  // Free tier: flash models allow ~20 requests/day each, lite models far more. So only the main pick (grace) races a flash
  // and a lite model; every other call starts with one lite model and adds another only if it fails or is slow.
  const LITE = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
  const all = grace ? [...new Set([GEMINI_MODELS()[0], ...LITE, ...GEMINI_MODELS()])] : [...new Set([...LITE, ...GEMINI_MODELS()])];
  const ready = all.filter((m) => (geminiOut.get(m) || 0) <= Date.now());
  const models = ready.length ? ready : all;   // if every model is resting, try them anyway rather than give up
  const vision = images.length > 0, TIMEOUT = vision ? 30000 : 15000, HEDGE = vision ? 6000 : 4000;
  let last = "", quota = 0, over = false; const stop = new AbortController();   // over = a winner was found
  // one model, with one retry on broken JSON; marks busy / out-of-quota models so later calls skip them for a while.
  // Requests still running when another model wins are cancelled, and their failures don't count against the model.
  const one = async (model) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await ai.models.generateContent({ model, contents: [{ role: "user", parts }],
          config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema, abortSignal: stop.signal, httpOptions: { timeout: TIMEOUT } } });
        return JSON.parse(r.text);
      } catch (e) {
        if (over) throw e;
        last = String(e.message || e);
        if (/JSON/.test(last) && attempt === 0) continue;
        if (/429|RESOURCE_EXHAUSTED/i.test(last)) { quota++; geminiOut.set(model, Date.now() + (/PerDay|per.?day|daily/i.test(last) ? 3 * 3600e3 : 90e3)); }
        else if (/404|not found|no longer available|not supported/i.test(last)) geminiOut.set(model, Date.now() + 24 * 3600e3);
        else if (/503|UNAVAILABLE|overloaded/i.test(last)) geminiOut.set(model, Date.now() + 60e3);
        else if (/timed? ?out|aborted/i.test(last)) geminiOut.set(model, Date.now() + 120e3);
        throw e;
      }
    }
  };
  // hedged: start two models; if neither has answered in a few seconds, start the next one too — first good answer wins.
  // With grace (the main pick), a lite model's answer waits up to `grace` ms for a flash model's, which is stricter.
  return new Promise((resolve, reject) => {
    let i = 0, running = 0, done = false, timer, graceT, liteAns = null; const active = new Set();
    const finish = (fn, v) => { if (done) return; done = over = true; clearInterval(timer); clearTimeout(graceT); stop.abort(); fn(v); };
    const launch = () => {
      if (done) return;
      if (i >= models.length) { if (!running) liteAns ? finish(resolve, liteAns) : finish(reject, new AIError(quota && quota >= models.length - 1 ? "All free Gemini models are out of quota for now (it resets daily, ~12:30 pm IST). Add a Claude key in Settings for faster, unlimited picks." : "Gemini is busy right now: " + last.slice(0, 160))); return; }
      const model = models[i++]; running++; active.add(model);
      one(model).then((r) => {
        active.delete(model); running--;
        if (grace && /lite/.test(model) && [...active].some((m) => !/lite/.test(m))) { if (!liteAns) { liteAns = r; graceT = setTimeout(() => finish(resolve, liteAns), grace); } return; }
        finish(resolve, r);
      }).catch(() => { active.delete(model); running--; if (liteAns && ![...active].some((m) => !/lite/.test(m))) return finish(resolve, liteAns); launch(); });
    };
    launch(); if (grace) launch();
    timer = setInterval(() => { if (running < 2 && !liteAns) launch(); }, HEDGE);
  });
}
// Meaning vectors (embeddings) for semantic matching — Gemini's embedding model, which has its own free allowance
// (~100 texts a minute): batches of up to 45, and a wait (at most ~1.5 min in total) whenever the minute limit is hit.
async function embedTexts(texts, task = "RETRIEVAL_DOCUMENT", dims = 768) {
  const key = geminiKey(); if (!key) throw new AIError("Meaning match needs the Gemini key (Settings on the computer running the app).");
  const out = []; let waited = 0;
  for (let i = 0; i < texts.length; i += 45) {
    for (;;) {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents", { method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ requests: texts.slice(i, i + 45).map((text) => ({ model: "models/gemini-embedding-001", content: { parts: [{ text: String(text).slice(0, 8000) }] }, taskType: task, outputDimensionality: dims })) }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429 && !/per.?day/i.test(JSON.stringify(j)) && waited < 90000) { await sleep(20000); waited += 20000; continue; }
      if (!r.ok || !j.embeddings) throw new AIError("Gemini embeddings: " + (j.error?.message || "HTTP " + r.status).slice(0, 160));
      out.push(...j.embeddings.map((e) => e.values)); break;
    }
  }
  return out;
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
function run(cmd, args, { log, cwd, env, timeout } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: env ? { ...ENV, ...env } : ENV, cwd: cwd || APP, windowsHide: true });
    let out = "", err = "";
    const kill = timeout ? setTimeout(() => { err += `\ntimed out after ${timeout / 1000} s`; p.kill(); }, timeout) : null;   // a stuck helper never holds a job up
    p.stdout.on("data", (d) => { out += d; if (log) String(d).split(/\r?\n/).filter(Boolean).forEach(log); });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => { clearTimeout(kill); code === 0 ? resolve(out) : reject(new Error(`${path.basename(args[0] || cmd)} failed (${code}): ${(err || out).slice(-600)}`)); });
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
const subsCache = new Map(), avatarCache = new Map();
async function channelSubs(ids) {
  const need = [...new Set(ids)].filter((c) => c && !subsCache.has(c));
  for (let i = 0; i < need.length; i += 50) {
    const j = await ytApi("channels", { part: "statistics,snippet", id: need.slice(i, i + 50).join(",") });
    for (const c of j.items || []) {
      subsCache.set(c.id, +c.statistics.subscriberCount || 0);
      const th = c.snippet?.thumbnails || {}; avatarCache.set(c.id, (th.high || th.medium || th.default || {}).url || null);   // the channel's picture = usually the brand logo
    }
  }
  return (id) => subsCache.get(id) ?? null;
}
const SEARCH_CACHE = path.join(OUT_ROOT, "_cache", "search.json");
let searchCache = (() => { try { return JSON.parse(fs.readFileSync(SEARCH_CACHE, "utf8")); } catch { return {}; } })();
// full records (channel size, views, length, HD, aspect) for video ids — the "videos"/"channels" calls cost 1 unit each,
// separate from the ~100-a-day search limit
async function videoRecords(ids, q) {
  const det = await ytApiDetails(ids), out = [];
  const subs = await channelSubs([...det.values()].map((v) => v.snippet.channelId)).catch(() => () => null);
  for (const id of ids) {
    const v = det.get(id); if (!v) continue;
    const sec = isoSec(v.contentDetails.duration), sc = subs(v.snippet.channelId);
    out.push({ id, channelId: v.snippet.channelId, title: v.snippet.title, channel: v.snippet.channelTitle, meta: `${views(v.statistics.viewCount)} views · ${v.snippet.publishedAt.slice(0, 10)}${sc != null ? ` · channel ${views(sc)} subscribers` : ""}`,
      length: mmss(sec), query: q, definition: v.contentDetails.definition, aspect: aspectOf(v), subs: sc, views: +v.statistics.viewCount || 0 });
  }
  return out;
}
async function ytApiSearch(queries, n) {
  const all = [];
  const found = await Promise.all(queries.map(async (q) => {   // all queries at once; each one cached for a day
    const key = `${normTxt(q)}|${n}`, hit = searchCache[key];
    if (hit && Date.now() - hit.t < 24 * 3600e3) return hit.r;
    const all = [];
    const s = await ytApi("search", { part: "snippet", type: "video", q, maxResults: String(Math.min(+n || 10, 25)), regionCode: "IN", relevanceLanguage: "en", safeSearch: "moderate" });
    all.push(...await videoRecords((s.items || []).map((x) => x.id.videoId).filter(Boolean), q));
    searchCache[key] = { t: Date.now(), r: all };
    return all;
  }));
  try { const now = Date.now(); for (const k of Object.keys(searchCache)) if (now - searchCache[k].t > 24 * 3600e3) delete searchCache[k];
    fs.mkdirSync(path.dirname(SEARCH_CACHE), { recursive: true }); fs.writeFileSync(SEARCH_CACHE, JSON.stringify(searchCache)); } catch {}
  for (const f of found) all.push(...f);
  return all;
}
async function ytApiMeta(id) {
  const v = (await ytApiDetails([id])).get(id);
  if (!v) throw new Error("video not found or private: " + id);
  const desc = v.snippet.description || "", chapters = [];
  for (const line of desc.split(/\r?\n/)) { const m = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:]?\s*(.+)$/.exec(line); if (m) chapters.push([(+m[1] || 0) * 3600 + +m[2] * 60 + +m[3], m[4].trim()]); }
  return { channelId: v.snippet.channelId, title: v.snippet.title, channel: v.snippet.channelTitle, views: v.statistics.viewCount, length: isoSec(v.contentDetails.duration), keywords: v.snippet.tags || [],
    chapters: chapters.length >= 2 && chapters[0][0] === 0 ? chapters : [], captions: v.contentDetails.caption === "true" ? ["available"] : [],
    size: playerSize(v), description: desc.slice(0, 800) };
}
// searchjson / meta go through the official API when a key is set; everything else (and any API failure) uses the browser.
// The free key allows ~100 searches a day: searches are cached for a day, and once the daily search limit is hit, searches go
// through the browser until it resets (video details keep using the API — they have their own, much larger limit).
let ytSearchOffUntil = 0;
const nextPacificMidnight = () => { const d = new Date(); d.setUTCHours(8, 0, 0, 0); if (d <= Date.now()) d.setUTCDate(d.getUTCDate() + 1); return +d; };
async function ytJson(args) {
  const search = args[0] === "searchjson";
  if (youtubeKey() && Date.now() > ytApiDisabledUntil && (search || args[0] === "meta") && !(search && Date.now() < ytSearchOffUntil)) {
    try { return args[0] === "meta" ? await ytApiMeta(args[1]) : await ytApiSearch(String(args[1]).split("||"), args[2]); }
    catch (e) {
      console.error(e.message);
      if (search && (e.reason === "rateLimitExceeded" || /per day/i.test(e.message))) ytSearchOffUntil = nextPacificMidnight();
      else if (e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded") ytApiDisabledUntil = nextPacificMidnight();
      if (e.reason === "keyInvalid" || e.reason === "API_KEY_INVALID" || e.reason === "accessNotConfigured" || e.reason === 403) ytApiDisabledUntil = Date.now() + 600e3;
    }
  }
  const rows = await ytBrowserJson(args);
  if (search && youtubeKey() && Date.now() > ytApiDisabledUntil && Array.isArray(rows) && rows.length) {
    try {   // browser search found the ids; the API fills in channel size, views, length, HD (so "big channels only" still works)
      const byId = new Map(rows.map((r) => [r.id, r])), recs = await videoRecords([...byId.keys()], "");
      if (recs.length) return recs.map((r) => ({ ...r, query: byId.get(r.id)?.query || "" }));
    } catch (e) { console.error("enrich failed:", e.message); }
  }
  return rows;
}
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
const vidOf = (s) => (String(s).match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/) || String(s).match(/^([A-Za-z0-9_-]{11})$/) || [])[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lenSec = (l) => { const p = String(l || "").split(":").map(Number); return p.some(isNaN) ? 0 : p.reduce((a, b) => a * 60 + b, 0); };

// ---------- jobs ----------
const jobs = {}, adJobs = {};
let renderChain = Promise.resolve(), waiting = 0;   // one capture+render at a time; others queue
function queued(job, fn) {
  waiting++; const ahead = waiting - 1;
  if (ahead > 0) say(job, `Waiting — ${ahead} video${ahead > 1 ? "s" : ""} ahead in the queue…`);
  const run = renderChain.then(fn).finally(() => { waiting--; });
  renderChain = run.catch(() => {});
  return run;
}
function newJob(data) {
  const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
  jobs[id] = { id, status: "running", step: "", log: [], t0: Date.now(), prog: { a: 0, b: 1, t: Date.now(), dur: 10, stage: 0 }, ...data };
  return jobs[id];
}
// Overall progress: each milestone message moves the bar into a [from, to] band; inside a band it creeps forward
// with time (expected seconds), and rendering uses the real frame count. The bar never goes backwards.
// stage: 0 find video · 1 capture · 2 build · 3 render · 4 sound
const MILESTONES = [
  [/^Planning searches/, 1, 5, 3, 0], [/^Searching YouTube/, 5, 10, 3, 0], [/^Ranking/, 10, 15, 4, 0],
  [/^Checking video/, 15, 18, 2, 0], [/reading the video's storyboard/, 18, 24, 4, 0], [/scanning 12 frames/, 18, 28, 25, 0],
  [/AI is checking the frames/, 24, 40, 9, 0], [/asking again/, 40, 42, 6, 0], [/^  AI is placing both boxes/, 42, 46, 8, 0],
  [/^Picked:/, 42, 44, 1, 1], [/^Capturing the three moments/, 44, 69, 16, 1], [/retrying with/, 60, 66, 10, 1],
  [/^AI is placing the boxes/, 64, 70, 6, 1], [/^Building the template/, 70, 72, 2, 2],
  [/^Rendering the 720p/, 72, 96, 15, 3], [/^Rendering full HD/, 72, 96, 30, 3], [/^Adding music/, 96, 99, 2, 4],
];
function pctOf(job) {
  const p = job.prog; if (job.status === "done") return 100;
  const f = p.frac != null ? p.frac : Math.min(0.92, (Date.now() - p.t) / 1000 / p.dur);
  return Math.max(p.last || 0, Math.min(99, p.a + (p.b - p.a) * f));
}
function setBand(job, a, b, dur, stage) {
  const p = job.prog, now = pctOf(job);
  job.prog = { a: Math.max(a, now), b: Math.max(b, now), t: Date.now(), dur, stage, last: now };
}
const say = (job, msg) => {
  job.step = msg; job.log.push(new Date().toLocaleTimeString() + "  " + msg);
  const m = MILESTONES.find(([re]) => re.test(msg));
  if (m) { let [, a, b, dur, stage] = m; if (job.hdOnly && stage >= 3) { if (stage === 3) [a, b] = [2, 92]; else [a, b] = [92, 99]; } setBand(job, a, b, dur, stage); }
};
const progressOf = (job) => ({ pct: Math.round(pctOf(job)), stage: job.status === "done" ? 5 : job.prog.stage, hdOnly: !!job.hdOnly, preview: !!job.input?.preview,
  elapsed: Math.round(((job.status === "running" ? Date.now() : job.tEnd || Date.now()) - job.t0) / 1000) });

const RULES = `House rules for Mediakart contextual-ad demos:
- Content videos must be PREMIUM: produced by well-known professional creators, studios, media brands or specialist publishers for the product's category, with studio-quality cinematography, lighting and styling, HD. Examples — food: Chef Ranveer Brar, Kunal Kapur, Your Food Lab / Chef Sanjyot Keer, Sanjeev Kapoor Khazana, Hebbars Kitchen, Tasty, Bon Appétit, America's Test Kitchen, Food Network; home & appliances: HGTV, This Old House, The Home Depot, Lowe's, Architectural Digest, Asian Paints Where the Heart Is; beauty & fashion: Vogue, Harper's BAZAAR, GQ, Elle; tech: MKBHD, Unbox Therapy, Mrwhosetheboss. Prefer English or neat bilingual titles over clickbait titles.
- Independent publishers only: never the advertised brand's own channel, and never a COMPETING MANUFACTURER's own channel (e.g. for a Havells fan ad, not Hunter Fan Company, Crompton or Atomberg's channels). Retailers' and media publishers' tutorials and guides (Home Depot, HGTV…) are fine.
- Reject: home-kitchen / amateur production even on big channels, clickbait titles ("guarantee", "you'll never…", ALL CAPS), street/roadside footage, shaky vlogs, celebrity home tours, pranks, anything unhygienic or unprofessional.
- All three AI checks must literally match the brand's product:
  Visual Identify = the product category in action (e.g. potato chips frying, cream being applied, tea being poured).
  Keywords = exact phrases from the video's title about the product category.
  Object Identify = the product itself or its direct equivalent clearly visible (bowl of chips, cream tube or jar, teacup...).
- No stretches: never a bathrobe for a moisturiser, a rival's drink for chips, a breakfast plate for a snack, or "home tour" as a keyword.
- Visual Identify must show the product category itself on screen (the food being cooked/served, the product being used). Never a presenter's face or a talking-head shot, unless the product is worn on the face (skincare, make-up, eyewear).
- If the clearest object is a competitor's product, it may be used but must be flagged in "notes".
- The content video must be INDEPENDENT of the advertised brand: never uploaded, made, sponsored or promoted by the brand (or its parent company), never about the brand's own products (none of the advertised brand's own tutorials, installation guides, unboxings, reviews or ads — general tutorials and guides by independent publishers are fine), and the brand's logo or products must not appear in the chosen moments.
- Never invent claims, numbers or slogans.`;

// ---------- the advertised brand: its own content is never used as the content video ----------
// names = the brand as typed + the ad's channel (e.g. "MAGGI India" → maggi, "Nestlé India" → nestle), generic words dropped
const normTxt = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim();
const GENERIC_WORDS = /\b(india|indian|official|tv|ltd|limited|pvt|private|group|global|channel|inc|co|company|brand|brands|store|shop|world|hq|meri|mera|my|new|the|and|ad|ads|tvc|seconds|sec)\b/g;
const near1 = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, d = 0;   // edit distance ≤ 1
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return d + (a.length - i) + (b.length - j) <= 1; };
function brandNames(I) {
  const out = new Set(), clean = (x) => normTxt(x).replace(GENERIC_WORDS, " ").replace(/\s+/g, " ").trim();
  for (const x of [I.brand, I.adChannel]) { const n = clean(x); if (n.length >= 3) out.add(n); }
  const typed = clean(I.brand).replace(/\s/g, ""), chW = clean(I.adChannel).split(" "), tiW = new Set(clean(I.adTitle).split(" "));
  for (const w of [...chW, ...tiW]) if (w.length >= 4 && ((chW.includes(w) && tiW.has(w)) || (typed.length >= 4 && near1(w, typed)))) out.add(w);   // "MERI MAGGI" + "…MAGGI Veg Atta" → maggi; "Maggie" → maggi
  return [...out];
}
// whole-word match in text ("lays" in "Lay's chips"); the channel is also checked without spaces ("MaggiIndia")
const mentionsBrand = (text, names) => { const t = ` ${normTxt(text)} `, sq = t.replace(/\s/g, ""); return names.some((n) => t.includes(` ${n} `) || (n.includes(" ") && sq.includes(n.replace(/\s/g, "")))); };
const channelIsBrand = (ch, names) => { const sq = normTxt(ch).replace(/\s/g, ""); return names.some((n) => sq.includes(n.replace(/\s/g, ""))); };
const brandOwned = (v, names) => channelIsBrand(v.channel, names) || mentionsBrand(v.title, names);
const stripBrand = (q, names) => { let t = ` ${normTxt(q)} `; for (const n of names) t = t.split(` ${n} `).join(" "); return t.replace(/\s+/g, " ").trim(); };
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
// what a viewer would type: the title's first words + the channel (titles are often shared between channels)
const searchQuery = (title, channel) => { const q = titleQuery(title), ch = String(channel || "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).slice(0, 4).join(" ");
  return ch && !q.toLowerCase().includes(ch.toLowerCase()) ? `${q} ${ch}` : q; };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// Fast frame source: YouTube's storyboard (the seek-bar preview thumbnails). One page fetch + a few image sheets
// (~3–5 s, no browser) instead of opening the player 12 times (~25 s). Thumbnails are small (160–320 px): enough to
// choose the moments; the boxes are placed later on the full-resolution captured frames.
async function storyboard(id, dir, L, want = 30) {
  const get = () => fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { "Accept-Language": "en", "User-Agent": UA, Cookie: "SOCS=CAI; PREF=hl=en" }, signal: AbortSignal.timeout(12000) }).then((r) => r.text());
  const html = await Promise.any([get(), sleep(3000).then(get)]);   // YouTube is sometimes slow to answer: a second request after 3 s
  const m = html.match(/"playerStoryboardSpecRenderer":\{"spec":"([^"]+)"/); if (!m) return null;
  const spec = JSON.parse('"' + m[1] + '"').split("|"), lv = spec.length - 2;
  if (lv < 2) return null;   // needs at least the 160×90 level
  const [w, , n, cols, rows, iv, name, sigh] = spec[lv + 1].split("#"); if (!+iv || !+n) return null;
  const per = cols * rows, ks = [];
  for (let i = 0; i < want; i++) { const k = Math.min(+n - 1, Math.round(L * (0.03 + 0.89 * i / (want - 1)) * 1000 / iv)); if (!ks.includes(k)) ks.push(k); }
  fs.mkdirSync(dir, { recursive: true });
  await Promise.all([...new Set(ks.map((k) => Math.floor(k / per)))].map(async (sh) => {
    const url = spec[0].replace("$L", lv).replace("$N", name.replace("$M", sh)) + "&sigh=" + sigh.replace("rs$", "rs%24");
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error("storyboard sheet " + r.status);
    const f = path.join(dir, `sheet${sh}.webp`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", f, "-vf", `untile=${cols}x${rows}`, "-q:v", "2", path.join(dir, `s${sh}_%02d.jpg`)]);
  }));
  return ks.map((k) => { const f = path.join(dir, `s${Math.floor(k / per)}_${String((k % per) + 1).padStart(2, "0")}.jpg`); return { t: +(k * iv / 1000).toFixed(1), file: f, small: f }; })
    .filter((x) => fs.existsSync(x.file));
}

// The logged-out YouTube home page looks the same for every video → captured once, reused for a few hours.
const HOME = path.join(OUT_ROOT, "_cache", "home");
const homeFresh = () => ["home.png", "home.json"].every((f) => fs.existsSync(path.join(HOME, f))) && Date.now() - fs.statSync(path.join(HOME, "home.json")).mtimeMs < 6 * 3600e3;
function useHome(dir) { if (homeFresh()) for (const f of ["home.png", "home.json"]) fs.copyFileSync(path.join(HOME, f), path.join(dir, f)); }
function keepHome(dir, pj) { if (homeFresh() || !pj.home || !fs.existsSync(path.join(dir, "home.png"))) return; fs.mkdirSync(HOME, { recursive: true }); fs.copyFileSync(path.join(dir, "home.png"), path.join(HOME, "home.png")); fs.writeFileSync(path.join(HOME, "home.json"), JSON.stringify({ home: pj.home })); }
// home / results / watch pages for a video; ok = the video shows on the first screen of results for this query
async function capturePages(id, query, dir) {
  fs.mkdirSync(dir, { recursive: true }); useHome(dir);
  await yt(["pages", id, query, dir, ""]).catch(() => {});
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "pages.json"), "utf8")); keepHome(dir, pj);
  const tg = pj.results.findIndex((r) => r.target);
  return tg >= 0 && pj.results[tg].thumb[1] <= 760;
}
// started for each candidate while the AI is still deciding, so the pages are ready when it picks
function startPages(job, id, query) {
  const dir = path.join(job.work, "pages_" + id);
  job.pagesEarly = { id, promise: capturePages(id, query, dir).then((ok) => (ok ? { dir, query } : null)).catch(() => null) };
}
// keyword highlight rects, worked out from the title's per-character rects (one rect per line, like getClientRects)
function phraseRects(watch, phrases) {
  const chars = watch.chars || [], text = chars.map((c) => c[0]).join("").toLowerCase(), out = {};
  for (const ph of phrases) {
    const i = text.indexOf(ph.toLowerCase()); if (i < 0) { out[ph] = watch.phrases?.[ph] || null; continue; }
    const lines = [];
    for (const [, x, y, w, h] of chars.slice(i, i + ph.length)) {
      if (!w) continue;
      const l = lines.find((q) => Math.abs(q.y - y) < 4);
      if (l) { l.x0 = Math.min(l.x0, x); l.x1 = Math.max(l.x1, x + w); l.h = Math.max(l.h, h); } else lines.push({ x0: x, x1: x + w, y, h });
    }
    out[ph] = lines.map((l) => [l.x0, l.y, l.x1 - l.x0, l.h]);
  }
  return out;
}
// AI boxes for the two marks, using Gemini's native detection format (box_2d, 0–1000) on the plain frame — tighter than
// a grid. Lightly padded; never slivers (min 20% × 25%), never the whole picture (max 92%). Keeps the default if the AI is out.
// With verify, the same call also checks the full-resolution frame strictly: it must really show the product category, and the
// advertised brand's own logo/product must not be in it. Failures are returned (the caller then moves to the next video).
async function placeBoxes(job, pick, files, verify = false) {
  const problems = [];
  const I = job.input, faceOk = /skin|face|make.?up|cosmetic|serum|cream|lotion|sunscreen|eyewear|glasses|lipstick|beauty/i.test(`${job.category} ${I.product || ""}`);
  await Promise.all(["visual", "object"].map(async (k) => {
    pick[k].box = pick[k].box || [0.2, 0.2, 0.6, 0.6];
    if (job.aiDown || !files[k] || !fs.existsSync(files[k])) return;
    const what = pick[k].what || "the main product";
    const check = verify ? `\n\nAlso check this full frame strictly. Product type being advertised: ${job.ptype || job.category} (any material, flavour, colour or variant of it counts). This is the ${k === "visual" ? "Visual Identify (the product category in action)" : "Object Identify (the product itself or its direct equivalent)"} moment and should show: ${what}.\n` +
      `matches = true only if the frame clearly shows that TYPE of product${k === "visual" ? " (being used, made, worn or shown in action)" : " (the product itself or its direct equivalent — an accessory, remote, box, manual or spare part is NOT the product)"} — judged at the product-type level: any material, flavour, colour or variant counts (gold rings count for silver jewellery, any ceiling fan counts for a ceiling fan). A different kind of product, an ingredient, a tool, or a scene where the product isn't clearly visible is NOT a match, whatever the description says (no stretches${k === "visual" && !faceOk ? "; a presenter's face or a talking head is NOT a match" : ""}).\n` +
      `brand_visible = true if ${I.brand}'s own logo, packaging or product is visible (the content must be independent of ${I.brand}).\nreason = one short line.` : "";
    const kwCheck = false && verify && k === "visual" && job.proposal ? `\nThe video's title is “${job.proposal.video.title}” and the keywords picked from it are: ${pick.keywords.map((x) => `“${x}”`).join(", ")}. keywords_match = true only if every keyword names that type of product (e.g. "Jewelry" or "Rings" for silver jewellery, "Ceiling Fan" for a ceiling fan, "Potato Chips" for chips) — false for words about something else in the video (a person, a place, a film, a style).` : "";
    const props = { box_2d: { type: "array", items: { type: "number" } } }, req = ["box_2d"];
    if (verify) { Object.assign(props, { matches: { type: "boolean" }, brand_visible: { type: "boolean" }, reason: { type: "string" } }); req.push("matches", "brand_visible", "reason"); }
    if (kwCheck) { props.keywords_match = { type: "boolean" }; req.push("keywords_match"); }
    try {
      const r = await ask("You detect and check objects in video frames, strictly.", `Detect ${what}. Box only that main object, tightly — not the whole scene — and leave out on-screen captions. Return box_2d as [ymin, xmin, ymax, xmax] normalised to 0-1000.${check}${kwCheck}`,
        { type: "object", additionalProperties: false, required: req, properties: props }, [{ label: `${k} frame`, file: files[k] }], "medium");
      if (verify) {
        if (r.brand_visible) problems.push(`${k}: ${I.brand}'s own product/logo is in the frame (${r.reason})`);
        else if (!r.matches) problems.push(`${k}: the full frame doesn't clearly show ${what} (${r.reason})`);
        if (kwCheck && r.keywords_match === false) problems.push(`keywords ${pick.keywords.join(", ")} don't name ${job.category}`);
      }
      if (!Array.isArray(r.box_2d) || r.box_2d.length < 4) throw new AIError("no box returned");
      const [y0, x0, y1, x1] = r.box_2d.map((v) => Math.max(0, Math.min(1, v / 1000)));
      if (!(x1 > x0 && y1 > y0)) throw new AIError("empty box");
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const w = Math.min(0.92, Math.max((x1 - x0) * 1.06, 0.2)), h = Math.min(0.92, Math.max((y1 - y0) * 1.06, 0.25));
      const x = Math.min(Math.max(0, cx - w / 2), 1 - w), y = Math.min(Math.max(0, cy - h / 2), 1 - h);
      pick[k].box = [x, y, w, h].map((v) => +v.toFixed(4));
    } catch (e) { say(job, "  box kept as default: " + String(e.message).slice(0, 120)); }   // a box is never worth failing the video
  }));
  return problems;
}

// Step B: find a premium content video where all three checks match.
// With AI (Gemini free tier or Claude) the moments and boxes are proposed; without it — or when the free quota
// runs out — the app switches to manual mode: you pick the frames, drag the boxes and choose the keywords.
async function proposeMoments(job) {
  const { brand, product, adTitle } = job.input;
  const W = job.work;
  if (!job.category) job.category = product || brand;
  if (!job.candidates) {
    const seen = new Map(); let queries;
    const names = brandNames(job.input);
    if (!job.aiDown) {
      try {
        say(job, `Planning searches for premium videos (AI: ${provider()})…`);
        const plan = await ask("You plan YouTube searches for contextual ad placement.", `${RULES}\n\nBrand: ${brand}\nProduct: ${product || "(infer it from the ad title)"}\nAd being placed: ${adTitle}\n\n` +
          `Step 1 — category: the EXACT product the ad sells, in 1–3 plain words (e.g. "ceiling fan", "potato chips", "moisturising cream", "gold jewellery", "instant noodles"). Not a mood or a theme ("summer cooling", "home comfort").\n` +
          `Step 2 — 6 YouTube search queries for premium, professional videos where THAT product is clearly on screen and is the subject (the product must be the SUBJECT of the video, not just somewhere in the room — for a ceiling fan: independent fan reviews, buying guides, an electrician installing a ceiling fan, how fans are made; for chips: chip recipes, taste tests, how chips are made; for a cream: skincare routines; for jewellery: styling guides, how jewellery is made). Avoid home tours and vlogs where the product only appears in the background. EVERY query must contain the category words. At least 3 queries should name a top professional creator, studio or media brand for that category. Never put the brand name "${brand}" (or its sub-brands) in a query.\n` +
          `Step 3 — product_type: the general kind of product, ignoring material, flavour, colour or variant (e.g. "jewellery" for silver earrings, "ceiling fan", "potato chips", "face cream", "noodles"). title_terms: 6–15 lowercase words or short phrases that name this product type in video titles, including spelling variants, plurals and close synonyms (e.g. for jewellery: jewellery, jewelry, jewels, rings, necklace, earrings, bracelet, pendant; for face cream: cream, moisturiser, moisturizer, skincare, skin care, lotion). Only names of the product itself — never activities, places or themes (not \"room makeover\", \"interior design\", \"home decor\", \"recipe\").`,
          { type: "object", additionalProperties: false, required: ["category", "product_type", "title_terms", "queries"], properties: { category: { type: "string" }, product_type: { type: "string" }, title_terms: { type: "array", items: { type: "string" } }, queries: { type: "array", items: { type: "string" } } } }, [], "medium");
        job.category = stripBrand(plan.category, names) || plan.category;
        job.ptype = stripBrand(plan.product_type, names) || job.category;
        const GENERIC_TERMS = /^(can|cans|tin|tins|box|boxes|pack|packs|packet|bottle|bottles|jar|jars|glass|cup|bag|bags|item|items|product|products|best|top|new|review|reviews|recipe|recipes|guide|how to)$/;
        job.terms = [...new Set([...plan.title_terms, job.ptype, job.category].map(normTxt).filter((t) => t.length >= 4 && !GENERIC_TERMS.test(t) && !mentionsBrand(t, names)))];
        // every query must name the product (stems: "fans" → "fan"); add plain category searches if too few are left
        const stems = normTxt(job.category).split(" ").filter((w) => w.length >= 3 && !/^(and|for|the|with|from)$/.test(w)).map((w) => w.replace(/(es|s)$/, ""));
        queries = plan.queries.map((q) => stripBrand(q, names)).filter((q) => q.length > 2 && (!stems.length || stems.some((st) => normTxt(q).includes(st))));
        for (const extra of [`${job.category} review`, `${job.category} buying guide`, `best ${job.category}`]) if (queries.length < 4) queries.push(extra);
        queries = [...new Set(queries)].slice(0, 4);   // 4 searches × 25 results — the free key allows ~100 searches a day
        job.log.push(`   product category: ${job.category} · type: ${job.ptype} · title words: ${job.terms.join(", ")}`);
      } catch (e) { if (!(e instanceof AIError)) throw e; job.aiDown = true; job.aiError = e.message; say(job, e.message); }
    }
    if (!queries?.length) { const p = stripBrand(product || brand, names) || product || brand; job.category = p; queries = [`${p} recipe`, `${p} review`, `how to use ${p}`, p]; }
    say(job, `Searching YouTube: ${queries.map((q) => `“${q}”`).join(", ")}`);
    try { for (const r of await ytJson(["searchjson", queries.join("||"), "25"])) if (!seen.has(r.id)) seen.set(r.id, r); }
    catch (e) { console.error("video search failed:", e.message); say(job, "YouTube search failed: " + e.message.slice(0, 160)); }
    const premiumScore = (r) => (r.subs || 0) / 1e6 * 2 + Math.log10((r.views || 1)) + (/[A-Z]{6,}|guarantee|never|shocking|गारंटी/i.test(r.title || "") ? -3 : 0);
    let pool = [...seen.values()].filter((r) => { const s = lenSec(r.length); return s >= 60 && s <= 1800 && isCTV(r) && (r.definition == null || r.definition === "hd"); });
    const own = pool.filter((r) => brandOwned(r, names)); pool = pool.filter((r) => !brandOwned(r, names));   // never the brand's own videos
    if (own.length) job.log.push(`   left out ${own.length} video(s) from or about ${brand} itself`);
    // premium = 1M+ subscribers and 100K+ views; when that leaves too few, 300K+ / 50K+ (still professional channels)
    const big = pool.filter((r) => r.subs == null || (r.subs >= 1e6 && r.views >= 1e5)), mid = pool.filter((r) => r.subs == null || (r.subs >= 3e5 && r.views >= 5e4));
    if (big.length >= 8) pool = big; else if (mid.length >= 3) pool = mid; else if (big.length >= 3) pool = big;
    pool.sort((x, y) => premiumScore(y) - premiumScore(x));
    job.log.push(`   ${seen.size} videos found, ${pool.length} long-form HD 16:9 videos from big channels kept`);
    const subj = (r) => (job.terms?.length && job.terms.some((t) => ` ${normTxt(r.title)} `.includes(` ${t} `) || normTxt(r.title).includes(t.length >= 5 ? t.slice(0, -1) : `${t} `)) ? 1 : 0);
    pool.sort((x, y) => subj(y) - subj(x));   // stable: videos whose title names the product come first
    job.candidates = pool.slice(0, 8);
    if (!job.aiDown) {
      try {
        say(job, `Ranking ${pool.length} candidate videos…`);
        const ranked = await ask("You choose premium YouTube videos for contextual ad placement.", `${RULES}\n\nBrand: ${brand}. Product category: ${job.category}.\nCandidates (JSON):\n${JSON.stringify(pool)}\n\nPick up to 5 candidates, best first. Rank by PRODUCTION QUALITY first (celebrity chef / professional studio / media brand; the subscriber count in "meta" helps), then by how clearly the product is the SUBJECT of the video (reviews, guides, recipes, how-it's-made — not home tours or vlogs where it is only in the background), then titles containing product-category words. Skip amateur or clickbait videos even if they have many views.`,
          { type: "object", additionalProperties: false, required: ["ids"], properties: { ids: { type: "array", items: { type: "string" } } } }, [], "medium");
        const c = [...new Set(ranked.ids)].map((id) => seen.get(id)).filter((v) => v && pool.includes(v));
        if (c.length) job.candidates = [...c, ...pool.filter((v) => !c.includes(v))].slice(0, 8);   // the AI's order first, then the rest of the pool
      } catch (e) { if (!(e instanceof AIError)) throw e; job.aiDown = true; job.aiError = e.message; say(job, e.message); }
    }
    job.tried = 0;
  }
  const fast = !job.input.review;   // automatic run: storyboard frames now, boxes later on the captured frames
  while (job.tried < job.candidates.length) {
    const cand = job.candidates[job.tried++];
    say(job, `Checking video ${job.tried}/${job.candidates.length}: “${cand.title}” (${cand.channel})`);
    let meta; try { meta = await ytJson(["meta", cand.id]); } catch { continue; }
    if (meta.size && Math.min(...meta.size) < 480) { say(job, "  skipped: low resolution"); continue; }
    { const names = brandNames(job.input);
      if (brandOwned({ title: meta.title, channel: meta.channel }, names) || mentionsBrand((meta.keywords || []).join(" "), names) || mentionsBrand(meta.description, names)) {
        say(job, `  skipped: this video is from, about or sponsored by ${brand} — it must be independent of the brand`); continue; } }
    const L = +meta.length;
    let stills = null;
    if (fast) {   // storyboard frames (seconds, no browser); the YouTube pages are captured meanwhile
      startPages(job, cand.id, searchQuery(meta.title, meta.channel));
      say(job, "  reading the video's storyboard…");
      try { const sb = await storyboard(cand.id, path.join(W, "sb", cand.id), L); if (sb && sb.length >= 12) stills = sb; }
      catch (e) { console.error("storyboard failed:", e.message); }
    }
    if (!stills) {   // full-resolution stills from the player (review mode, or no storyboard)
      const ts = [];
      for (let i = 0; i < 12; i++) ts.push(+(Math.max(2, L * 0.03) + (L * 0.9 - Math.max(2, L * 0.03)) * i / 11).toFixed(1));
      const sdir = path.join(W, "scan", cand.id); fs.mkdirSync(sdir, { recursive: true });
      say(job, "  scanning 12 frames…");
      const parts = [0, 1, 2, 3].map((k) => ts.filter((_, i) => i % 4 === k));
      await Promise.all(parts.map((p) => yt(["scan", cand.id, sdir, ...p.map(String)], { timeout: 40000 }).catch(() => {})));   // max 40 s, then the next video
      stills = ts.map((t) => ({ t, file: stillAt(sdir, t) })).filter((s) => fs.existsSync(s.file));
      if (stills.length < 7) { say(job, "  skipped: could not capture frames"); continue; }
      await Promise.all(stills.map(async (s) => { const j = s.file.replace(".png", "_s.jpg"); await run("ffmpeg", ["-loglevel", "error", "-y", "-i", s.file, "-vf", "scale=640:-2", "-q:v", "4", j]); s.small = j; }));
    }
    const thumbs = stills[0].file.includes(`${path.sep}sb${path.sep}`);
    let pick = null;
    if (!job.aiDown) {
      try {
        say(job, "  AI is checking the frames…");
        pick = await ask("You pick the moments for a contextual-ad demo, strictly.", `${RULES}\n\nBrand: ${brand}. Product category: ${job.category}. Ad: ${adTitle}\nVideo title (exact): ${meta.title}\nChannel: ${meta.channel}, ${meta.views} views, length ${L}s${meta.chapters?.length ? `\nChapters: ${JSON.stringify(meta.chapters)}` : ""}\n\nThe ${stills.length} frames above are labelled with their time in seconds${thumbs ? " (small preview thumbnails of the video at those times)" : ""}.\n` +
          `The video must be independent of ${brand}: reject (accept=false) if it is made, sponsored or promoted by ${brand}, or if ${brand}'s own products or logo are the subject. ` +
          `Decide whether this video passes the house rules. If it does, choose: open_t (a strong 2-second opening shot), visual (time + what the Visual Identify shows), object (time + the object), keyword phrases that are EXACT substrings of the title (1–3 phrases, product-category words), a 2-line keyword card (max ~10 characters per line, use \\n), an icon for each mark (one of ${ICONS.join(", ")}; use mesh only when a face is the subject), and a YouTube search query that should return this exact video near the top (use distinctive title words).` +
          ` Times must be among the labelled frame times, and open_t, visual and object must be three DIFFERENT moments at least 10 s apart. Reject (accept=false) if any of the three checks would be a stretch.`,
          { type: "object", additionalProperties: false, required: ["accept", "reason", "open_t", "visual", "object", "keywords", "card", "query", "notes"],
            properties: { accept: { type: "boolean" }, reason: { type: "string" }, open_t: { type: "number" },
              visual: { type: "object", additionalProperties: false, required: ["t", "what", "why", "icon"], properties: { t: { type: "number" }, what: { type: "string" }, why: { type: "string" }, icon: { type: "string", enum: ICONS } } },
              object: { type: "object", additionalProperties: false, required: ["t", "what", "why", "icon"], properties: { t: { type: "number" }, what: { type: "string" }, why: { type: "string" }, icon: { type: "string", enum: ICONS } } },
              keywords: { type: "array", items: { type: "string" } }, card: { type: "string" }, query: { type: "string" }, notes: { type: "string" } } },
          stills.map((s) => ({ label: `t=${s.t}s`, file: s.small })), "high");
        if (!pick.accept) { say(job, "  rejected: " + pick.reason); continue; }
        const faceOk = /skin|face|make.?up|cosmetic|serum|cream|lotion|sunscreen|eyewear|glasses|lipstick|beauty/i.test(job.category + " " + (product || ""));
        if (!faceOk && (pick.visual.icon === "mesh" || /(face|presenter|chef|host|talking|man|woman|person|smil)/i.test(pick.visual.what))) {
          const alt = stills.filter((x) => Math.abs(x.t - pick.visual.t) > 0.01);
          say(job, "  visual was a person, not the product — asking again…");
          try {
            const v2 = await ask("You pick ONE frame for a contextual-ad Visual Identify.", `Product category: ${job.category}. From the labelled frames, pick the frame where the product category itself (e.g. the food being cooked or served, the product in use) fills the picture best. NOT a face or presenter. Times must be among the labels.`,
              { type: "object", additionalProperties: false, required: ["t", "what", "icon"], properties: { t: { type: "number" }, what: { type: "string" }, icon: { type: "string", enum: ICONS.filter((x) => x !== "mesh") } } },
              alt.map((x) => ({ label: `t=${x.t}s`, file: x.small })), "high");
            pick.visual = { ...pick.visual, t: v2.t, what: v2.what, icon: v2.icon, why: "the product category on screen" };
          } catch (e) { if (!(e instanceof AIError)) throw e; }
        }
        // Visual and Object must show the product itself — never an accessory, remote, part, box or tool. One more ask;
        // if that is still an accessory (or nothing shows the product), the video is rejected.
        const ACCESSORY = /\b(remote|charger|manual|cable|wire|bracket|screws?|screwdriver|canopy|mechanism|spare|parts?|components?|accessor(y|ies)|tools?|packaging|box|carton|receipt|warranty)\b/i;
        let accessoryOnly = false;
        for (const k of ["visual", "object"]) {
          if (!ACCESSORY.test(pick[k].what || "")) continue;
          say(job, `  ${k} was an accessory, not the product — asking again…`);
          try {
            const other = k === "visual" ? pick.object.t : pick.visual.t, alt = stills.filter((x) => Math.abs(x.t - other) >= 5);
            const r2 = await ask(`You pick ONE frame for a contextual-ad ${k === "visual" ? "Visual" : "Object"} Identify.`, `Product type: ${job.ptype || job.category}. From the labelled frames, pick the frame where that product ITSELF is clearly visible${k === "visual" ? " and in use / in action" : ""} and fills a good part of the picture — not an accessory, remote, spare part, component, box, manual or tool. If no frame shows the product itself, set found=false. Times must be among the labels.`,
              { type: "object", additionalProperties: false, required: ["found", "t", "what", "icon"], properties: { found: { type: "boolean" }, t: { type: "number" }, what: { type: "string" }, icon: { type: "string", enum: ICONS.filter((x) => x !== "mesh") } } },
              alt.map((x) => ({ label: `t=${x.t}s`, file: x.small })), "high");
            if (!r2.found || ACCESSORY.test(r2.what || "")) { accessoryOnly = true; break; }
            pick[k] = { ...pick[k], t: r2.t, what: r2.what, icon: r2.icon, why: "the product itself on screen" };
          } catch (e) { if (!(e instanceof AIError)) throw e; }
        }
        if (accessoryOnly) { say(job, "  rejected: no frame shows the product itself (only accessories or parts)"); continue; }
      } catch (e) { if (!(e instanceof AIError)) throw e; job.aiDown = true; job.aiError = e.message; pick = null; say(job, e.message); }
    }
    const manual = !pick;
    if (manual) {   // starting point for manual picking
      const n = stills.length;
      pick = { open_t: stills[1].t, notes: "", query: "", keywords: [], card: "",
        visual: { t: stills[Math.floor(n * 0.35)].t, what: "", why: "", icon: "hand" },
        object: { t: stills[Math.floor(n * 0.65)].t, what: "", why: "", icon: "bowl" } };
    }
    // the face-mesh icon only for products worn on the face (skincare, make-up, eyewear)
    if (!/skin|face|make.?up|cosmetic|serum|cream|lotion|sunscreen|eyewear|glasses|lipstick|beauty/i.test(`${job.category} ${product || ""}`))
      for (const k of ["visual", "object"]) if (pick[k].icon === "mesh") pick[k].icon = "hand";
    pick.open_t = nearest(stills, pick.open_t).t;
    for (const k of ["visual", "object"]) { const s = nearest(stills, pick[k].t); pick[k].t = s.t; pick[k].still = s.file; }
    if (!manual && Math.abs(pick.visual.t - pick.object.t) < 5) { say(job, "  rejected: Visual and Object were the same moment"); continue; }
    const far = (t) => Math.abs(t - pick.visual.t) >= 8 && Math.abs(t - pick.object.t) >= 8;
    if (!far(pick.open_t)) pick.open_t = (stills.filter((x) => far(x.t) && x.t < Math.min(pick.visual.t, pick.object.t))[0] || stills.find((x) => far(x.t)) || stills[0]).t;   // opening shot: another moment
    const tl = meta.title.toLowerCase();
    const chl = String(meta.channel || "").toLowerCase();
    const chn = normTxt(meta.channel), names = brandNames(job.input);
    const namesProduct = (k) => !job.terms?.length || job.terms.some((t) => ` ${normTxt(k)} `.includes(` ${t} `) || normTxt(k).includes(t.length >= 5 ? t.slice(0, -1) : `${t} `));
    pick.keywords = (pick.keywords || []).filter((k) => k && tl.includes(k.toLowerCase()) && !chl.includes(k.toLowerCase().trim()) && !(chn && ` ${normTxt(k)} `.includes(` ${chn} `))
      && !mentionsBrand(k, names) && namesProduct(k)).slice(0, 3);   // exact title words naming the product; never the channel or the brand
    if (!manual && !pick.keywords.length) { say(job, "  rejected: no exact title keywords"); continue; }
    for (const k of ["visual", "object"]) pick[k].box = [0.2, 0.2, 0.6, 0.6];
    let q = searchQuery(meta.title, meta.channel), boxesPending = false;
    if (fast) boxesPending = !manual && !job.aiDown;   // automatic run: boxes + the final full-frame check after capture
    else {
      if (!manual && !job.aiDown) { say(job, "  AI is placing both boxes…"); await placeBoxes(job, pick, { visual: pick.visual.still, object: pick.object.still }); }
      // the search query must show this video on the first screen
      for (const tryQ of [pick.query || q, q]) {
        try { const r = await ytJson(["searchjson", tryQ, "3"]); if (r.some((x) => x.id === cand.id)) { q = tryQ; break; } } catch {}
      }
    }
    job.scan = stills;
    job.proposal = { video: { id: cand.id, title: meta.title, channel: meta.channel, views: meta.views, length: L }, pick, query: q, boxesPending,
      manual: manual || !!job.aiDown, frames: stills.map((s) => s.t), icons: ICONS };
    return true;
  }
  return false;
}

class RecheckFailed extends Error {}
// Step C: capture (moments, pages and the ad in parallel) → boxes + final check → build → render → mux
async function produce(job) {
  const W = job.work, P = job.proposal, I = job.input;
  for (const d of ["open", "visual", "object"]) fs.rmSync(path.join(W, d), { recursive: true, force: true });   // no frames from an earlier candidate
  const problems = [];   // filled by the final frame checks
  const cfg = {
    brand: I.brand, titleSuffix: "Contextual ads", logo: I.logo,
    search: { query: P.query },
    video: { id: P.video.id, tabTitle: [...P.video.title].length > 46 ? [...P.video.title].slice(0, 44).join("") + "…" : P.video.title },   // by characters: never splits an emoji
    open: { t: P.pick.open_t },
    visual: { t: P.pick.visual.t, box: P.pick.visual.box, icon: P.pick.visual.icon },
    keywords: { phrases: P.pick.keywords, card: P.pick.card },
    object: { t: P.pick.object.t, box: P.pick.object.box, icon: P.pick.object.icon },
    ad: { id: I.adId, seconds: Math.min(45, I.adSeconds || 30) },
    endcard: I.endcard && I.packs?.length ? { tagline: I.tagline || "", sub: "", color: "#111", packs: I.packs } : null,
  };
  const saveCfg = () => fs.writeFileSync(path.join(W, "config.json"), JSON.stringify(cfg, null, 1));
  saveCfg();
  say(job, "Capturing the three moments…");
  const pagesDir = path.join(W, "pages");
  const pagesTask = (async () => {   // reuse the pages captured while the AI was picking; otherwise search the title
    const early = job.pagesEarly?.id === P.video.id ? await job.pagesEarly.promise : undefined;   // null = tried, not on the first screen
    if (early) { fs.rmSync(pagesDir, { recursive: true, force: true }); fs.renameSync(early.dir, pagesDir); cfg.search.query = early.query; }
    else if (early === null || !(await capturePages(P.video.id, cfg.search.query, pagesDir))) {
      say(job, "Search didn't show the video on the first screen; retrying with more of its title…");
      cfg.search.query = `${P.video.title.split("|").slice(0, 2).join(" ").replace(/\s+/g, " ").trim().split(" ").slice(0, 10).join(" ")} ${P.video.channel}`;
      await capturePages(P.video.id, cfg.search.query, pagesDir);
    }
    const pf = path.join(pagesDir, "pages.json"), pj = JSON.parse(fs.readFileSync(pf, "utf8"));
    pj.query = cfg.search.query; pj.watch.phrases = phraseRects(pj.watch, P.pick.keywords);
    fs.writeFileSync(pf, JSON.stringify(pj, null, 1));
  })();
  const adTask = (async () => {   // the ad was recorded while the AI picked (or earlier, when you clicked it) → 25 fps frames + its sound
    if (job.adReady) await job.adReady;
    const rec = path.join(W, "ad_rec.webm"), ad = path.join(W, "ad");
    if (!fs.existsSync(rec)) await yt(["adrec", I.adId, rec]);
    fs.rmSync(ad, { recursive: true, force: true }); fs.mkdirSync(ad);
    await Promise.all([run("ffmpeg", ["-loglevel", "error", "-y", "-i", rec, "-vf", "fps=25,scale=1280:720:flags=lanczos", "-q:v", "3", path.join(ad, "%03d.jpg")]),
      run("ffmpeg", ["-loglevel", "error", "-y", "-i", rec, "-vn", "-c:a", "copy", path.join(W, "ad_audio.webm")])]);
    cfg.ad.seconds = +(fs.readdirSync(ad).filter((f) => f.endsWith(".jpg")).length / 25).toFixed(2);
  })();
  let capDone = false;
  const capTask = run(PY, [path.join(PIPE, "scripts", "capture.py"), W], { log: (l) => job.log.push("   " + l), env: { CAPTURE_SKIP_PAGES: "1", CAPTURE_SKIP_AD: "1" } })
    .finally(() => { capDone = true; });
  // each box is placed as soon as its clip is recorded (the last frame is written → the freeze frame 036 is complete)
  const boxTask = !P.boxesPending ? null : Promise.all([["visual", 76], ["object", 71]].map(async ([k, n]) => {
    const last = path.join(W, k, String(n).padStart(3, "0") + ".jpg"), freeze = path.join(W, k, "036.jpg");
    while (!fs.existsSync(last) && !capDone) await sleep(200);
    if (!fs.existsSync(last)) await capTask.catch(() => {});
    if (fs.existsSync(freeze)) { job.log.push(new Date().toLocaleTimeString() + "  AI is checking the " + k + " frame and placing its box…"); problems.push(...await placeBoxes(job, P.pick, { [k]: freeze }, true)); }
  })).then(() => { P.boxesPending = false; cfg.visual.box = P.pick.visual.box; cfg.object.box = P.pick.object.box; });
  await Promise.all([pagesTask, adTask, capTask, boxTask]);
  if (problems.length) throw new RecheckFailed(problems.join("; "));
  saveCfg();
  say(job, "Building the template…");
  await run(PY, [path.join(PIPE, "scripts", "build_ad.py"), W]);
  await renderMux(job, job.input.preview ? "preview" : "hd");
  writeTiming(job, cfg);
}
async function renderMux(job, kind) {
  const W = job.work, I = job.input, prev = kind === "preview";
  say(job, prev ? "Rendering the 720p preview (about 15 seconds)…" : "Rendering full HD (about 30 seconds)…");
  const raw = path.join(W, prev ? "out_preview_noaudio.mp4" : "out_noaudio.mp4");
  await run("node", [path.join(PIPE, "scripts", "render.js"), path.join(W, "dist", "contextual-ad.html"), raw, "25", I.hq && !prev ? "4" : (process.env.RENDER_SUBFRAMES || "1"), prev ? "0.6667" : "1"],
    { log: (l) => { const m = l.match(/frame (\d+) \/ (\d+)/); if (m) { job.step = `Rendering${prev ? " preview" : ""}… ${Math.round((100 * m[1]) / m[2])}% of frames`; job.prog.frac = m[1] / m[2]; } } });
  say(job, "Adding music and the ad's sound…");
  const final = path.join(W, `${slug(I.brand)}-contextual-ad${prev ? "-preview" : ""}.mp4`);
  const args = [path.join(PIPE, "scripts", "mux.py"), raw, fs.existsSync(path.join(W, "ad_audio.webm")) ? path.join(W, "ad_audio.webm") : "none", final];
  if (!I.music) args.push("--no-music");
  await run(PY, args);
  job.output = final; job.kind = kind; if (!prev) job.hdOutput = final;
}
function writeTiming(job, cfg) {
  const P = job.proposal, I = job.input, W = job.work;
  fs.writeFileSync(path.join(W, "TIMING.md"), `# ${I.brand} contextual ad\n\n- Content video: ${P.video.title} — ${P.video.channel} — https://www.youtube.com/watch?v=${P.video.id}\n- Ad placed: ${I.adTitle} — https://www.youtube.com/watch?v=${I.adId}\n- Search typed: “${cfg.search.query}”\n\n| Check | Time | What | Why it matches |\n|---|---|---|---|\n| Visual Identify | ${P.pick.visual.t}s | ${P.pick.visual.what} | ${P.pick.visual.why} |\n| Keywords | title | ${P.pick.keywords.join(", ")} | exact title phrases |\n| Object Identify | ${P.pick.object.t}s | ${P.pick.object.what} | ${P.pick.object.why} |\n\nNotes: ${P.pick.notes || "—"}\nThe YouTube player was captured as screenshots and recorded audio; nothing was downloaded as a file.\n`);
}

// ad recordings are cached per ad id: the same ad is never recorded twice. Recording starts as soon as an ad is
// clicked (/api/prefetch), so it is usually ready before "Make the video" is pressed.
const adRecs = new Map();   // ad id → recording in progress
function recordAd(adId) {
  const cache = path.join(OUT_ROOT, "_cache", "ads"); fs.mkdirSync(cache, { recursive: true });
  const c = path.join(cache, adId + ".webm");
  if (fs.existsSync(c) && fs.statSync(c).size >= 100000) return Promise.resolve(c);
  if (!adRecs.has(adId)) adRecs.set(adId, yt(["adrec", adId, c + ".part"]).then(() => { fs.renameSync(c + ".part", c); return c; })
    .catch((e) => { console.error("ad recording failed:", e.message); return null; }).finally(() => adRecs.delete(adId)));
  return adRecs.get(adId);
}
async function prefetchAd(adId, work) {
  const c = await recordAd(adId);
  if (c) fs.copyFileSync(c, path.join(work, "ad_rec.webm"));
}


// ---------- the brand's logo, found online (no upload needed) ----------
// 1) Wikipedia: the article's infobox logo, rendered by Wikimedia as an 800 px PNG (one request, cached on disk)
// 2) otherwise the picture of the ad's own YouTube channel — the brand's official channel, so almost always its logo
const LOGO_CACHE = path.join(OUT_ROOT, "_cache", "logos.json");
let logoCache = (() => { try { return JSON.parse(fs.readFileSync(LOGO_CACHE, "utf8")); } catch { return {}; } })();
const squash = (x) => normTxt(x).replace(/\s/g, "");
async function wikiLogo(brand) {
  const key = squash(brand), hit = logoCache[key];
  if (hit && (hit.url || Date.now() - hit.t < 24 * 3600e3)) return hit.url ? hit : null;
  let found = null;
  try {
    const q = new URLSearchParams({ format: "json", action: "query", generator: "search", gsrsearch: `${brand} brand`, gsrlimit: "5", prop: "pageimages", piprop: "thumbnail|name", pithumbsize: "800" });
    const r = await fetch("https://en.wikipedia.org/w/api.php?" + q, { headers: { "User-Agent": "ContextualAdStudio/1.0 (Mediakart contextual-ad demo tool)" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;   // rate-limited etc.: not cached, the channel picture is used instead
    const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => a.index - b.index);
    for (const pg of pages) {
      const t = squash(pg.title);
      if (!(t.startsWith(key) || key.startsWith(t))) continue;   // the brand's own article only
      if (pg.thumbnail && /logo|wordmark/i.test(pg.pageimage || "")) { found = { url: pg.thumbnail.source, source: "Wikipedia", page: pg.title }; break; }
    }
  } catch { return null; }
  logoCache[key] = { t: Date.now(), ...(found || {}) };
  try { fs.mkdirSync(path.dirname(LOGO_CACHE), { recursive: true }); fs.writeFileSync(LOGO_CACHE, JSON.stringify(logoCache)); } catch {}
  return found;
}
async function channelLogo(channelId) {
  if (!channelId) return null;
  if (!avatarCache.has(channelId) && youtubeKey()) await channelSubs([channelId]).catch(() => {});
  return avatarCache.get(channelId) || null;
}
// only from Wikimedia / YouTube image hosts (never an arbitrary address)
const LOGO_HOSTS = /^https:\/\/(thumb\.wikimedia\.org|upload\.wikimedia\.org|yt3\.ggpht\.com|yt3\.googleusercontent\.com)\//;
async function downloadLogo(url, dir) {
  if (!LOGO_HOSTS.test(url || "")) return null;
  const r = await fetch(url, { headers: { "User-Agent": "ContextualAdStudio/1.0 (Mediakart contextual-ad demo tool)" }, signal: AbortSignal.timeout(15000) });
  const type = r.headers.get("content-type") || "", ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[type.split(";")[0]];
  if (!r.ok || !ext) return null;
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 200 || buf.length > 8e6) return null;
  fs.writeFileSync(path.join(dir, "logo." + ext), buf);
  await run(PY, [path.join(PIPE, "scripts", "trim_logo.py"), path.join(dir, "logo." + ext)]).catch(() => {});   // plain borders off (channel pictures are padded squares)
  return "logo." + ext;
}

// ---------- HTTP ----------
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });
function saveData(dataUrl, file) { const m = /^data:[^;]+;base64,(.*)$/.exec(dataUrl || ""); if (!m) return null; fs.writeFileSync(file, Buffer.from(m[1], "base64")); return file; }

// Open Web contextual placement (openweb/): its own routes and data folder; if its config is broken only that tab is off
let openweb = null, openwebError = "";
try { openweb = createOpenWeb({ dataDir: path.join(OUT_ROOT, "openweb"), ask, provider, ffmpeg: (args) => run("ffmpeg", args), embed: embedTexts,
  py: (args) => run(PY, [path.join(PIPE, "scripts", args[0]), ...args.slice(1)], { timeout: 120000 }) }); }
catch (e) { openwebError = e.message; console.error("Open Web disabled:", e.message); }

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/healthz") return send(res, 200, { ok: true });
  // the MediaKart look shared by the studio pages: logo + stylesheet from assets/ (only these files)
  const brandFile = { "/brand/mediakart-logo.png": ["mediakart-logo.png", "image/png"], "/brand/mediakart.css": ["mediakart.css", "text/css; charset=utf-8"] }[u.pathname];
  if (brandFile) { res.writeHead(200, { "Content-Type": brandFile[1], "Cache-Control": "no-cache" }); return res.end(fs.readFileSync(path.join(APP, "assets", brandFile[0]))); }
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
  const viaShare = !!(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]) || !/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || "");
  const PW = sharePassword();
  if (viaShare || process.env.APP_PASSWORD) {   // people using the link must sign in; you on this PC don't
    if (!PW) { res.writeHead(503, { "Content-Type": "text/plain" }); return res.end("Sharing isn't set up yet: start share.bat on the host PC."); }
    const [, b64] = (req.headers.authorization || "").split(" ");
    const pw = b64 ? Buffer.from(b64, "base64").toString().split(":").slice(1).join(":") : "";
    if (pw !== PW) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Contextual Ad Studio"' }); return res.end("Login required"); }
  }
  try {
    if (req.method === "GET" && u.pathname === "/") return send(res, 200, fs.readFileSync(path.join(APP, "ui.html")), "text/html; charset=utf-8");
    const local = !req.headers["cf-connecting-ip"] && !req.headers["x-forwarded-for"] && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || "");
    if (u.pathname === "/openweb" || u.pathname === "/inimage" || u.pathname.startsWith("/api/ow/")) return openweb ? await openweb.handle(req, res, u, { local }) : send(res, 503, { error: "Open Web is unavailable: " + openwebError });
    if (u.pathname === "/api/status") return send(res, 200, { local, queue: waiting, hasKey: provider() !== "none", provider: provider(), youtube: youtubeKey() ? (Date.now() > ytApiDisabledUntil ? "api" : "browser (API paused)") : "browser", keyFromEnv: !!(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY), ffmpeg: !!FF || !IS_WIN, hosted: !IS_WIN, outDir: OUT_ROOT });
    if (req.method === "POST" && u.pathname === "/api/settings") { if (!local) return send(res, 403, { error: "Settings can only be changed on the computer running the app." }); const b = await body(req); const s = loadSettings(); if (b.apiKey) s.apiKey = b.apiKey.trim(); if (b.geminiKey) s.geminiKey = b.geminiKey.trim(); if (b.youtubeKey) { s.youtubeKey = b.youtubeKey.trim(); ytApiDisabledUntil = 0; } if (b.provider) s.provider = b.provider; fs.writeFileSync(SETTINGS, JSON.stringify(s)); return send(res, 200, { ok: true, provider: provider() }); }
    if (req.method === "POST" && u.pathname === "/api/ads") {   // runs in the background (share links cut requests at ~100 s)
      const b = await body(req); const id = "a" + Date.now().toString(36); adJobs[id] = { status: "running" };
      Promise.all([findAds(b), wikiLogo(b.brand).catch(() => null)]).then(([ads, logo]) => { adJobs[id] = { status: "done", logo, ads: ads.map((a) => ({ ...a, logo: avatarCache.get(a.channelId) || null })) }; }).catch((e) => { adJobs[id] = { status: "failed", error: e.message }; });
      return send(res, 200, { id });
    }
    const am = u.pathname.match(/^\/api\/ads\/(\w+)$/);
    if (am) return adJobs[am[1]] ? send(res, 200, adJobs[am[1]]) : send(res, 404, { error: "unknown search" });
    if (u.pathname === "/api/logo") {   // the logo for an ad that came without one: its channel's picture
      const id = vidOf(u.searchParams.get("adId") || ""); let url = null;
      try { if (id) url = await channelLogo((await ytJson(["meta", id])).channelId); } catch {}
      return send(res, 200, { url, source: url ? "youtube" : null });
    }
    if (req.method === "POST" && u.pathname === "/api/prefetch") {   // start recording an ad the moment it's picked
      const id = vidOf((await body(req)).adId || ""); if (id && adRecs.size < 3) recordAd(id);
      return send(res, 200, { ok: !!id });
    }
    if (req.method === "POST" && u.pathname === "/api/start") {
      const b = await body(req);
      const adId = vidOf(b.adId || b.adUrl); if (!adId) return send(res, 400, { error: "Pick an ad or paste a YouTube link." });
      if (!String(b.brand || "").trim()) return send(res, 400, { error: "Type the brand name." });
      const d0 = new Date(), z = (n) => String(n).padStart(2, "0"); const stamp = `${d0.getFullYear()}${z(d0.getMonth() + 1)}${z(d0.getDate())}-${z(d0.getHours())}${z(d0.getMinutes())}`;   // local time
      const work = path.join(OUT_ROOT, slug(b.brand), stamp); fs.mkdirSync(path.join(work, "assets"), { recursive: true });
      const assets = path.join(work, "assets"), upExt = (/^data:image\/(\w+)/.exec(b.logo || "") || [, "png"])[1].replace("jpeg", "jpg");
      let logoFile = b.logo && saveData(b.logo, path.join(assets, "logo." + upExt)) ? "logo." + upExt : null;   // uploaded by you
      const packs = (b.packs || []).map((p, i) => { const e = (/^data:image\/(\w+)/.exec(p) || [, "png"])[1].replace("jpeg", "jpg"); return saveData(p, path.join(work, "assets", `pack${i + 1}.${e}`)) ? `assets/pack${i + 1}.${e}` : null; }).filter(Boolean);
      let adTitle = b.adTitle, adSeconds, adChannel = "", adChannelId = null;
      try {
        const m = await ytJson(["meta", adId]); adTitle = adTitle || m.title; adSeconds = +m.length; adChannel = m.channel || ""; adChannelId = m.channelId || null;
        if (m.size && m.size[0] / m.size[1] < 1.5) return send(res, 400, { error: `This ad is vertical (${m.size[0]}×${m.size[1]}) — a mobile/Shorts ad. Pick a 16:9 TV / CTV commercial.` });
      } catch {}
      if (!logoFile && b.logoUrl) logoFile = await downloadLogo(b.logoUrl, assets).catch(() => null);
      if (!logoFile) { const w = await wikiLogo(b.brand).catch(() => null); if (w) logoFile = await downloadLogo(w.url, assets).catch(() => null); }
      if (!logoFile) logoFile = await downloadLogo(await channelLogo(adChannelId), assets).catch(() => null);
      if (!logoFile) return send(res, 400, { error: `Couldn't find ${b.brand}'s logo online. Use “Upload one” next to the logo to add it.` });
      let ownVideo = null;
      if (b.videoUrl) {
        const vid = vidOf(b.videoUrl); if (!vid) return send(res, 400, { error: "That content video link isn't a YouTube video link." });
        let m; try { m = await ytJson(["meta", vid]); ownVideo = { id: vid, title: m.title, channel: m.channel, length: mmss(+m.length) }; }
        catch (e) { return send(res, 400, { error: "Couldn't open that content video: " + e.message.slice(0, 120) }); }
        const names = brandNames({ brand: b.brand, adChannel, adTitle });
        if (brandOwned(m, names) || mentionsBrand((m.keywords || []).join(" "), names)) return send(res, 400, { error: `That content video is from or about ${b.brand} itself (“${m.title}” — ${m.channel}). The content video must be independent of the brand — pick another one, or leave it empty and the app finds one.` });
      }
      const job = newJob({ work, candidates: ownVideo ? [ownVideo] : undefined, tried: 0, input: { preview: b.preview !== false, review: !!b.review, hq: !!b.hq, brand: b.brand, product: b.product, adId, adChannel, adTitle: adTitle || adId, adSeconds, logo: "assets/" + logoFile, packs, endcard: !!b.endcard, tagline: b.tagline, music: b.music !== false } });
      job.adReady = prefetchAd(adId, work);   // the ad is known now → record it while the AI picks the video
      (async () => {
        try {
          const ok = await proposeMoments(job);
          if (!ok) { job.status = "failed"; say(job, "No video passed all three checks. Try a different product focus, or paste a content video link."); return; }
          if (job.input.review || job.proposal.manual) {
            if (!job.input.review && job.proposal.manual) { job.status = "approve"; say(job, (job.aiError || "The AI is unavailable right now.") + " Pick the three moments yourself below."); return; }
            job.status = "approve"; return;
          }
          const P = job.proposal; if (!P.pick.card) P.pick.card = P.pick.keywords[0].split(/\s+/).slice(0, 2).join("\n");
          say(job, `Picked: “${P.video.title}” — visual ${P.pick.visual.t}s (${P.pick.visual.what}), object ${P.pick.object.t}s (${P.pick.object.what}), keywords ${P.pick.keywords.join(", ")}`);
          job.status = "running";
          for (let attempt = 1; ; attempt++) {
            try { await queued(job, () => produce(job)); break; }
            catch (e) {
              if (!(e instanceof RecheckFailed)) throw e;
              if (attempt >= 3) { job.proposal = { ...job.proposal, manual: true, boxesPending: false }; job.status = "approve"; say(job, "No video passed every automatic check — please review the best one below. " + e.message); return; }
              say(job, "  rejected after checking the full frames — " + e.message);
              const last = job.proposal;
              if (!(await proposeMoments(job)) || job.proposal.manual) {
                job.proposal = { ...last, manual: true, boxesPending: false };
                job.status = "approve"; say(job, "No video passed every automatic check — please review the best one below (fix the moments or keywords, or try another video)."); return;
              }
              const Q = job.proposal; if (!Q.pick.card) Q.pick.card = Q.pick.keywords[0].split(/\s+/).slice(0, 2).join("\n");
              say(job, `Picked: “${Q.video.title}” — visual ${Q.pick.visual.t}s (${Q.pick.visual.what}), object ${Q.pick.object.t}s (${Q.pick.object.what}), keywords ${Q.pick.keywords.join(", ")}`);
            }
          }
          job.status = "done"; say(job, "Done — saved to " + job.output);
        }
        catch (e) { job.status = "failed"; say(job, "Error: " + e.message); }
      })();
      return send(res, 200, { id: job.id });
    }
    const jm = u.pathname.match(/^\/api\/job\/(\w+)(\/(\w+))?$/);
    if (jm && jobs[jm[1]]) {
      const job = jobs[jm[1]], act = jm[3];
      if (job.status !== "running" && !job.tEnd) job.tEnd = Date.now(); else if (job.status === "running") job.tEnd = 0;
      if (!act) return send(res, 200, { ...progressOf(job), kind: job.kind, hasHD: !!job.hdOutput, status: job.status, step: job.step, log: job.log.slice(-40), proposal: job.proposal && { ...job.proposal, pick: { ...job.proposal.pick, visual: { ...job.proposal.pick.visual, still: undefined }, object: { ...job.proposal.pick.object, still: undefined } } }, output: job.output });
      if (act === "grab" && req.method === "POST") {   // manual mode: capture an exact moment the user typed
        const t = +(await body(req)).t, P = job.proposal;
        if (!P || !(t >= 0) || t > P.video.length) return send(res, 400, { error: "Enter a time inside the video (0 – " + mmss(Math.floor(P?.video.length || 0)) + ")." });
        const have = job.scan.find((x) => Math.abs(x.t - t) < 0.05); if (have) return send(res, 200, { i: job.scan.indexOf(have), t: have.t });
        const dir = path.join(job.work, "scan", P.video.id); fs.mkdirSync(dir, { recursive: true });
        await yt(["scan", P.video.id, dir, String(t)]);
        const f = stillAt(dir, t); if (!fs.existsSync(f)) return send(res, 500, { error: "Couldn't capture that moment — try a slightly different time." });
        const small = f.replace(".png", "_s.jpg"); await run("ffmpeg", ["-loglevel", "error", "-y", "-i", f, "-vf", "scale=640:-2", "-q:v", "4", small]);
        job.scan.push({ t, file: f, small }); P.frames = job.scan.map((x) => x.t);
        return send(res, 200, { i: job.scan.length - 1, t });
      }
      if (act === "frame") { const s = job.scan?.[+u.searchParams.get("i")]; return s ? send(res, 200, fs.readFileSync(s.small), "image/jpeg") : send(res, 404, {}); }
      if (act === "still") { const k = u.searchParams.get("k"); const f = job.proposal?.pick?.[k]?.still; return f ? send(res, 200, fs.readFileSync(f), "image/png") : send(res, 404, {}); }
      if (act === "video" && job.output) {
        if (u.searchParams.get("dl") && !local) return send(res, 403, { error: "Downloads are only available on the computer running the app." });
        const file = u.searchParams.get("hd") && job.hdOutput ? job.hdOutput : job.output;
        const st = fs.statSync(file), range = req.headers.range;
        const head = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Disposition": u.searchParams.get("dl") ? `attachment; filename="${path.basename(file)}"` : "inline" };
        if (range) { const [s0, e0] = range.replace(/bytes=/, "").split("-"); const s1 = +s0, e1 = e0 ? +e0 : st.size - 1;
          res.writeHead(206, { ...head, "Content-Range": `bytes ${s1}-${e1}/${st.size}`, "Content-Length": e1 - s1 + 1 }); return fs.createReadStream(file, { start: s1, end: e1 }).pipe(res); }
        res.writeHead(200, { ...head, "Content-Length": st.size }); return fs.createReadStream(file).pipe(res);
      }
      if (act === "hd" && req.method === "POST") {   // full HD from the same captures — no AI, no re-capture
        if (job.status !== "done") return send(res, 409, { error: "Wait for the preview to finish first." });
        if (job.hdOutput) return send(res, 200, { ok: true, ready: true });
        job.status = "running"; job.hdOnly = true; job.t0 = Date.now(); job.tEnd = 0; job.prog = { a: 0, b: 2, t: Date.now(), dur: 5, stage: 3 };
        queued(job, () => renderMux(job, "hd")).then(() => { job.status = "done"; say(job, "Full HD ready — " + job.output); }).catch((e) => { job.status = "failed"; say(job, "Error: " + e.message); });
        return send(res, 200, { ok: true });
      }
      if (act === "approve" && req.method === "POST") {
        if (job.status !== "approve") return send(res, 409, { error: "This job is already " + job.status + "." });
        const e = (await body(req)).edits, P = job.proposal;
        if (e && P) {   // manual adjustments from the approval screen
          for (const k of ["visual", "object"]) if (e[k]) {
            if (e[k].t != null) { const s = nearest(job.scan, +e[k].t); P.pick[k].t = s.t; P.pick[k].still = s.file; if (k === "visual" && Math.abs(P.pick.open_t - s.t) < 3) P.pick.open_t = nearest(job.scan, Math.max(2, s.t - 60)).t; }
            if (Array.isArray(e[k].box) && e[k].box.length === 4) P.pick[k].box = e[k].box.map((v) => Math.max(0, Math.min(1, +v)));
            if (ICONS.includes(e[k].icon)) P.pick[k].icon = e[k].icon;
          }
          if (Array.isArray(e.keywords)) P.pick.keywords = e.keywords.map((k) => String(k).trim()).filter((k) => k && P.video.title.toLowerCase().includes(k.toLowerCase())).slice(0, 3);
          if (typeof e.card === "string" && e.card.trim()) P.pick.card = e.card.trim();
        }
        if (!P.pick.keywords.length) return send(res, 400, { error: "Add at least one keyword — it must be words copied exactly from the video title." });
        if (!P.pick.card) P.pick.card = P.pick.keywords[0].split(/\s+/).slice(0, 2).join("\n");
        job.status = "running";
        queued(job, () => produce(job)).then(() => { job.status = "done"; say(job, "Done — saved to " + job.output); }).catch((e) => { job.status = "failed"; say(job, "Error: " + e.message); });
        return send(res, 200, { ok: true });
      }
      if (act === "next" && req.method === "POST") {
        if (job.status !== "approve") return send(res, 409, { error: "This job is already " + job.status + "." });
        job.status = "running"; job.proposal = null;
        (async () => { try { const ok = await proposeMoments(job); job.status = ok ? "approve" : "failed"; if (!ok) say(job, "No more candidates passed all three checks."); } catch (e) { job.status = "failed"; say(job, "Error: " + e.message); } })();
        return send(res, 200, { ok: true });
      }
      if (act === "open" && job.output && IS_WIN && local) { spawn("explorer.exe", ["/select,", job.output], { detached: true }); return send(res, 200, { ok: true }); }
    }
    if (jm) return send(res, 404, { error: "That job isn't on the server any more (the app was restarted). Start again." });
    send(res, 404, { error: "not found" });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, HOST, () => {
  console.log(`Contextual Ad Studio running on ${HOST}:${PORT}`);
  if (IS_WIN && !process.env.PORT && !process.argv.includes("--no-open")) spawn("cmd", ["/c", "start", "", `http://localhost:${PORT}`], { detached: true, windowsHide: true });
});
