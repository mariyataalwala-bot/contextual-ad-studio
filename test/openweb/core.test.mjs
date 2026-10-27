import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, validateConfig, CONFIG_DIR } from "../../openweb/lib/config.mjs";
import { termRegex, findTerm, quoteFound, sentenceAt, norm, termHits } from "../../openweb/lib/text.mjs";
import { parseRobots, robotsAllows, parseFeed, notAnArticle } from "../../openweb/lib/feeds.mjs";
import { extractArticle } from "../../openweb/lib/extract.mjs";
import { aiFeatures } from "../../openweb/lib/analyse.mjs";
import { parseMediaPlan, checkPublisherSources, parseShowcase } from "../../openweb/lib/inventory.mjs";
import { cfg, html, fakeAsk, FILLER } from "./helpers.mjs";

// ---------- versioned config ----------
test("config loads, every IAB id it references exists, weights add up to 100", () => {
  assert.deepEqual(validateConfig(cfg), []);
  assert.equal(cfg.taxonomy.size, 704);
  for (const k of ["taxonomy", "publishers", "formats", "safety", "scoring", "lexicon"]) assert.match(cfg.versions[k], /\S/);
});
test("config validation catches an unknown IAB id and a format without a source", () => {
  const bad = structuredClone({ ...cfg, taxonomy: undefined }); bad.taxonomy = cfg.taxonomy;
  bad.safety.categories.push({ iab: "NOT-AN-ID", action: "exclude", terms: [] });
  bad.publishers.publishers[0].formats["in-scroll"] = "";
  const p = validateConfig(bad);
  assert.ok(p.some((x) => x.includes("NOT-AN-ID")));
  assert.ok(p.some((x) => x.includes("has no source")));
});
test("a changed taxonomy file is refused (hash check)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owcfg-"));
  for (const f of fs.readdirSync(CONFIG_DIR)) fs.copyFileSync(path.join(CONFIG_DIR, f), path.join(dir, f));
  fs.appendFileSync(path.join(dir, "iab-content-taxonomy-3.1.tsv"), "999\t\tMade-up category\n");
  assert.throws(() => loadConfig(dir), /sha256/);
});
test("taxonomy ancestry", () => {
  assert.equal(cfg.taxonomy.path("559"), "Style & Fashion › Beauty › Skin Care");
  assert.ok(cfg.taxonomy.within("559", "552"));
  assert.ok(!cfg.taxonomy.within("552", "559"));
  assert.equal(cfg.taxonomy.tier1("635"), "596");
});

// ---------- text matching ----------
test("whole-word matching: 'pet' is not in 'petrol', multi-word terms, Devanagari", () => {
  assert.equal(findTerm("Petrol prices rose", "pet").length, 0);
  assert.equal(findTerm("My pet dog", "pet").length, 1);
  assert.equal(findTerm("a  face\nwash routine", "face wash").length, 1);
  assert.equal(findTerm("सड़क हादसा में", "हादसा").length, 1);
  assert.equal(findTerm("हादसों", "हादसा").length, 0);
  assert.ok(termRegex("a.b").test("a.b") && !termRegex("a.b").test("axb"));
});
test("quotes: sentenceAt returns verbatim text; quoteFound rejects anything not in the article", () => {
  const t = "First sentence here. The oats adai recipe is quick to make. Last one.";
  const occ = findTerm(t, "recipe")[0], q = sentenceAt(t, occ.start, occ.end);
  assert.ok(norm(t).includes(q)); assert.match(q, /oats adai recipe/);
  assert.ok(quoteFound(t, "the OATS adai recipe"));
  assert.ok(!quoteFound(t, "the best oats recipe in India"));
  assert.ok(!quoteFound(t, "ab"));
  const long = "word ".repeat(80) + "Claude-powered agents reached the data " + "more ".repeat(80);
  const o = findTerm(long, "agents")[0], lq = sentenceAt(long, o.start, o.end);
  assert.ok(lq.length <= 260 && norm(long).includes(lq));
  assert.ok(lq.includes("Claude-powered agents"), "the window must not split a word: " + lq);
  assert.ok(/^(word|more|Claude)/.test(lq) && /(word|more|data)$/.test(lq));
});

// ---------- robots & feeds ----------
test("robots.txt: wildcards, longest match wins, empty Disallow allows all", () => {
  const r = parseRobots("User-agent: *\nDisallow: /0*\nDisallow: /photogallery/6*.html\nAllow: /photogallery/6-ok.html\nDisallow:\n\nUser-agent: BadBot\nDisallow: /");
  assert.equal(robotsAllows(r, "/0abc"), false);
  assert.equal(robotsAllows(r, "/food/abc.html"), true);
  assert.equal(robotsAllows(r, "/photogallery/6123.html"), false);
  assert.equal(robotsAllows(r, "/photogallery/6-ok.html"), true);
  assert.equal(robotsAllows(parseRobots(""), "/anything"), true);
});
test("feeds: RSS with CDATA links, Atom, sitemap; web stories are skipped", () => {
  const rss = `<rss><channel><item><title><![CDATA[A &amp; B]]></title><link><![CDATA[https://x.test/a]]></link><pubDate>Mon, 26 Oct 2026 05:27:24 +0000</pubDate></item></channel></rss>`;
  assert.deepEqual(parseFeed(rss), [{ url: "https://x.test/a", title: "A & B", published: "2026-10-26T05:27:24.000Z" }]);
  assert.equal(parseFeed(`<feed><entry><title>T</title><link href="https://x.test/b"/><updated>2026-10-01</updated></entry></feed>`)[0].url, "https://x.test/b");
  assert.equal(parseFeed(`<urlset><url><loc>https://x.test/c</loc><news:title>N</news:title></url></urlset>`)[0].title, "N");
  assert.ok(notAnArticle("https://x.test/ampstories/web-stories/2026/a"));
  assert.ok(!notAnArticle("https://x.test/food/recipe-1"));
});

// ---------- extraction ----------
test("extraction prefers JSON-LD; navigation and footer text never reach the body", () => {
  const a = extractArticle(html({ headline: "Oats adai recipe", paras: ["Oats adai is a savoury pancake made with oats and vegetables. " + FILLER], nav: "Buy iPhone 17 now — gadgets deals" }), "https://www.news18.com/food/x.html");
  assert.equal(a.source, "json-ld"); assert.equal(a.headline, "Oats adai recipe");
  assert.ok(!/iPhone/.test(a.body));
  assert.deepEqual(a.sections.includes("food"), true);
  assert.equal(a.image.url, "https://img.example.test/lead.jpg");
});
test("extraction falls back to <p> text when there is no JSON-LD", () => {
  const a = extractArticle(html({ headline: "Plain page", ld: false, paras: ["A paragraph long enough to count as article body text for the fallback path. " + FILLER, "short"] }), "https://x.test/p");
  assert.equal(a.source, "html-paragraphs"); assert.equal(a.paragraphs, 1); assert.match(a.body, /fallback path/);
});

// ---------- AI layer: anti-fabrication ----------
test("AI claims whose quotes are not in the article are dropped; unknown ids are dropped", async () => {
  const a = extractArticle(html({ headline: "Monsoon skincare tips", paras: ["Use a gentle face wash twice a day during the monsoon. " + FILLER] }), "https://x.test/s");
  const ask = fakeAsk({
    categories: [{ iab: "559", quote: "Use a gentle face wash twice a day" }, { iab: "559", quote: "Dermatologists recommend Brand X" }, { iab: "9999", quote: "Use a gentle face wash" }],
    sensitive: [{ iab: "I4GWl6", quote: "three people died in the stampede" }], sentiment: "positive",
    entities: [{ name: "Brand X", type: "brand", quote: "Brand X is the best" }],
  });
  const f = await aiFeatures(a, cfg, ask);
  assert.equal(f.status, "ok");
  assert.deepEqual(f.categories.map((c) => c.iab), ["559"]);
  assert.equal(f.sensitive.length, 0, "an invented sensitive quote must not survive either");
  assert.equal(f.entities.length, 0);
  assert.equal(f.dropped.length, 4);
});
test("AI unavailable / failing is recorded as such, never as 'safe'", async () => {
  const a = extractArticle(html({ headline: "H", paras: [FILLER + FILLER] }), "https://x.test/u");
  assert.equal((await aiFeatures(a, cfg, null)).status, "unavailable");
  assert.equal((await aiFeatures(a, cfg, fakeAsk(new Error("No AI key set — using manual mode.")))).status, "unavailable");
  assert.equal((await aiFeatures(a, cfg, fakeAsk(new Error("Gemini is busy right now")))).status, "error");
});

// ---------- inventory import ----------
test("media plan is parsed as data (never executed), non-breaking spaces normalised, sources checked", () => {
  const src = `window.DEFAULT_MEDIA_PLAN = {"Category Wise In-Image":[{"FOOD & Cooking\u00a0Sitelist":"news18.com (Food Section)","__EMPTY":"x"}]};`;
  const mp = parseMediaPlan(src);
  assert.deepEqual(mp.sites, [{ tab: "Category Wise In-Image", column: "FOOD & Cooking Sitelist", site: "news18.com (Food Section)" }]);
  const r = checkPublisherSources([{ id: "p", formats: { "in-image": "Category Wise In-Image › FOOD & Cooking Sitelist: news18.com (Food Section)", display: "Display & Video › FOOD & Cooking Sitelist: news18.com/food" } }], mp);
  assert.deepEqual(r[0].formats, { "in-image": true, display: false });
  assert.throws(() => parseMediaPlan("alert(1)"));
});
test("showcase feed maps platforms to formats and keeps the preview note", () => {
  const items = parseShowcase([{ id: "platform-in-image", name: "In-image", industries: [{ id: "i1", name: "FMCG" }], creativeVideos: [{ id: "7", name: "Sprite", subtitle: "Sprite", industryIds: ["i1"], creativeType: "video", adSize: "300x600", videoUrl: "videos/a b.mp4" }] }], cfg);
  assert.equal(items[0].format, "in-image"); assert.equal(items[0].industry, "FMCG");
  assert.equal(items[0].preview, "https://showcase.mediakart.co.in/videos/a%20b.mp4");
  assert.match(items[0].note, /not a slot spec/);
});
test("termHits reports distinct terms with verbatim quotes", () => {
  const t = "Spices matter. Garam masala and more masala make the dish.";
  const h = termHits(t, ["masala", "dish", "absent"]);
  assert.deepEqual(h.map((x) => [x.term, x.count]), [["masala", 2], ["dish", 1]]);
  for (const x of h) assert.ok(quoteFound(t, x.quote));
});
