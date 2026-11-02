// 2-in-1 contextual ads — HTTP routes (/twoinone page, /api/ow/twoinone/*). Mounted by routes.mjs, which hands over
// the pieces it already has (config, store, AI, discovery, job registry). Preview only: nothing here serves an ad.
import fs from "node:fs";
import path from "node:path";
import { findBrand } from "./lib/brands.mjs";
import { studioRefusal, StudioStop } from "./lib/studio.mjs";
import { makeTwoInOne, discoverVideoCandidates, downloadVideo, cfgOf, youtubeId, TWO_VERSION } from "./lib/twoinone.mjs";
import { PREVIEW_CSP } from "./lib/twoinone-preview.mjs";

const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "brand";

/** @param {Record<string, any>} d */
export function createTwoInOne(d) {
  const { studio, brands, cfg, store, ask, provider, py, ffmpeg, chromium, campaignsFor, fetchImpl, fcFor, firecrawl, findAds, ytDetails, jobs, job, log, send, body, inside, FILE_TYPES, HERE, root, studioRoot, clientCreative } = d;
  const tcfg = cfgOf(studio), seenRecords = new Map();   // the search records of the last candidate lookups (title, channel, length)
  let busy = null; const finding = new Map();             // one run at a time; one lookup per brand+product at a time
  const needAi = () => (!ask || provider() === "none" ? "The 2-in-1 tool needs the AI key (Settings on the computer running the app)." : null);

  // ---- step 1 (YouTube route): the verified candidates for a brand + product ----
  function find(b) {
    const brand = String(b.brand || "").trim().slice(0, 60), product = String(b.product || "").trim().slice(0, 100);
    if (!brand) return { code: 400, body: { error: "Type the brand." } };
    const refusal = studioRefusal(brands, brand, product); if (refusal) return { code: 400, body: { error: refusal } };
    const key = `${brand}|${product}`.toLowerCase();
    if (finding.has(key) && jobs[finding.get(key)]?.status === "running") return { code: 200, body: { id: finding.get(key) } };   // no duplicate search
    const j = job("twofind"); Object.assign(j, { pct: 5, brand, product }); finding.set(key, j.id);
    const known = findBrand(brands, brand, product);
    const dog = setTimeout(() => { if (j.status === "running") { j.status = "failed"; j.error = "The YouTube search took too long and was stopped. Try again."; log(j, j.error); } }, 90000);
    discoverVideoCandidates({ brand, product, known, cfg: tcfg, cacheFile: path.join(studioRoot, "_index", "twoinone-candidates.json"), details: ytDetails,
      findAds: async (q) => { const r = await findAds(q); for (const v of r) seenRecords.set(v.id, v); return r; }, say: (m) => log(j, m) })
      .then((r) => { if (j.status !== "running") return; for (const c of r.candidates) if (!seenRecords.has(c.id)) seenRecords.set(c.id, { id: c.id, title: c.title, channel: c.channel, length: c.length, aspect: 1.78 });   // a lookup served from the cache has the records too
        j.candidates = r; j.status = "done"; j.pct = 100; log(j, `${r.candidates.length} verified, ${r.rejected.length} turned away${r.cached ? " (from the last search)" : ""}.`); })
      .catch((e) => { if (j.status !== "running") return; j.status = "failed"; j.error = String(e.message).slice(0, 300); log(j, "Stopped: " + j.error); })
      .finally(() => { clearTimeout(dog); j.tEnd = Date.now(); });
    return { code: 200, body: { id: j.id } };
  }

  // ---- step 2: the run (a client file, a client link, or a chosen candidate) ----
  function start(b) {
    const brand = String(b.brand || "").trim().slice(0, 60), product = String(b.product || "").trim().slice(0, 100);
    if (!brand || !product) return { code: 400, body: { error: "Type the brand and the product." } };
    const refusal = studioRefusal(brands, brand, product); if (refusal) return { code: 400, body: { error: refusal } };
    const nA = needAi(); if (nA) return { code: 400, body: { error: nA } };
    if (!py || !ffmpeg) return { code: 503, body: { error: "Python and ffmpeg are needed on the computer running the app." } };
    if (busy && jobs[busy]?.status === "running") return { code: 409, body: { error: "A 2-in-1 preview is already being made — please wait for it to finish.", id: busy } };
    const cv = b.clientVideo ? clientCreative(b.clientVideo.data) : null;
    if (cv && (cv.error || cv.type !== "video")) return { code: 400, body: { error: cv?.error || "The client's video must be an MP4 or WebM file." } };
    const dp = b.display ? clientCreative(b.display.data) : null;
    if (dp && (dp.error || dp.type !== "image")) return { code: 400, body: { error: dp?.error || "The display panel must be a PNG, JPEG, GIF or WebP picture." } };
    const link = String(b.videoUrl || "").trim(), yid = youtubeId(b.youtubeId || link);
    if (!cv && !yid && !link) return { code: 400, body: { error: "Upload the client's video, paste its link, or pick one of the YouTube ads found." } };
    if (!cv && !yid && !/^https?:\/\//i.test(link)) return { code: 400, body: { error: "The video link must start with https://" } };
    const d0 = new Date(), z = (n) => String(n).padStart(2, "0");
    const dirRel = `${slug(brand)}/${d0.getFullYear()}${z(d0.getMonth() + 1)}${z(d0.getDate())}-${z(d0.getHours())}${z(d0.getMinutes())}${z(d0.getSeconds())}`;
    const workDir = path.join(root, dirRel); fs.mkdirSync(path.join(workDir, "assets"), { recursive: true });
    const known = findBrand(brands, brand, product);
    const j = job("twoinone"); Object.assign(j, { pct: 1, stage: "start", brand, product, dir: dirRel, outcome: "running" }); busy = j.id;
    const say = (pct, stage, msg) => { j.pct = Math.max(j.pct, pct); j.stage = stage; if (msg) log(j, msg); };
    const end = (status, outcome, error) => { if (j.status !== "running") return false; Object.assign(j, { status, outcome, tEnd: Date.now() }); if (error) j.error = error; if (busy === j.id) busy = null; return true; };
    const ctl = new AbortController(), limitS = tcfg.budgetSeconds + 60;
    const dog = setTimeout(() => { ctl.abort(); if (end("failed", "failed", `Stopped: the run took longer than ${limitS} s (last step: ${j.stage}). Nothing was placed.`)) log(j, j.error); }, limitS * 1000);
    (async () => {
      let video;
      // the brand's recent campaigns (verified on dated trade-press pages; needs a Firecrawl key): the product pictures are matched to them
      const camp = await Promise.resolve(campaignsFor ? campaignsFor(brand) : null).catch(() => null);
      const campaigns = (camp?.verified || []).slice(0, 4).map((c) => c.name || String(c.title || "").slice(0, 80)).filter(Boolean);
      if (cv) { const file = path.join(workDir, "assets", "upload." + cv.ext); fs.writeFileSync(file, cv.buf); video = { kind: "file", file, name: String(b.clientVideo.name || "").slice(0, 120) }; }
      else if (yid) video = { kind: "youtube", id: yid, clientSupplied: !b.youtubeId, record: seenRecords.get(yid) || null };
      else { say(3, "video", "Downloading the video from the link…"); const r = await downloadVideo(link, path.join(workDir, "assets", "upload"), { fetchImpl, maxBytes: tcfg.maxClientBytes }).catch((e) => { throw new StudioStop("failed", e.message); }); video = { kind: "file", file: r.file, name: path.basename(new URL(link).pathname) || "video" }; }
      let displayFile = null; if (dp) { displayFile = path.join(workDir, "assets", "display." + dp.ext); fs.writeFileSync(displayFile, dp.buf); }
      return makeTwoInOne({ brand, product, known, studio, cfg, store, ask, py, ffmpeg, fetchImpl, fc: fcFor(), firecrawlOpt: firecrawl(), indexDir: studioRoot, roots: [studioRoot, root], workDir, say, signal: ctl.signal,
        video, displayFile, ytDetails, confirmBrand: !!b.confirmBrand, chromium, campaigns, fileUrl: (rel) => "/api/ow/twoinone/file?path=" + encodeURIComponent(dirRel + "/" + rel) });
    })()
      .then((r) => { if (end("done", "success")) { j.result = r; j.pct = 100; log(j, `2-in-1 preview ready in ${r.seconds} s.`); } })
      .catch((e) => { if (end("failed", e.status || "failed", e.message)) log(j, `Stopped (${j.outcome}): ${e.message}`); try { if (!fs.existsSync(path.join(workDir, "result.json"))) fs.writeFileSync(path.join(workDir, "result.json"), JSON.stringify({ version: TWO_VERSION, brand, product, status: e.status || "failed", error: e.message, createdAt: new Date().toISOString() })); } catch { /* best effort */ } })
      .finally(() => clearTimeout(dog));
    return { code: 200, body: { id: j.id } };
  }

  const readResult = (dir) => { const f = inside(root, path.join(dir || "", "result.json")); return f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; };

  /** @returns {Promise<boolean>} true when the request was a 2-in-1 route (and was answered) */
  async function handle(req, res, u) {
    const p = u.pathname;
    if (req.method === "GET" && p === "/twoinone") { send(res, 200, fs.readFileSync(path.join(HERE, "twoinone.html")), "text/html; charset=utf-8"); return true; }
    if (!p.startsWith("/api/ow/twoinone/")) return false;
    const r = p.slice("/api/ow/twoinone".length);
    if (r === "/candidates" && req.method === "POST") { const x = find(await body(req)); send(res, x.code, x.body); return true; }
    if (r === "/start" && req.method === "POST") { const x = start(await body(req)); send(res, x.code, x.body); return true; }
    if (r === "/list") {   // earlier previews that were placed, newest first
      const out = [];
      try { for (const b of fs.readdirSync(root).filter((x) => !x.startsWith("_"))) for (const t of fs.readdirSync(path.join(root, b))) {
        let x; try { x = JSON.parse(fs.readFileSync(path.join(root, b, t, "result.json"), "utf8")); } catch { continue; }
        if (x.status !== "success" || !x.placement) continue;
        out.push({ dir: `${b}/${t}`, brand: x.brand, product: x.product, source: x.sourceLabel, article: x.placement.article.headline, publisher: x.placement.article.publisher, score: x.placement.match.score, createdAt: x.createdAt, thumb: x.files?.still || x.files?.hero || null });
      } } catch { /* none yet */ }
      send(res, 200, out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 40)); return true;
    }
    if (r === "/result") { const x = readResult(u.searchParams.get("dir")); send(res, x ? 200 : 404, x || { error: "unknown preview" }); return true; }
    if (r === "/preview") {   // the page, with its own strict Content-Security-Policy
      const f = inside(root, path.join(u.searchParams.get("dir") || "", "preview.html"));
      if (!f || !fs.existsSync(f)) { send(res, 404, { error: "unknown preview" }); return true; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": PREVIEW_CSP, "X-Content-Type-Options": "nosniff" });
      fs.createReadStream(f).pipe(res); return true;
    }
    if (r === "/file") {
      const f = inside(root, u.searchParams.get("path") || "");
      if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) { send(res, 404, { error: "not found" }); return true; }
      const type = FILE_TYPES[path.extname(f).toLowerCase()]; if (!type) { send(res, 403, { error: "file type not served" }); return true; }
      const size = fs.statSync(f).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");   // video needs byte ranges to play and seek
      if (m && type.startsWith("video/")) { const a = m[1] ? +m[1] : 0, e = m[2] ? Math.min(+m[2], size - 1) : size - 1;
        if (a > e || a >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return true; }
        res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${a}-${e}/${size}`, "Accept-Ranges": "bytes", "Content-Length": e - a + 1, "Cache-Control": "no-store" }); fs.createReadStream(f, { start: a, end: e }).pipe(res); return true; }
      res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-store", ...(u.searchParams.get("download") ? { "Content-Disposition": `attachment; filename="${path.basename(f)}"` } : {}) }); fs.createReadStream(f).pipe(res); return true;
    }
    return false;
  }
  return { handle };
}
