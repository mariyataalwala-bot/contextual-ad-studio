// Open Web contextual placement — HTTP routes (/openweb page and /api/ow/*). Mounted by server.mjs.
// Recommendation only: nothing here calls an ad server, SSP or DSP, or serves an ad.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { makeStore } from "./lib/store.mjs";
import { makeFetcher } from "./lib/fetcher.mjs";
import { parseFeed, notAnArticle } from "./lib/feeds.mjs";
import { discover, analyseUrl, recommendAll } from "./lib/pipeline.mjs";
import { normaliseCampaign, todayIST } from "./lib/campaigns.mjs";
import { loadMediaPlan, loadShowcase, refreshShowcase, creativeFiles, checkPublisherSources } from "./lib/inventory.mjs";
import { renderMock, MockError } from "./lib/mock.mjs";
import { ensureVectors } from "./lib/semantic.mjs";
import { loadStudioConfig, makeInImage, studioRefusal, sectionItems, feedFetcher, sitemapIndex } from "./lib/studio.mjs";
import { STYLES } from "./lib/strip.mjs";
import { loadBrands } from "./lib/brands.mjs";
import { makeReader } from "./lib/reader.mjs";

// A creative file the client supplies, sent from the page as a data: URL. Its type is read from the file's own bytes
// (not from the name): PNG, JPEG, GIF, WebP pictures; MP4, WebM videos. At most 40 MB.
export function clientCreative(dataUrl) {
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(String(dataUrl || ""));
  if (!m) return { error: "The client's ad file could not be read." };
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 40e6) return { error: "The client's ad file is larger than 40 MB." };
  const at = (i, s) => buf.subarray(i, i + s.length).toString("latin1") === s;
  const kind = at(0, "\x89PNG") ? ["png", "image"] : buf[0] === 0xff && buf[1] === 0xd8 ? ["jpg", "image"] : at(0, "GIF8") ? ["gif", "image"] : at(0, "RIFF") && at(8, "WEBP") ? ["webp", "image"]
    : at(4, "ftyp") ? ["mp4", "video"] : buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3 ? ["webm", "video"] : null;
  if (!kind) return { error: "The client's ad must be a PNG, JPEG, GIF or WebP picture, or an MP4 or WebM video." };
  return { buf, ext: kind[0], type: /** @type {"image"|"video"} */ (kind[1]) };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });
// a file name from the client, resolved strictly inside one folder
const inside = (root, rel) => { const f = path.resolve(root, String(rel || "")); return f.startsWith(path.resolve(root) + path.sep) ? f : null; };
const countBy = (list, key) => { const m = {}; for (const x of list) m[key(x)] = (m[key(x)] || 0) + 1; return m; };
const FILE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".json": "application/json" };

/**
 * @param {{ dataDir: string, configDir?: string, ask?: Function|null, provider?: () => string, ffmpeg?: ((args: string[]) => Promise<any>)|null, fetchImpl?: any, chromium?: any, embed?: ((texts: string[], task: string, dims: number) => Promise<number[][]>)|null, py?: ((args: string[]) => Promise<string>)|null, studioDir?: string|null, firecrawlKey?: () => string|null|undefined }} opts
 */
export function createOpenWeb({ dataDir, ask = null, provider = () => "none", ffmpeg = null, fetchImpl = globalThis.fetch, chromium = null, configDir, embed = null, py = null, studioDir = null, firecrawlKey = () => null }) {
  const cfg = loadConfig(configDir);
  const studio = loadStudioConfig(configDir);
  const brands = loadBrands(configDir);
  const studioRoot = studioDir || path.join(path.dirname(dataDir), "inimage");
  let studioBusy = null;
  const store = makeStore(dataDir);
  const pubs = new Map(cfg.publishers.publishers.map((p) => [p.id, p]));
  const jobs = {}; let busy = null;
  const job = (kind) => { const id = kind[0] + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); jobs[id] = { id, kind, status: "running", log: [], t0: Date.now() }; return jobs[id]; };
  const log = (j, m) => j.log.push(new Date().toLocaleTimeString() + "  " + m);
  // Firecrawl renders JavaScript-built pages only when a key is set (settings.json "firecrawlKey" or FIRECRAWL_API_KEY)
  const firecrawl = () => { const key = firecrawlKey(); return key ? { key } : null; };

  const findRec = (key) => { for (const a of store.getRecommendations()?.results || []) { const r = a.recommendations.find((x) => x.key === key); if (r) return r; } return null; };
  const pubOf = (a) => pubs.get(a.publisherId);
  const row = (a, recs) => {
    const top = recs.find((r) => r.status === "recommended" || r.status === "approved") || recs.find((r) => r.status === "needs_review") || null;
    const cats = [...new Set([...(a.features?.ai?.categories || []).map((c) => c.iab), ...(a.features?.lexical?.categories || []).map((c) => c.iab)])].slice(0, 3);
    return { id: a.id, url: a.url, headline: a.headline || null, publisher: pubOf(a)?.name || a.publisherId, published: a.published || null, fetchedAt: a.fetchedAt, error: a.error || null,
      safety: a.safety ? { verdict: a.safety.verdict, state: a.safety.state, reasons: a.safety.reasons } : null, ai: a.features?.ai?.status || null,
      categories: cats.map((id) => ({ id, name: cfg.taxonomy.name(id) })),
      top: top && { key: top.key, brand: top.brand, creative: top.creativeLabel, format: top.format, score: top.score, status: top.status, reasons: top.reasons.slice(0, 4) },
      counts: Object.fromEntries(["recommended", "approved", "needs_review", "excluded"].map((s) => [s, recs.filter((r) => r.status === s).length])) };
  };

  // 9×8 grayscale thumbnail of an image file (for the perceptual hash), via the app's ffmpeg; null when ffmpeg is unavailable
  const gray9x8 = ffmpeg ? async (file) => { const raw = file + ".raw"; await ffmpeg(["-loglevel", "error", "-y", "-i", file, "-vf", "scale=9:8:flags=area,format=gray", "-frames:v", "1", "-f", "rawvideo", raw]);
    try { return new Uint8Array(fs.readFileSync(raw)); } finally { try { fs.unlinkSync(raw); } catch { /* temp file */ } } } : null;
  async function ingest(j, { publisherIds, limit }) {
    const fetcher = makeFetcher({ fetchImpl });
    const reader = makeReader({ fetcher, py, firecrawl: firecrawl(), fetchImpl, tmpDir: path.join(store.root, "tmp", "read") });
    for (const pid of publisherIds) {
      const p = pubs.get(pid); if (!p) { log(j, `Unknown publisher ${pid}`); continue; }
      log(j, `${p.name}: reading feed…`);
      const d = await discover({ publisher: p, fetcher, limit });
      for (const e of d.errors) log(j, `  feed problem (${e.code}): ${e.message}`);
      log(j, `  ${d.articles.length} article(s) to analyse`);
      for (const it of d.articles) {
        const a = await analyseUrl({ url: it.url, publisher: p, fetcher, cfg, store, ask, fetchImpl, tmpDir: path.join(store.root, "tmp", "img"), gray9x8, reader });
        log(j, a.error ? `  ✗ ${it.url} — ${a.error.code}: ${a.error.message}` : `  ✓ ${a.headline.slice(0, 80)} — text ${a.extraction.status} (${a.extraction.method}) — ${a.images.filter((x) => x.status === "ok").length}/${a.images.length} image(s) usable — safety ${a.safety.verdict} (${a.safety.state}), AI ${a.features.ai.status}${a.features.ai.dropped.length ? `, ${a.features.ai.dropped.length} unverified AI claim(s) dropped` : ""}`);
      }
    }
    const sv = await ensureVectors({ store, cfg, embed });
    if (sv.added || sv.missing) log(j, `Meaning match: ${sv.added} new vector(s)${sv.missing ? `, ${sv.missing} still missing${sv.error ? " — " + sv.error : ""}` : ""}.`);
    const run = recommendAll({ store, cfg });
    log(j, `Recommendations recomputed: ${run.articles} article(s) × ${run.campaigns} campaign(s).`);
  }

  // In-Image Studio: brand + product → product found online → strip creative → relevant article picture → mock video
  function studioStart(b) {
    const brand = String(b.brand || "").trim().slice(0, 60), product = String(b.product || "").trim().slice(0, 100), offer = String(b.offer || "").trim().slice(0, 60), productImage = String(b.productImage || "").trim().slice(0, 2000);
    if (!brand || !product) return { code: 400, body: { error: "Type the brand and the product." } };
    if (productImage && !/^https:\/\//i.test(productImage)) return { code: 400, body: { error: "The product photo link must start with https://" } };
    const refusal = studioRefusal(brands, brand, product);
    if (refusal) return { code: 400, body: { error: refusal } };
    const style = STYLES.includes(b.style) ? b.style : null;
    const cc = b.clientAd ? clientCreative(b.clientAd.data) : null;
    if (cc?.error) return { code: 400, body: { error: cc.error } };
    if (!ask || provider() === "none") return { code: 400, body: { error: "The studio needs the AI key (Settings on the computer running the app)." } };
    if (!py || !ffmpeg) return { code: 503, body: { error: "Python and ffmpeg are needed on the computer running the app." } };
    if (studioBusy && jobs[studioBusy]?.status === "running") return { code: 409, body: { error: "An ad is already being made — please wait for it to finish.", id: studioBusy } };
    const d = new Date(), z = (n) => String(n).padStart(2, "0"), slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "brand";
    const rel = path.join(slug(brand), `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`);
    const workDir = path.join(studioRoot, rel); fs.mkdirSync(path.join(workDir, "assets"), { recursive: true });
    let clientAd = null;
    if (cc) { const file = path.join(workDir, "assets", "client_ad." + cc.ext); fs.writeFileSync(file, cc.buf); clientAd = { file, type: cc.type, name: String(b.clientAd.name || "").slice(0, 120), seconds: +b.clientAd.seconds || null }; }
    const j = job("studio"); Object.assign(j, { pct: 1, stage: "start", brand, product, dir: rel.replace(/\\/g, "/"), outcome: "running" }); studioBusy = j.id;
    const say = (pct, stage, msg) => { j.pct = Math.max(j.pct, pct); j.stage = stage; if (msg) log(j, msg); };
    // status stays "done" / "failed" for the page; outcome is how it ended: success · partial · needs_review · no_match · failed
    const end = (status, outcome, error) => { if (j.status !== "running") return false; Object.assign(j, { status, outcome, tEnd: Date.now() }); if (error) j.error = error; if (studioBusy === j.id) studioBusy = null; return true; };
    const ctl = new AbortController(), limitS = studio.budgetSeconds + 75;
    const dog = setTimeout(() => { ctl.abort(); if (end("failed", "failed", `Stopped: the run took longer than ${limitS} s (last step: ${j.stage}). Nothing was placed.`)) log(j, j.error); }, limitS * 1000);
    makeInImage({ brand, product, offer, productImage, style, clientAd, brands, workDir, indexDir: studioRoot, studio, cfg, store, ask, fetchImpl, py, ffmpeg, chromium, firecrawl: firecrawl(), signal: ctl.signal, say })
      .then((r) => { if (end("done", r.status || "success")) { j.result = r; j.pct = 100; log(j, `Ad ready in ${r.seconds} s (${j.outcome}${r.status === "partial" ? ": " + r.statusWhy : ""}).`); } })
      .catch((e) => { if (end("failed", e.status || "failed", e.message)) log(j, `Stopped (${j.outcome}): ` + e.message); try { fs.writeFileSync(path.join(workDir, "error.txt"), e.stack || e.message); } catch { /* best effort */ } })
      .finally(() => clearTimeout(dog));
    return { code: 200, body: { id: j.id } };
  }

  async function handle(req, res, u, { local = false } = {}) {
    if (req.method === "GET" && u.pathname === "/openweb") return send(res, 200, fs.readFileSync(path.join(HERE, "openweb.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && u.pathname === "/inimage") {
      sectionItems(studio, feedFetcher(fetchImpl)).catch(() => {});   // read the publisher feeds now, so the first mock starts warm
      for (const sm of studio.sitemaps || []) sitemapIndex(sm, feedFetcher(fetchImpl), path.join(studioRoot, "_index", sm.id + ".json"), { budget: 31 }).catch(() => {});
      return send(res, 200, fs.readFileSync(path.join(HERE, "inimage.html")), "text/html; charset=utf-8");
    }
    const p = u.pathname.slice("/api/ow".length);
    if (p === "/studio/brands") return send(res, 200, { version: brands.version, brands: brands.brands.map((b) => ({ name: b.name, category: b.category, subBrands: (b.subBrands || []).map((x) => x.name) })) });
    if (p === "/studio/start" && req.method === "POST") { const r = studioStart(await body(req)); return send(res, r.code, r.body); }
    if (p === "/studio/list") {   // earlier mocks (newest first), read back from their result.json files
      const out = [];
      try { for (const b of fs.readdirSync(studioRoot).filter((x) => !x.startsWith("_"))) for (const t of fs.readdirSync(path.join(studioRoot, b))) {
        const f = path.join(studioRoot, b, t, "result.json"); if (!fs.existsSync(f)) continue;
        try { const r = JSON.parse(fs.readFileSync(f, "utf8")); if (r.error || !r.files) continue; out.push({ dir: `${b}/${t}`, brand: r.brand, product: typeof r.product === "string" ? r.product : r.product?.name, createdAt: r.createdAt, article: r.placement?.article?.headline, url: r.placement?.article?.url, publisher: r.placement?.article?.publisher, video: r.files?.video, still: r.files?.still }); } catch { /* skip a broken record */ }
      } } catch { /* no mocks yet */ }
      return send(res, 200, out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 40));
    }
    if (p === "/studio/result") { const f = inside(studioRoot, path.join(u.searchParams.get("dir") || "", "result.json")); return f && fs.existsSync(f) ? send(res, 200, JSON.parse(fs.readFileSync(f, "utf8"))) : send(res, 404, { error: "unknown mock" }); }
    if (p === "/studio/file") {
      const f = inside(studioRoot, u.searchParams.get("path") || "");
      if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, { error: "not found" });
      const type = FILE_TYPES[path.extname(f).toLowerCase()]; if (!type) return send(res, 403, { error: "file type not served" });
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", ...(u.searchParams.get("download") ? { "Content-Disposition": `attachment; filename="${path.basename(f)}"` } : {}) });
      return fs.createReadStream(f).pipe(res);
    }
    if (p === "/status") return send(res, 200, { versions: cfg.versions, today: todayIST(), ai: provider(), dataDir: store.root, publishers: cfg.publishers.publishers.map((x) => ({ id: x.id, name: x.name, domain: x.domain, category: x.category, formats: x.formats, feeds: x.feeds })), unavailable: cfg.publishers.unavailable, busy: !!busy,
      note: "Recommendation and mock previews only. No ad server, SSP, DSP or brand-safety vendor is integrated; nothing is served." });
    if (p === "/feed") {   // a publisher's feed as a readable list (browsers download raw RSS files instead of showing them)
      const pub = pubs.get(u.searchParams.get("pub") || ""); if (!pub) return send(res, 404, { error: "Unknown publisher." });
      const fetcher = makeFetcher({ fetchImpl }), items = [], errors = [];
      for (const f of pub.feeds) {
        try { const { text } = await fetcher.get(f, "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5"); items.push(...parseFeed(text)); }
        catch (e) { errors.push(`${e.code || "ERROR"}: ${e.message}`); }
      }
      items.sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
      return send(res, 200, { publisher: pub.name, feeds: pub.feeds, errors, items: items.slice(0, 30).map((x) => ({ ...x, article: !notAnArticle(x.url) })) });
    }
    if (p === "/inventory") {
      const mp = loadMediaPlan(), sc = loadShowcase(store, cfg);
      return send(res, 200, { mediaPlan: mp.ok ? { file: mp.file, sha256: mp.sha256, modified: mp.modified, tabs: mp.tabs, sites: mp.sites.length } : mp, publisherSourceCheck: mp.ok ? checkPublisherSources(cfg.publishers.publishers, mp) : null,
        showcase: { fetchedAt: sc.fetchedAt, sha256: sc.sha256 || null, count: sc.creatives.length, byFormat: countBy(sc.creatives, (c) => c.format || "unmapped"), creatives: sc.creatives },
        creativeFiles: creativeFiles(store), creativesDir: store.dir("creatives"), formats: cfg.formats.formats });
    }
    if (p === "/inventory/refresh" && req.method === "POST") { try { return send(res, 200, await refreshShowcase(store, cfg, fetchImpl)); } catch (e) { return send(res, 502, { error: "Showcase feed: " + e.message }); } }
    if (p === "/taxonomy") { const q = (u.searchParams.get("q") || "").toLowerCase().trim(); return send(res, 200, cfg.taxonomy.all().filter((n) => !q || n.id.toLowerCase() === q || cfg.taxonomy.path(n.id).toLowerCase().includes(q)).slice(0, 40).map((n) => ({ id: n.id, path: cfg.taxonomy.path(n.id) }))); }
    if (p === "/campaigns" && req.method === "GET") return send(res, 200, store.getCampaigns());
    if (p === "/campaigns" && req.method === "POST") {
      const { campaign, problems } = normaliseCampaign(await body(req), cfg);
      for (const k of campaign.creatives) if (k.file && !fs.existsSync(path.join(store.dir("creatives"), k.file))) problems.push(`creative file ${k.file} is not in the creatives folder`);
      if (problems.length) return send(res, 400, { error: problems.join("; "), problems });
      const all = store.getCampaigns().filter((c) => c.id !== campaign.id); all.push(campaign); store.saveCampaigns(all);
      const sv = campaign.brief ? await ensureVectors({ store, cfg, embed }) : null;
      recommendAll({ store, cfg });
      return send(res, 200, { ok: true, campaign, meaning: sv });
    }
    const cm = p.match(/^\/campaigns\/([\w-]+)$/);
    if (cm && req.method === "DELETE") { store.saveCampaigns(store.getCampaigns().filter((c) => c.id !== cm[1])); recommendAll({ store, cfg }); return send(res, 200, { ok: true }); }
    if (p === "/run" && req.method === "POST") {
      if (busy) return send(res, 409, { error: "A fetch is already running.", id: busy });
      const b = await body(req), j = job("ingest"); busy = j.id;
      const publisherIds = (b.publisherIds?.length ? b.publisherIds : [...pubs.keys()]).filter((x) => pubs.has(x));
      const limit = Math.max(1, Math.min(25, +b.limit || 8));
      ingest(j, { publisherIds, limit }).then(() => { j.status = "done"; }).catch((e) => { j.status = "failed"; log(j, "Error: " + e.message); }).finally(() => { busy = null; j.tEnd = Date.now(); });
      return send(res, 200, { id: j.id });
    }
    const jm = p.match(/^\/job\/(\w+)$/);
    if (jm) return jobs[jm[1]] ? send(res, 200, jobs[jm[1]]) : send(res, 404, { error: "unknown job (the app may have restarted)" });
    if (p === "/recommend" && req.method === "POST") {
      const sv = await ensureVectors({ store, cfg, embed });   // fills in any missing meaning vectors first
      const run = recommendAll({ store, cfg });
      return send(res, 200, { ranAt: run.ranAt, articles: run.articles, campaigns: run.campaigns, meaning: sv });
    }
    if (p === "/articles") {
      const run = store.getRecommendations(), byId = new Map((run?.results || []).map((r) => [r.articleId, r.recommendations]));
      const rows = store.listArticles().map((a) => row(a, byId.get(a.id) || [])).sort((a, b) => String(b.published || b.fetchedAt).localeCompare(String(a.published || a.fetchedAt)));
      return send(res, 200, { ranAt: run?.ranAt || null, versions: cfg.versions, rows });
    }
    const am = p.match(/^\/articles\/([0-9a-f]{16})$/);
    if (am) {
      const a = store.getArticle(am[1]); if (!a) return send(res, 404, { error: "unknown article" });
      const images = (a.images || []).map((s) => { const im = store.getImage(s.id); return im && { ...im, ...(im.uses?.[a.id] || {}), uses: undefined, otherArticles: (im.articleIds || []).filter((x) => x !== a.id).length }; }).filter(Boolean);
      const recs = (store.getRecommendations()?.results || []).find((r) => r.articleId === a.id)?.recommendations || [];
      const named = (list) => list.map((c) => ({ ...c, name: cfg.taxonomy.path(c.iab) }));
      return send(res, 200, { images, article: { ...a, features: a.features && { ...a.features, lexical: { ...a.features.lexical, categories: named(a.features.lexical.categories) }, ai: { ...a.features.ai, categories: named(a.features.ai.categories || []) } } }, recommendations: recs, publisher: pubOf(a) || null });
    }
    if (p === "/review" && req.method === "POST") {
      const b = await body(req), r = findRec(b.key);
      if (!r) return send(res, 404, { error: "unknown recommendation" });
      if (!["needs_review", "approved"].includes(r.status) && !(r.status === "excluded" && r.reasons[0] === "REVIEW_REJECTED")) return send(res, 409, { error: `Only items waiting for review can be reviewed (this one is ${r.status}). Excluded pages can't be approved.` });
      if (!["approve", "reject"].includes(b.decision)) return send(res, 400, { error: "decision must be approve or reject" });
      if (!String(b.by || "").trim() || !String(b.why || "").trim()) return send(res, 400, { error: "Add your name and the reason for the decision." });
      const a = store.getArticle(r.articleId);
      store.addReview({ key: r.key, decision: b.decision, by: String(b.by).trim(), why: String(b.why).trim(), at: new Date().toISOString(), contentHash: a.contentHash, safetyVersion: cfg.versions.safety, safetyReasons: a.safety.reasons, local });
      recommendAll({ store, cfg });
      return send(res, 200, { ok: true, recommendation: findRec(r.key) });
    }
    if (p === "/mock" && req.method === "POST") {
      const b = await body(req), r = findRec(b.key);
      if (!r) return send(res, 404, { error: "unknown recommendation" });
      if (!["recommended", "approved"].includes(r.status)) return send(res, 409, { error: `Mocks are only made for recommended or approved placements (this one is ${r.status}).` });
      const campaign = store.getCampaigns().find((c) => c.id === r.campaignId), creative = campaign?.creatives.find((k) => k.id === r.creativeId);
      if (!creative?.file) return send(res, 409, { error: "This creative has no source file yet. Put the file in the creatives folder and pick it in the campaign." });
      const file = inside(store.dir("creatives"), creative.file); if (!file || !fs.existsSync(file)) return send(res, 409, { error: `Source creative ${creative.file} is not in the creatives folder.` });
      const a = store.getArticle(r.articleId), j = job("mock");
      const outBase = path.join(store.dir("mocks"), `${a.id}_${r.campaignId}_${r.creativeId}`.replace(/[^\w-]/g, "_"));
      log(j, `Opening ${a.url} in a phone browser…`);
      renderMock({ articleUrl: a.url, leadImage: a.image?.url, creativeFile: file, format: r.format, outBase, video: !!b.video, ffmpeg, chromium })
        .then((out) => {
          const meta = { mock: true, label: "MOCK — not a live placement", article: { url: a.url, headline: a.headline, fetchedAt: a.fetchedAt, contentHash: a.contentHash }, campaign: campaign.id, brand: campaign.brand, creative: { id: creative.id, file: creative.file, format: r.format },
            score: r.score, status: r.status, reasons: r.reasons, slot: out.slot, viewport: out.viewport, renderedAt: new Date().toISOString(), versions: cfg.versions };
          fs.writeFileSync(outBase + ".json", JSON.stringify(meta, null, 1));
          Object.assign(j, { status: "done", files: [out.png, out.mp4 || out.webm].filter(Boolean).map((f) => path.basename(f)) }); log(j, `Saved ${j.files.join(", ")} (${out.slot.how})`);
        })
        .catch((e) => { j.status = "failed"; log(j, (e instanceof MockError ? e.code + ": " : "Error: ") + e.message); });
      return send(res, 200, { id: j.id });
    }
    if (p === "/file") {
      const kind = u.searchParams.get("kind"), root = kind === "mock" ? store.dir("mocks") : kind === "creative" ? store.dir("creatives") : null;
      const f = root && inside(root, u.searchParams.get("f")); if (!f || !fs.existsSync(f)) return send(res, 404, { error: "not found" });
      const t = FILE_TYPES[path.extname(f).toLowerCase()]; if (!t) return send(res, 415, { error: "unsupported file type" });
      if (u.searchParams.get("dl") && !local) return send(res, 403, { error: "Downloads are only available on the computer running the app." });
      res.writeHead(200, { "Content-Type": t, "Cache-Control": "no-store", ...(u.searchParams.get("dl") ? { "Content-Disposition": `attachment; filename="${path.basename(f)}"` } : {}) });
      return fs.createReadStream(f).pipe(res);
    }
    if (p === "/mocks") {
      const dir = store.dir("mocks"), files = fs.readdirSync(dir);
      return send(res, 200, files.filter((f) => f.endsWith(".json")).map((f) => {
        const base = f.slice(0, -5), m = store.readJson(path.join(dir, f), null);
        return m && { ...m, files: files.filter((x) => x.startsWith(base + ".") && !x.endsWith(".json")) };
      }).filter(Boolean).sort((a, b) => b.renderedAt.localeCompare(a.renderedAt)));
    }
    return send(res, 404, { error: "not found" });
  }
  return { handle, cfg, store };
}
