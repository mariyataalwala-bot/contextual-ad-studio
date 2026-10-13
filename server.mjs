// Contextual Ad Studio — local app. Type a brand, pick the ad, approve the three checks, get the MP4.
// Start with start.bat (or: node server.mjs). Opens http://localhost:4777
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

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

// ---------- settings / Claude client ----------
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch { return {}; } };
function claude() {
  const key = loadSettings().apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Add your Claude API key in Settings first.");
  return new Anthropic({ apiKey: key });
}
// One structured-JSON call. Images are [{label, file}] JPEG/PNG paths.
async function ask(system, text, schema, images = [], effort = "high") {
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
const ytJson = async (args) => { const s = (await yt(args)).trim(); const i = [s.indexOf("["), s.indexOf("{")].filter((x) => x >= 0); return JSON.parse(s.slice(Math.min(...i))); };
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
const vidOf = (s) => (String(s).match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/) || String(s).match(/^([A-Za-z0-9_-]{11})$/) || [])[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lenSec = (l) => { const p = String(l || "").split(":").map(Number); return p.some(isNaN) ? 0 : p.reduce((a, b) => a * 60 + b, 0); };

// ---------- jobs ----------
const jobs = {};
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

// Step A: find the brand's official ads
async function findAds({ brand, product }) {
  const qs = [`${brand} ad`, `${brand} TVC`, `${brand} ${product || ""} ad`.replace(/\s+/g, " ").trim(), `${brand} official commercial`];
  const seen = new Map();
  for (const q of [...new Set(qs)]) {
    try { for (const r of await ytJson(["searchjson", q, "12"])) if (!seen.has(r.id)) seen.set(r.id, r); } catch {}
  }
  const list = [...seen.values()].filter((r) => { const s = lenSec(r.length); return s >= 6 && s <= 90; });
  if (!list.length) return [];
  const pick = await ask(
    "You help an ad agency find a brand's own official TV/YouTube commercials.",
    `Brand: ${brand}${product ? `\nProduct focus: ${product}` : ""}\nYouTube results (JSON):\n${JSON.stringify(list)}\n\n` +
      `Return up to 6 that are the brand's OWN official commercials (uploaded by the brand's or its parent company's official channel; not reactions, reviews, compilations or fan uploads). Prefer recent ads that show the product clearly. Rank best first, and say in one short line why each fits.`,
    { type: "object", additionalProperties: false, required: ["ads"],
      properties: { ads: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "why"], properties: { id: { type: "string" }, why: { type: "string" } } } } } },
    [], "medium");
  return pick.ads.map((a) => ({ ...seen.get(a.id), why: a.why })).filter((a) => a.id);
}

// Step B: find a premium content video where all three checks match
async function proposeMoments(job) {
  const { brand, product, adTitle } = job.input;
  const W = job.work;
  if (!job.candidates) {
    say(job, "Planning searches for premium videos…");
    const plan = await ask("You plan YouTube searches for contextual ad placement.", `${RULES}\n\nBrand: ${brand}\nProduct: ${product || "(infer from the ad)"}\nAd being placed: ${adTitle}\n\nGive 6 YouTube search queries likely to surface premium, professional videos where this product category is clearly on screen (recipes, routines, tutorials, reviews...). Also state the product category in a few words.`,
      { type: "object", additionalProperties: false, required: ["category", "queries"], properties: { category: { type: "string" }, queries: { type: "array", items: { type: "string" } } } }, [], "medium");
    job.category = plan.category;
    const seen = new Map();
    for (const q of plan.queries.slice(0, 6)) {
      say(job, `Searching YouTube: “${q}”`);
      try { for (const r of await ytJson(["searchjson", q, "10"])) if (!seen.has(r.id)) seen.set(r.id, { ...r, query: q }); } catch {}
    }
    const pool = [...seen.values()].filter((r) => { const s = lenSec(r.length); return s >= 60 && s <= 1800; });
    say(job, `Ranking ${pool.length} candidate videos…`);
    const ranked = await ask("You choose premium YouTube videos for contextual ad placement.", `${RULES}\n\nBrand: ${brand}. Product category: ${plan.category}.\nCandidates (JSON):\n${JSON.stringify(pool)}\n\nPick up to 5 candidates, best first: professional channels, the product category clearly the subject (it should appear on screen), titles containing product-category words.`,
      { type: "object", additionalProperties: false, required: ["ids"], properties: { ids: { type: "array", items: { type: "string" } } } }, [], "high");
    job.candidates = ranked.ids.map((id) => seen.get(id)).filter(Boolean);
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
    const stills = ts.map((t) => ({ t, file: path.join(sdir, `f_${String(Math.round(t * 10)).padStart(5, "0")}.png`) })).filter((s) => fs.existsSync(s.file));
    if (stills.length < 8) { say(job, "  skipped: could not capture frames"); continue; }
    for (const s of stills) { const j = s.file.replace(".png", "_s.jpg"); await run("ffmpeg", ["-loglevel", "error", "-y", "-i", s.file, "-vf", "scale=640:-2", "-q:v", "4", j]); s.small = j; }
    const pick = await ask("You pick the moments for a contextual-ad demo, strictly.", `${RULES}\n\nBrand: ${brand}. Product category: ${job.category}. Ad: ${adTitle}\nVideo title (exact): ${meta.title}\nChannel: ${meta.channel}, ${meta.views} views, length ${L}s${meta.chapters?.length ? `\nChapters: ${JSON.stringify(meta.chapters)}` : ""}\n\nThe ${stills.length} frames above are labelled with their time in seconds.\n` +
      `Decide whether this video passes the house rules. If it does, choose: open_t (a strong 2-second opening shot), visual (time + what the Visual Identify shows), object (time + the object), keyword phrases that are EXACT substrings of the title (1–3 phrases, product-category words), a 2-line keyword card (max ~10 characters per line, use \\n), an icon for each mark (one of ${ICONS.join(", ")}; use mesh only when a face is the subject), and a YouTube search query that should return this exact video near the top (use distinctive title words).` +
      ` Times must be among the labelled frame times. Reject (accept=false) if any of the three checks would be a stretch.`,
      { type: "object", additionalProperties: false, required: ["accept", "reason", "open_t", "visual", "object", "keywords", "card", "query", "notes"],
        properties: { accept: { type: "boolean" }, reason: { type: "string" }, open_t: { type: "number" },
          visual: { type: "object", additionalProperties: false, required: ["t", "what", "why", "icon"], properties: { t: { type: "number" }, what: { type: "string" }, why: { type: "string" }, icon: { type: "string", enum: ICONS } } },
          object: { type: "object", additionalProperties: false, required: ["t", "what", "why", "icon"], properties: { t: { type: "number" }, what: { type: "string" }, why: { type: "string" }, icon: { type: "string", enum: ICONS } } },
          keywords: { type: "array", items: { type: "string" } }, card: { type: "string" }, query: { type: "string" }, notes: { type: "string" } } },
      stills.map((s) => ({ label: `t=${s.t}s`, file: s.small })), "high");
    if (!pick.accept) { say(job, "  rejected: " + pick.reason); continue; }
    const tl = meta.title.toLowerCase();
    pick.keywords = pick.keywords.filter((k) => k && tl.includes(k.toLowerCase())).slice(0, 3);
    if (!pick.keywords.length) { say(job, "  rejected: no exact title keywords"); continue; }
    // precise boxes on the two freeze frames
    const fdir = path.join(W, "freeze", cand.id); fs.mkdirSync(fdir, { recursive: true });
    await yt(["scan", cand.id, fdir, String(pick.visual.t), String(pick.object.t)]);
    const ff = (t) => path.join(fdir, `f_${String(Math.round(t * 10)).padStart(5, "0")}.png`);
    for (const k of ["visual", "object"]) {
      const f = ff(pick[k].t); if (!fs.existsSync(f)) throw new Error("could not capture the freeze frame");
      const g = f.replace(".png", "_grid.jpg");
      await run("ffmpeg", ["-loglevel", "error", "-y", "-i", f, "-vf", "drawgrid=w=iw/10:h=ih/10:t=1:c=yellow@0.8", "-q:v", "3", g]);
      const b = await ask("You place a highlight box on a video frame.", `Draw a tight box around: ${pick[k].what}.\nThe yellow grid lines are every 10% of width and height. Return the box as fractions of the frame: x, y (top-left) and w, h, all between 0 and 1. Keep it on the subject; leave out on-screen captions where possible.`,
        { type: "object", additionalProperties: false, required: ["x", "y", "w", "h"], properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } } },
        [{ label: `${k} frame`, file: g }], "medium");
      const c = (v) => Math.max(0, Math.min(1, v));
      pick[k].box = [c(b.x), c(b.y), Math.min(c(b.w), 1 - c(b.x)), Math.min(c(b.h), 1 - c(b.y))];
      pick[k].still = f;
    }
    // the search query must show this video on the first screen
    let q = pick.query;
    for (const tryQ of [q, meta.title.split(/[|\-–(]/)[0].trim().split(/\s+/).slice(0, 8).join(" ")]) {
      try { const r = await ytJson(["searchjson", tryQ, "3"]); if (r.some((x) => x.id === cand.id)) { q = tryQ; break; } } catch {}
    }
    job.proposal = { video: { id: cand.id, title: meta.title, channel: meta.channel, views: meta.views, length: L }, pick, query: q };
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
  await run("node", [path.join(PIPE, "scripts", "render.js"), path.join(W, "dist", "contextual-ad.html"), raw, "25", "4"], { log: (l) => { const m = l.match(/frame (\d+) \/ (\d+)/); if (m) job.step = `Rendering… ${Math.round((100 * m[1]) / m[2])}%`; } });
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
  if (PASSWORD) {   // basic auth so a public URL can't spend your API key
    const [, b64] = (req.headers.authorization || "").split(" ");
    const pw = b64 ? Buffer.from(b64, "base64").toString().split(":").slice(1).join(":") : "";
    if (pw !== PASSWORD) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Contextual Ad Studio"' }); return res.end("Login required"); }
  }
  try {
    if (req.method === "GET" && u.pathname === "/") return send(res, 200, fs.readFileSync(path.join(APP, "ui.html")), "text/html; charset=utf-8");
    if (u.pathname === "/api/status") return send(res, 200, { hasKey: !!(loadSettings().apiKey || process.env.ANTHROPIC_API_KEY), keyFromEnv: !!process.env.ANTHROPIC_API_KEY, ffmpeg: !!FF || !IS_WIN, hosted: !IS_WIN, outDir: OUT_ROOT });
    if (req.method === "POST" && u.pathname === "/api/settings") { const b = await body(req); const s = loadSettings(); if (b.apiKey) s.apiKey = b.apiKey.trim(); fs.writeFileSync(SETTINGS, JSON.stringify(s)); return send(res, 200, { ok: true }); }
    if (req.method === "POST" && u.pathname === "/api/ads") { const b = await body(req); return send(res, 200, { ads: await findAds(b) }); }
    if (req.method === "POST" && u.pathname === "/api/start") {
      const b = await body(req);
      const adId = vidOf(b.adId || b.adUrl); if (!adId) return send(res, 400, { error: "Pick an ad or paste a YouTube link." });
      const work = path.join(OUT_ROOT, slug(b.brand)); fs.mkdirSync(path.join(work, "assets"), { recursive: true });
      const logoExt = (/^data:image\/(\w+)/.exec(b.logo || "") || [, "png"])[1].replace("jpeg", "jpg");
      if (!saveData(b.logo, path.join(work, "assets", "logo." + logoExt))) return send(res, 400, { error: "Upload the brand logo." });
      const packs = (b.packs || []).map((p, i) => { const e = (/^data:image\/(\w+)/.exec(p) || [, "png"])[1].replace("jpeg", "jpg"); return saveData(p, path.join(work, "assets", `pack${i + 1}.${e}`)) ? `assets/pack${i + 1}.${e}` : null; }).filter(Boolean);
      let adTitle = b.adTitle, adSeconds;
      try { const m = await ytJson(["meta", adId]); adTitle = adTitle || m.title; adSeconds = +m.length; } catch {}
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
      if (act === "still") { const k = u.searchParams.get("k"); const f = job.proposal?.pick?.[k]?.still; return f ? send(res, 200, fs.readFileSync(f), "image/png") : send(res, 404, {}); }
      if (act === "video" && job.output) { const st = fs.statSync(job.output); res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": st.size, "Content-Disposition": u.searchParams.get("dl") ? `attachment; filename="${path.basename(job.output)}"` : "inline" }); return fs.createReadStream(job.output).pipe(res); }
      if (act === "approve" && req.method === "POST") {
        job.status = "running";
        (async () => { try { await produce(job); job.status = "done"; say(job, "Done — saved to " + job.output); } catch (e) { job.status = "failed"; say(job, "Error: " + e.message); } })();
        return send(res, 200, { ok: true });
      }
      if (act === "next" && req.method === "POST") {
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
