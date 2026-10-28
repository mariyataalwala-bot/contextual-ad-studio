// Article reading: the right article object, clean text, fallbacks (Next.js data, Trafilatura, Firecrawl), retries,
// time limits, and how a studio run ends. All page HTML here is synthetic test data shaped like the pages that failed
// (the URLs are the real failing pages; the text is made up) — not real publisher content.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractArticle, garbled, EXTRACT_VERSION } from "../../openweb/lib/extract.mjs";
import { makeReader, firecrawlHtml } from "../../openweb/lib/reader.mjs";
import { makeFetcher, FetchError } from "../../openweb/lib/fetcher.mjs";
import { makeStore } from "../../openweb/lib/store.mjs";
import { loadStudioConfig, makeInImage, StudioStop } from "../../openweb/lib/studio.mjs";
import { cfg } from "./helpers.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mk-reader-"));
const SENT = (n, topic) => Array.from({ length: n }, (_, i) => `Sentence ${i + 1} about ${topic} has enough words to read like a real paragraph of the story.`).join(" ");
const page = ({ ld = [], head = "", body = "", next = null }) => `<!doctype html><html lang="en"><head>${head}${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join("")}</head><body>${body}${next ? `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>` : ""}</body></html>`;
const noWait = { gapMs: 0, sleep: async () => {} };
// a fetcher stub: url → html, or an error code to throw
const stubFetcher = (map, seen = []) => ({ get: async (url) => { seen.push(url); const v = map[url]; if (v instanceof FetchError) throw v; if (typeof v === "function") return v(); return { text: v, finalUrl: url }; } });

// ---------- mid-day: JSON-LD body without punctuation; the whole story only in __NEXT_DATA__ ----------
const MIDDAY = "https://www.mid-day.com/lifestyle/travel/article/new-cleartrip-report-reveals-more-gen-z-are-booking-flights-for-travel-getaways-this-festive-season-23657390";
const midClean = `The festive season is underway and many people are taking a break. Interestingly, festive travel is moving to India’s smaller cities. ${SENT(30, "festive travel")}`;
const midGarbled = midClean.replace(/[.,]/g, "").replace(/’/g, "rsquo").replace(/ Interestingly/, "Interestingly");
const midLd = { "@context": "https://schema.org", "@type": "NewsArticle", headline: "More Gen-Z are booking flights this festive season", articleBody: midGarbled, url: MIDDAY };
test("mid-day: a JSON-LD body that lost its punctuation is not used; the full story comes from the page's __NEXT_DATA__", () => {
  assert.ok(garbled(midGarbled)); assert.ok(!garbled(midClean));
  const next = { props: { pageProps: { related: [{ body: `<p>${SENT(50, "a cricket match")}</p>` }], initialArticleDetailData: [{ Id: "23657390", body: midClean.split(". ").map((s) => `<p>${s}.</p>`).join("") }] } } };
  const a = extractArticle(page({ ld: [midLd], head: `<link rel="canonical" href="${MIDDAY}">`, body: `<h1>${midLd.headline}</h1><p>${midClean.slice(0, 140)}</p><button>Read More</button>`, next }), MIDDAY);
  assert.equal(a.source, "next-data");
  assert.equal(a.extraction.status, "complete");
  assert.match(a.body, /India's smaller cities\./, "punctuation and apostrophes intact (norm() straightens quotes)");
  assert.ok(!/cricket/.test(a.body), "a longer related story in the same JSON is never taken: it does not start like this article");
  assert.match(a.extraction.notes[0], /lost its punctuation/);
});
test("mid-day without usable page data: Trafilatura's shorter text is used and the article is marked partial — nothing is filled in", () => {
  const html = page({ ld: [midLd], body: `<h1>${midLd.headline}</h1><p>${midClean.slice(0, 300)}</p>` });
  const a = extractArticle(html, MIDDAY, { clean: { ok: true, title: midLd.headline, text: `${midLd.headline}\n${midClean.slice(0, 900)}` } });
  assert.equal(a.source, "trafilatura");
  assert.equal(a.extraction.status, "partial");
  assert.match(a.extraction.notes.join(" "), /only \d+ of about \d+ characters/);
  assert.ok(a.body.length <= 900, "the body is only what could be read");
});

// ---------- indulgexpress: related-story headlines appended to the JSON-LD body after the sign-off ----------
test("indulgexpress: the related-story headlines after the 'join/follow our channels' sign-off are cut from the body", () => {
  const url = "https://www.indulgexpress.com/entertainment/cinema/2026/Oct/28/shah-rukh-khans-king-poster";
  const articleBody = `${SENT(20, "a film poster")} For more updates, join/follow our WhatsApp, Telegram and YouTube channels..Actor once helped another get bail in the 1990s`;
  const a = extractArticle(page({ ld: [{ "@type": "NewsArticle", headline: "Poster draws comparisons", articleBody, url }] }), url);
  assert.equal(a.source, "json-ld");
  assert.ok(!/bail|join\/follow/.test(a.body), a.body.slice(-120));
  assert.match(a.body, /Sentence 20 about a film poster/);
});

// ---------- asianet: NewsArticle without articleBody; page paragraphs carry promos; Trafilatura text has link lines ----------
test("asianet: no JSON-LD body → Trafilatura's text, minus related-story link lines and the app promo paragraph", () => {
  const url = "https://newsable.asianetnews.com/lifestyle/how-to-remove-sticker-glue-from-new-utensils";
  const html = page({ ld: [{ "@type": "NewsArticle", headline: "How to remove sticker glue from new utensils", url }],
    body: `<h1>How to remove sticker glue from new utensils</h1><p>${SENT(12, "sticker glue")}</p><ul><li><a href="/lifestyle/smart-tvs-under-budget">Smart Entertainment on a Budget: TVs for small rooms</a></li></ul><p>Explore the latest Lifestyle News covering fashion and food. Download the Asianet News Official App from the Android Play Store and iPhone App Store for everything.</p>` });
  const clean = { ok: true, title: "How to remove sticker glue from new utensils", text: `How to remove sticker glue from new utensils\n${SENT(12, "sticker glue")}\n- Smart Entertainment on a Budget: TVs for small rooms\n${SENT(6, "warm water")}\nExplore the latest Lifestyle News covering fashion and food. Download the Asianet News Official App from the Android Play Store and iPhone App Store for everything.` };
  const plain = extractArticle(html, url);
  assert.equal(plain.source, "html-paragraphs", "without Trafilatura the page paragraphs are the fallback");
  const a = extractArticle(html, url, { clean });
  assert.equal(a.source, "trafilatura");
  assert.ok(!/Smart Entertainment|Asianet News Official App|Explore the latest/.test(a.body), a.body.slice(-160));
  assert.match(a.body, /warm water/);
});

// ---------- article identification ----------
test("the page's own article object is used, not a related story listed first in the page's JSON-LD; its paywall flag counts", () => {
  const url = "https://indianexpress.com/article/lifestyle/food-wine/monsoon-snacks-10900001/";
  const related = { "@type": "NewsArticle", headline: "Premium: a subscriber story", articleBody: SENT(20, "something else"), url: "https://indianexpress.com/article/other-10900002/", isAccessibleForFree: false };
  const own = { "@type": "NewsArticle", headline: "Five monsoon snacks", articleBody: SENT(20, "monsoon snacks"), mainEntityOfPage: { "@id": url }, isAccessibleForFree: true };
  const a = extractArticle(page({ ld: [related, own], head: `<link rel="canonical" href="${url}">` }), url + "?utm_source=feed");
  assert.equal(a.headline, "Five monsoon snacks");
  assert.match(a.body, /monsoon snacks/);
  assert.equal(a.free, true, "the other story's isAccessibleForFree: false does not make this one a paywalled page");
  assert.equal(a.canonical, url);
  assert.equal(a.extraction.version, EXTRACT_VERSION);
});
test("a page with only a headline is 'headline_only'; an empty page is 'none' — nothing is invented", () => {
  assert.equal(extractArticle(page({ head: `<meta property="og:title" content="Monsoon snack ideas">`, body: `<div id="root"></div>` }), "https://x.test/a").extraction.status, "headline_only");
  const e = extractArticle(page({ body: `<div id="root"></div>` }), "https://x.test/b");
  assert.equal(e.extraction.status, "none"); assert.equal(e.headline, ""); assert.equal(e.body, "");
});

// ---------- reader: retries, time limits, one read at a time, Trafilatura and Firecrawl only when needed ----------
const URL1 = "https://www.news18.com/food/sargi-thali-10401294.html";
const full = page({ ld: [{ "@type": "NewsArticle", headline: "Sargi thali ideas", articleBody: SENT(20, "sargi"), url: URL1 }] });
test("reader: one network hiccup is retried once; a refusal (403 / bot check) or robots.txt is never retried", async () => {
  let n = 0; const seen = [];
  const r = makeReader({ fetcher: stubFetcher({ [URL1]: () => { if (n++ === 0) throw new FetchError("NETWORK", "reset"); return { text: full, finalUrl: URL1 }; } }, seen), sleep: async () => {} });
  assert.equal((await r.read(URL1)).article.headline, "Sargi thali ideas"); assert.equal(seen.length, 2);
  for (const code of ["BLOCKED", "ROBOTS", "HTTP_404"]) {
    const s2 = [], r2 = makeReader({ fetcher: stubFetcher({ [URL1]: new FetchError(code, code) }, s2), sleep: async () => {} });
    await assert.rejects(r2.read(URL1), (/** @type {any} */ e) => e.code === code); assert.equal(s2.length, 1, code + " must not be retried");
  }
});
test("reader: a page that never answers ends with TIMEOUT instead of holding the run; two callers share one read", async () => {
  const slow = makeReader({ fetcher: { get: () => new Promise(() => {}) }, timeoutMs: 50 });
  await assert.rejects(slow.read(URL1), (/** @type {any} */ e) => e.code === "TIMEOUT");
  const seen = [], r = makeReader({ fetcher: stubFetcher({ [URL1]: full }, seen) });
  const [a, b] = await Promise.all([r.read(URL1), r.read(URL1 + "#top")]);
  assert.equal(seen.length, 1); assert.equal(a.article.headline, b.article.headline);
});
test("reader: Trafilatura runs only when the page's metadata has no complete article text", async () => {
  const calls = [], py = async (args) => { calls.push(args[0]); return JSON.stringify({ ok: true, title: "T", text: SENT(20, "clean text") }); };
  await makeReader({ fetcher: stubFetcher({ [URL1]: full }), py }).read(URL1);
  assert.equal(calls.length, 0, "a complete JSON-LD body needs no second extractor");
  const shell = page({ ld: [{ "@type": "NewsArticle", headline: "Sargi thali ideas", url: URL1 }], body: `<p>${SENT(3, "teaser")}</p>` });
  const { article } = await makeReader({ fetcher: stubFetcher({ [URL1]: shell }), py }).read(URL1);
  assert.deepEqual(calls, ["article_text.py"]); assert.equal(article.source, "trafilatura");
});

const SHELL = page({ head: `<meta property="og:title" content="Sargi thali ideas">`, body: `<div id="app"></div>` });
const fakeFirecrawl = (calls) => async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return new Response(JSON.stringify({ success: true, data: { rawHtml: full, metadata: { statusCode: 200, url: URL1 } } }), { status: 200 }); };
test("reader: a page built by JavaScript is rendered by Firecrawl (basic proxy only) when a key is set; without a key it stays headline-only", async () => {
  const calls = [];
  const { article } = await makeReader({ fetcher: stubFetcher({ [URL1]: SHELL }), firecrawl: { key: "fc-test" }, fetchImpl: fakeFirecrawl(calls) }).read(URL1);
  assert.equal(calls.length, 1); assert.equal(calls[0].body.proxy, "basic"); assert.deepEqual(calls[0].body.formats, ["rawHtml"]);
  assert.equal(article.extraction.method, "firecrawl+json-ld"); assert.equal(article.extraction.status, "complete");
  const none = await makeReader({ fetcher: stubFetcher({ [URL1]: SHELL }), fetchImpl: fakeFirecrawl(calls) }).read(URL1);
  assert.equal(none.article.extraction.status, "headline_only"); assert.equal(calls.length, 1);
});
test("reader: refused, robots-disallowed and paywalled pages never go to Firecrawl", async () => {
  const calls = [], fc = { key: "fc-test" }, fetchImpl = fakeFirecrawl(calls);
  for (const code of ["BLOCKED", "ROBOTS"]) await assert.rejects(makeReader({ fetcher: stubFetcher({ [URL1]: new FetchError(code, code) }), firecrawl: fc, fetchImpl, sleep: async () => {} }).read(URL1));
  const paywalled = page({ ld: [{ "@type": "NewsArticle", headline: "Subscriber story", url: URL1, isAccessibleForFree: false }] });
  const { article } = await makeReader({ fetcher: stubFetcher({ [URL1]: paywalled }), firecrawl: fc, fetchImpl }).read(URL1);
  assert.equal(article.free, false); assert.equal(calls.length, 0);
  assert.equal(await firecrawlHtml(URL1, { key: "k", fetchImpl: async () => new Response(JSON.stringify({ success: true, data: { rawHtml: "x", metadata: { statusCode: 403 } } })) }), null, "a page Firecrawl itself was refused is not used");
});

// ---------- studio: explicit endings instead of holds ----------
const IE = "https://indianexpress.com/article/lifestyle/food-wine/";
/** @param {{ shortlist: any[], articleHtml: string, signal?: AbortSignal }} o */
function studioRun({ shortlist, articleHtml, signal }) {
  const id = "t-" + Math.random().toString(36).slice(2, 8), dir = tmp();
  const studio = { ...loadStudioConfig(), sitemaps: [], sections: [{ id, name: "Test section", domain: "indianexpress.com", feeds: [`https://indianexpress.com/section/${id}/feed/`], formats: { "in-image": "test" } }] };
  const items = [1, 2].map((i) => ({ url: `${IE}monsoon-snack-ideas-${10900000 + i}/`, title: `Monsoon snack ideas ${i}` }));
  const feed = `<?xml version="1.0"?><rss><channel>${items.map((x) => `<item><title>${x.title}</title><link>${x.url}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
  const fetchImpl = async (u) => {
    if (u.endsWith("/robots.txt")) return new Response("", { status: 404 });
    if (u.includes("/feed/")) return new Response(feed, { status: 200 });
    if (items.some((x) => x.url === u)) return new Response(articleHtml, { status: 200 });
    return new Response("", { status: 404 });
  };
  const ask = async (system) => /help find articles/.test(system) ? { words: ["snack", "monsoon"], competitors: [] }
    : /plan contextual/.test(system) ? { category: "snacks", audience: "", contexts: [], avoid: [], competitors: [], headline: "", subline: "", cta: "Shop now", shortlist } : (() => { throw new Error("no further AI step expected"); })();
  const client = path.join(dir, "ad.png"); fs.writeFileSync(client, "x");
  const work = path.join(dir, "brand", "run"); fs.mkdirSync(work, { recursive: true });
  const run = makeInImage({ brand: "Testbrand", product: "snack", studio, cfg, store: makeStore(path.join(dir, "data")), ask, fetchImpl, workDir: work, indexDir: dir, signal,
    py: async () => JSON.stringify({ ok: false }), ffmpeg: async () => {}, clientAd: { file: client, type: "image" } });
  return { run, result: () => JSON.parse(fs.readFileSync(path.join(work, "result.json"), "utf8")) };
}
test("studio: no fitting article → 'no_match' (an honest no), written to result.json", { timeout: 30000 }, async () => {
  const { run, result } = studioRun({ shortlist: [], articleHtml: full });
  await assert.rejects(run, (e) => e instanceof StudioStop && e.status === "no_match");
  assert.equal(result().status, "no_match");
});
test("studio: fitting articles whose text can't be read → 'needs_review' with the articles listed; nothing is placed", { timeout: 30000 }, async () => {
  const { run, result } = studioRun({ shortlist: [{ n: 1, why: "monsoon snacks" }, { n: 2, why: "snacks" }], articleHtml: SHELL });
  await assert.rejects(run, (/** @type {any} */ e) => e.status === "needs_review" && /could not be read well enough/.test(e.message));
  const r = result();
  assert.equal(r.status, "needs_review"); assert.equal(r.reviewArticles.length, 2); assert.ok(!r.placement);
  assert.match(r.reviewArticles[0].problem, /brand safety can't be checked/);
});
test("studio: a run stopped by the app's time limit ends as 'failed' at its next step", { timeout: 30000 }, async () => {
  const ctl = new AbortController(); ctl.abort();
  const { run, result } = studioRun({ shortlist: [], articleHtml: full, signal: ctl.signal });
  await assert.rejects(run, (/** @type {any} */ e) => e.status === "failed" && /time limit/.test(e.message));
  assert.equal(result().status, "failed");
});
test("mid-day's feed links Health & Fitness stories as …/health-&-fitness/… (a 404): read at …/health-and-fitness/… only when that page's canonical says so", async () => {
  const bad = "https://www.mid-day.com/lifestyle/health-&-fitness/article/can-you-have-tea-coffee-or-beverages-while-fasting-mumbai-dietitians-share-important-fasting-tips-for-beverages-23657372";
  const good = bad.replace("-&-", "-and-"), gone = new FetchError("HTTP_404", "404");
  const own = page({ head: `<link rel="canonical" href="${good}">`, ld: [{ "@type": "NewsArticle", headline: "Fasting and beverages", articleBody: SENT(20, "fasting"), url: good }] });
  const seen = [], { finalUrl, article } = await makeReader({ fetcher: stubFetcher({ [bad]: gone, [good]: own }, seen) }).read(bad);
  assert.equal(finalUrl, good); assert.equal(article.headline, "Fasting and beverages"); assert.match(article.extraction.notes.join(" "), /site's own address/);
  const other = page({ head: `<link rel="canonical" href="https://www.mid-day.com/some-other-story-1">`, ld: [{ "@type": "NewsArticle", headline: "Another story", articleBody: SENT(20, "x") }] });
  await assert.rejects(makeReader({ fetcher: stubFetcher({ [bad]: gone, [good]: other }) }).read(bad), (/** @type {any} */ e) => e.code === "HTTP_404");
  await assert.rejects(makeReader({ fetcher: stubFetcher({ [URL1]: gone }) }).read(URL1), (/** @type {any} */ e) => e.code === "HTTP_404", "other 404s stay 404s");
});
test("the studio's fetcher still honours robots.txt through the reader", async () => {
  const seen = [], fetchImpl = async (u) => { seen.push(u); return u.endsWith("robots.txt") ? new Response("User-agent: *\nDisallow: /private/", { status: 200 }) : new Response(full, { status: 200 }); };
  const r = makeReader({ fetcher: makeFetcher({ fetchImpl, ...noWait }) });
  await assert.rejects(r.read("https://site.test/private/a"), (/** @type {any} */ e) => e.code === "ROBOTS");
  assert.deepEqual(seen, ["https://site.test/robots.txt"]);
});
