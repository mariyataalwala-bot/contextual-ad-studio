// Pipeline and HTTP routes with a fake network (no real requests are made).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { makeFetcher } from "../../openweb/lib/fetcher.mjs";
import { discover, analyseUrl, recommendAll, refreshDerived } from "../../openweb/lib/pipeline.mjs";
import { makeStore } from "../../openweb/lib/store.mjs";
import { createOpenWeb } from "../../openweb/routes.mjs";
import { cfg, html, fakeAsk, FILLER } from "./helpers.mjs";

const FOOD_PARAS = ["Oats adai is a savoury breakfast recipe made with oats, paneer and vegetables, cooked on a hot pan.", "The dish is quick, the ingredients are simple and the flavour suits a healthy breakfast.", FILLER, FILLER];
const SITE = {
  "https://www.news18.com/robots.txt": [200, "User-agent: *\nDisallow: /blocked/\n"],
  "https://www.news18.com/commonfeeds/v1/eng/rss/food.xml": [200, `<rss><channel>
    <item><link>https://www.news18.com/food/oats-adai-1.html</link><title>Oats</title></item>
    <item><link>https://www.news18.com/blocked/secret-2.html</link><title>Blocked by robots</title></item>
    <item><link>https://www.news18.com/web-stories/story-3/</link><title>Web story</title></item>
    <item><link>https://elsewhere.example.test/food/x.html</link><title>Other domain</title></item>
    <item><link>https://www.news18.com/food/gone-4.html</link><title>Gone</title></item>
  </channel></rss>`],
  "https://www.news18.com/food/oats-adai-1.html": [200, html({ headline: "Oats adai recipe for a healthy breakfast", paras: FOOD_PARAS })],
  "https://www.news18.com/food/gone-4.html": [404, "not found"],
  "https://blocked.example.test/robots.txt": [403, "<html><title>Access Denied</title></html>"],
};
/** @returns {any} */
function fakeFetch() {
  const seen = [];
  const fn = async (url) => {
    seen.push(url);
    const [status, body] = SITE[url] || [404, ""];
    return { ok: status < 400, status, url, headers: { get: () => "text/html" }, arrayBuffer: async () => Buffer.from(body), text: async () => body };
  };
  fn.seen = seen;
  return fn;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "owdata-"));
const noWait = { gapMs: 0, sleep: async () => {} };
const AI = { categories: [{ iab: "216", quote: "Oats adai is a savoury breakfast recipe" }], sensitive: [], sentiment: "positive", entities: [] };

test("discovery: same-domain articles only, web stories skipped", async () => {
  const fetchImpl = fakeFetch();
  const d = await discover({ publisher: cfg.publishers.publishers.find((p) => p.id === "news18-food"), fetcher: makeFetcher({ fetchImpl, ...noWait }) });
  assert.deepEqual(d.articles.map((a) => a.url), ["https://www.news18.com/food/oats-adai-1.html", "https://www.news18.com/blocked/secret-2.html", "https://www.news18.com/food/gone-4.html"]);
});
test("robots.txt is honoured: a disallowed article is never requested", async () => {
  const fetchImpl = fakeFetch(), store = makeStore(tmp());
  const a = await analyseUrl({ url: "https://www.news18.com/blocked/secret-2.html", publisher: { id: "news18-food" }, fetcher: makeFetcher({ fetchImpl, ...noWait }), cfg, store, ask: null });
  assert.equal(a.error.code, "ROBOTS");
  assert.ok(!fetchImpl.seen.includes("https://www.news18.com/blocked/secret-2.html"));
});
test("bot protection is reported as BLOCKED, not worked around", async () => {
  const fetchImpl = fakeFetch(), store = makeStore(tmp());
  const a = await analyseUrl({ url: "https://blocked.example.test/a", publisher: { id: "x" }, fetcher: makeFetcher({ fetchImpl, ...noWait }), cfg, store, ask: null });
  assert.equal(a.error.code, "BLOCKED");
  assert.deepEqual(fetchImpl.seen, ["https://blocked.example.test/robots.txt"]);
});
test("end to end: analyse → store evidence → recommend; only publisher hosts are contacted", async () => {
  const fetchImpl = fakeFetch(), dir = tmp(), store = makeStore(dir);
  const fetcher = makeFetcher({ fetchImpl, ...noWait }), publisher = cfg.publishers.publishers.find((p) => p.id === "news18-food");
  const ok = await analyseUrl({ url: "https://www.news18.com/food/oats-adai-1.html", publisher, fetcher, cfg, store, ask: fakeAsk(AI) });
  const gone = await analyseUrl({ url: "https://www.news18.com/food/gone-4.html", publisher, fetcher, cfg, store, ask: fakeAsk(AI) });
  assert.equal(ok.safety.verdict, "safe"); assert.equal(ok.features.ai.status, "ok"); assert.match(ok.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(gone.error.code, "HTTP_404");
  store.saveCampaigns([{ id: "c1", brand: "Catch", product: "Garam masala", status: "active", start: "2026-10-01", end: "2026-12-31", creatives: [{ id: "cr1", label: "Catch in-image", format: "in-image", file: "" }],
    targeting: { iab: ["210"], keywords: ["recipe", "breakfast"], objects: [] }, exclusions: { competitors: [], keywords: [], iab: [] } }]);
  const run = recommendAll({ store, cfg, now: new Date("2026-10-26T06:30:00Z") });
  assert.deepEqual(run.versions, cfg.versions);
  const top = run.results.find((r) => r.articleId === ok.id).recommendations[0];
  assert.equal(top.status, "recommended");
  assert.equal(run.results.find((r) => r.articleId === gone.id).recommendations[0].reasons[0], "FETCH_FAILED:HTTP_404");
  for (const u of fetchImpl.seen) assert.ok(/^https:\/\/(www\.news18\.com|img\.example\.test)\//.test(u), "unexpected host contacted: " + u);
  assert.ok(fs.existsSync(path.join(dir, "articles", ok.id + ".json")) && fs.existsSync(path.join(dir, "recommendations.json")));
});
test("no campaigns → no recommendations (campaigns first)", async () => {
  const store = makeStore(tmp()), fetchImpl = fakeFetch();
  await analyseUrl({ url: "https://www.news18.com/food/oats-adai-1.html", publisher: { id: "news18-food" }, fetcher: makeFetcher({ fetchImpl, ...noWait }), cfg, store, ask: fakeAsk(AI) });
  const run = recommendAll({ store, cfg });
  assert.equal(run.results[0].recommendations.length, 0);
});

// ---------- HTTP routes ----------
async function serve(ow) {
  const srv = http.createServer((req, res) => ow.handle(req, res, new URL(req.url, "http://x"), { local: true }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(null)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  const call = async (p, method = "GET", body) => { const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null), type: r.headers.get("content-type") }; };
  return { srv, call };
}
test("routes: status, page, campaign validation, review and mock guards, file path safety", async () => {
  const dir = tmp(), ow = createOpenWeb({ dataDir: dir, fetchImpl: fakeFetch() });
  const { srv, call } = await serve(ow);
  try {
    const st = await call("/api/ow/status");
    assert.equal(st.status, 200); assert.match(st.json.note, /No ad server/); assert.equal(st.json.publishers.length, 4);
    assert.match((await call("/openweb")).type, /text\/html/);
    const bad = await call("/api/ow/campaigns", "POST", { brand: "X", status: "active", start: "2026-10-01", end: "2026-12-31", creatives: [{ format: "in-image", file: "missing.mp4" }], targeting: { iab: ["210"] } });
    assert.equal(bad.status, 400); assert.match(bad.json.error, /not in the creatives folder/);
    fs.writeFileSync(path.join(dir, "creatives", "catch.png"), "x");
    const good = await call("/api/ow/campaigns", "POST", { brand: "Catch", status: "active", start: "2026-10-01", end: "2026-12-31", creatives: [{ id: "cr1", format: "in-image", file: "catch.png" }], targeting: { iab: ["210"], keywords: "recipe, breakfast" } });
    assert.equal(good.status, 200); assert.deepEqual(good.json.campaign.targeting.keywords, ["recipe", "breakfast"]);
    assert.equal((await call("/api/ow/review", "POST", { key: "nope", decision: "approve", by: "a", why: "b" })).status, 404);
    assert.equal((await call("/api/ow/mock", "POST", { key: "nope" })).status, 404);
    assert.equal((await call("/api/ow/file?kind=creative&f=" + encodeURIComponent("../campaigns.json"))).status, 404);
    assert.equal((await call("/api/ow/file?kind=creative&f=catch.png")).type, "image/png");
    assert.equal((await call("/api/ow/taxonomy?q=skin care")).json[0].id, "559");
  } finally { srv.close(); }
});
test("routes: an excluded placement can't be reviewed or mocked; needs_review can't be mocked", async () => {
  const dir = tmp(), store = makeStore(dir);
  const mk = (key, status) => ({ key, status, articleId: "0123456789abcdef", campaignId: "c1", creativeId: "cr1", reasons: [status === "excluded" ? "SAFETY_HEADLINE:I4GWl6" : "NEEDS_REVIEW"], gates: [] });
  store.saveRecommendations({ results: [{ articleId: "0123456789abcdef", recommendations: [mk("k-ex", "excluded"), mk("k-rv", "needs_review")] }] });
  const { srv, call } = await serve(createOpenWeb({ dataDir: dir, fetchImpl: fakeFetch() }));
  try {
    const r1 = await call("/api/ow/review", "POST", { key: "k-ex", decision: "approve", by: "QA", why: "looks fine" });
    assert.equal(r1.status, 409); assert.match(r1.json.error, /can't be approved/);
    assert.equal((await call("/api/ow/review", "POST", { key: "k-rv", decision: "approve", by: "", why: "" })).status, 400);
    assert.equal((await call("/api/ow/mock", "POST", { key: "k-ex" })).status, 409);
    assert.equal((await call("/api/ow/mock", "POST", { key: "k-rv" })).status, 409);
  } finally { srv.close(); }
});

test("stored articles are re-derived when the safety policy version changes", async () => {
  const store = makeStore(tmp()), fetchImpl = fakeFetch();
  const a = await analyseUrl({ url: "https://www.news18.com/food/oats-adai-1.html", publisher: { id: "news18-food" }, fetcher: makeFetcher({ fetchImpl, ...noWait }), cfg, store, ask: fakeAsk(AI) });
  assert.equal(refreshDerived(a, cfg), false, "same versions: nothing to do");
  a.versions = { ...a.versions, safety: "safety.v1" }; a.safety = { verdict: "excluded", state: "unsafe", reasons: ["OLD"], evidence: [] };
  store.saveArticle(a);
  recommendAll({ store, cfg });
  const b = store.getArticle(a.id);
  assert.equal(b.versions.safety, cfg.versions.safety); assert.equal(b.safety.verdict, "safe"); assert.ok(b.versions.rederivedAt);
});
