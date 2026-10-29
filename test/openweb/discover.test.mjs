// Discovery with Firecrawl Search: relevant recent articles (best 3–5, with evidence and flags) and, kept apart, the
// brand's verified campaigns. Firecrawl's API is faked (fetchImpl) and pages are read by the app's real reader from a
// stub fetcher. The page text is synthetic test data; no real publisher content.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeFirecrawl, discoverArticles, discoverCampaigns, dateOf, campaignName, tbsFor, urlKey } from "../../openweb/lib/discover.mjs";
import { makeReader } from "../../openweb/lib/reader.mjs";
import { FetchError } from "../../openweb/lib/fetcher.mjs";
import { rivalMatcher } from "../../openweb/lib/studio.mjs";
import { cfg, html, FILLER } from "./helpers.mjs";

const NOW = Date.parse("2026-10-29T06:30:00Z");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mk-discover-"));
const PUBS = [{ domain: "news18.com", id: "news18-food" }, { domain: "indianexpress.com", id: "ie-lifestyle" }];
const TOPICS = ["food", "street food", "biryani", "restaurant", "dinner", "recipe", "monsoon snacks", "festive meal"];
const para = (topic, n = 6) => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} on ${topic} gives readers the places, the prices and the small details of the season. ${FILLER}`);
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// a fake Firecrawl API: queries matching a pattern get their results; every call is recorded
function fakeFirecrawl(routes, calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    for (const [re, answer] of routes) if (re.test(body.query || body.url || "")) return typeof answer === "function" ? answer(body, calls) : answer;
    return json(200, { success: true, data: { web: [], news: [] } });
  };
}
// the app's reader over a stub fetcher: url → html, or a FetchError to throw
const readerOf = (pages, seen = []) => makeReader({ fetcher: { get: async (u) => { seen.push(u); const v = pages[u]; if (!v) throw new FetchError("HTTP_404", u + " → 404"); if (v instanceof FetchError) throw v; return { text: v, finalUrl: u }; } },
  py: null, firecrawl: null, timeoutMs: 5000, sleep: async () => {} });
const fcOf = (routes, calls = [], o = {}) => makeFirecrawl({ key: "fc-test", fetchImpl: fakeFirecrawl(routes, calls), cacheDir: null, sleep: async () => {}, ...o });

// ---------- Zomato: one search with the cases the spec names ----------
const U = {
  good: "https://www.news18.com/food/monsoon-street-food-trail-in-mumbai-9600001.html",
  good2: "https://indianexpress.com/article/lifestyle/food-wine/festive-biryani-recipes-for-diwali-dinner-9600002/",
  dupe: "https://www.news18.com/food/monsoon-street-food-trail-in-mumbai-9600001.html?utm_source=news",
  mention: "https://www.news18.com/business/gig-workers-protest-in-delhi-9600003.html",
  own: "https://www.news18.com/business/zomato-shares-rise-after-q2-9600004.html",
  rival: "https://www.news18.com/food/swiggy-launches-new-snack-menu-9600005.html",
  stale: "https://www.news18.com/food/old-street-food-guide-9600006.html",
  broken: "https://indianexpress.com/article/lifestyle/food-wine/restaurant-week-in-delhi-9600007/",
  passing: "https://www.news18.com/india/delhi-weather-update-9600008.html",
  tag: "https://www.news18.com/tag/street-food/",
  offsite: "https://www.example-blog.test/food/street-food-list",
  unsafe: "https://www.news18.com/food/food-poisoning-deaths-at-restaurant-9600009.html",
  court: "https://indianexpress.com/article/legal-news/high-court-bars-eatery-dosa-chain-9600010/",
};
const ZOMATO_SEARCH = [
  { url: U.good, title: "Monsoon street food trail in Mumbai: 10 stalls to try", description: "Vada pav, bhajiyas and more street food for the rains" },
  { url: U.good2, title: "Festive biryani recipes for your Diwali dinner", description: "Three biryani recipes for the festive meal" },
  { url: U.mention, title: "Gig workers in Delhi ask for better pay", description: "Delivery partners of Zomato and others gathered at Jantar Mantar" },
  { url: U.own, title: "Zomato shares rise after Q2 food delivery growth", description: "The food delivery company reported…" },
  { url: U.rival, title: "Swiggy launches new snack menu for monsoon", description: "food delivery snacks" },
  { url: U.stale, title: "The ultimate street food guide to Old Delhi", description: "street food lanes" },
  { url: U.broken, title: "Restaurant week returns to Delhi with 50 restaurants", description: "restaurant deals" },
  { url: U.passing, title: "Delhi weather update: light rain likely", description: "Good weather for street food, say forecasters" },
  { url: U.tag, title: "Street food news", description: "street food" },
  { url: U.offsite, title: "Best street food list", description: "street food" },
  { url: U.unsafe, title: "What went wrong at a restaurant dinner in Pune", description: "food safety restaurant" },
  { url: U.court, title: "High Court bars eatery from using a dosa chain's name", description: "restaurant trademark food" },
];
const ZOMATO_PAGES = {
  [U.good]: html({ headline: "Monsoon street food trail in Mumbai: 10 stalls to try", paras: para("street food in the monsoon"), date: "2026-10-24T09:00:00+05:30" }),
  [U.good2]: html({ headline: "Festive biryani recipes for your Diwali dinner", paras: para("a biryani recipe for the festive dinner"), date: "2026-10-12T09:00:00+05:30" }),
  [U.stale]: html({ headline: "The ultimate street food guide to Old Delhi", paras: para("street food in Old Delhi"), date: "2026-05-02T09:00:00+05:30" }),
  [U.broken]: new FetchError("HTTP_503", "503 Service Unavailable"),
  [U.passing]: html({ headline: "Delhi weather update: light rain likely", paras: ["Light rain is likely over Delhi on Thursday, the weather office said. " + FILLER, "Temperatures stay mild, and some people head out for street food. " + FILLER, "Winds stay calm through the weekend. " + FILLER], date: "2026-10-27T09:00:00+05:30" }),
  [U.unsafe]: html({ headline: "What went wrong at a restaurant dinner in Pune", paras: para("the deaths after food poisoning at a restaurant, where three people died and several were killed"), date: "2026-10-26T09:00:00+05:30" }),
};

test("Zomato: only recent articles about the product's topics survive; every other result is left out with its reason", async () => {
  const calls = [], seen = [];
  const fc = fcOf([[/./, json(200, { success: true, data: { web: ZOMATO_SEARCH, news: [{ url: U.dupe, title: ZOMATO_SEARCH[0].title, snippet: "street food", date: "5 days ago" }] } })]], calls);
  const out = await discoverArticles({ brand: "Zomato", product: "food delivery", topics: TOPICS, publishers: PUBS, days: 45, fc, reader: readerOf(ZOMATO_PAGES, seen), cfg, maxRead: 10, now: NOW,
    rivals: rivalMatcher(["Swiggy", "Uber Eats"]), ownNews: (t) => /\bzomato\b/i.test(t) });
  const why = (u) => out.excluded.find((x) => x.url === u)?.why || "";
  assert.deepEqual(out.candidates.map((c) => c.url), [U.good2, U.good], "best first: three of the topics in its headline outweigh five days");
  assert.match(why(U.mention), /only mentions the brand/);
  assert.match(why(U.own), /brand's own news/);
  assert.match(why(U.rival), /rival.*Swiggy/i);
  assert.match(why(U.stale), /^stale — published 2026-05-02/);
  assert.match(why(U.broken), /could not be read \(HTTP_503/);
  assert.match(why(U.passing), /passing mention/);
  assert.match(why(U.tag), /not an article page/);
  assert.match(why(U.offsite), /not on a media-plan publisher/);
  assert.match(why(U.unsafe), /brand safety/);
  assert.match(why(U.court), /^negative news \(Court\)/);
  assert.equal(seen.filter((u) => urlKey(u) === urlKey(U.good)).length, 1, "the ?utm duplicate from news was merged, the page read once");
  assert.equal(seen.filter((u) => u === U.broken).length, 2, "an unreadable page is retried once, then left out");
  assert.ok(out.candidates[0].score > out.candidates[1].score && out.candidates[0].score <= 1);
  assert.deepEqual(out.candidates[0].evidence.topicsInHeadline.sort(), ["biryani", "dinner", "recipe"]);
  const top = out.candidates[1];
  assert.equal(top.date.slice(0, 10), "2026-10-24"); assert.equal(top.dateFrom, "page"); assert.equal(top.publisher, "news18-food");
  assert.deepEqual(top.evidence.topicsInHeadline, ["street food"], "'food' inside 'street food' is not counted twice");
  assert.match(top.evidence.sentence, /street food/); assert.match(top.reason, /headline is about .*; published 2026-10-24/);
  assert.deepEqual(top.pictures, ["https://img.example.test/lead.jpg"]);
  assert.equal(calls.length, 6, "two publishers × the top three topics, one site: and one topic each");
  assert.ok(calls.every((c) => /^site:(news18\.com|indianexpress\.com) /.test(c.body.query) && c.body.tbs === "cdr:1,cd_min:9/14/2026,cd_max:10/29/2026" && c.body.sources.length === 1));
  assert.deepEqual(out.flags, []);
});

test("no results: an empty list and a flag, never a loose fit", async () => {
  const out = await discoverArticles({ brand: "Fevicol", topics: ["adhesive", "carpentry", "woodwork"], publishers: PUBS, fc: fcOf([]), reader: readerOf({}), now: NOW });
  assert.deepEqual(out.candidates, []); assert.equal(out.queries.length, 6, "two publishers × three topics");
  assert.match(out.flags.join(" "), /no recent, relevant article found/);
});

test("Firecrawl down: the search is retried once, then flagged — the run goes on without it", async () => {
  const calls = [];
  const out = await discoverArticles({ brand: "Nykaa", topics: ["skincare", "makeup", "lipstick", "sunscreen"], publishers: PUBS, fc: fcOf([[/./, json(503, { success: false, error: "overloaded" })]], calls), reader: readerOf({}), now: NOW });
  assert.equal(calls.length, 12, "six queries, each tried twice");
  assert.match(out.flags[0], /Firecrawl search failed: HTTP 503: overloaded/);
  assert.deepEqual(out.candidates, []);
});

test("no Firecrawl key: discovery is off and says so; no request is made", async () => {
  let n = 0; const fc = makeFirecrawl({ key: null, fetchImpl: async () => { n++; return json(200, {}); } });
  const a = await discoverArticles({ brand: "Amul", topics: ["butter"], publishers: PUBS, fc, now: NOW });
  const c = await discoverCampaigns({ brand: "Amul", fc, tradePress: ["afaqs.com"] });
  assert.equal(fc.enabled, false); assert.equal(n, 0);
  assert.match(a.flags[0], /Firecrawl key not set/); assert.match(c.flags[0], /Firecrawl key not set/);
});

test("makeFirecrawl: bounded retries (429/5xx/network only), a time limit, and a disk cache", async () => {
  // 429 then success: two calls
  let n = 0; let fc = makeFirecrawl({ key: "k", sleep: async () => {}, fetchImpl: async () => (++n === 1 ? json(429, {}) : json(200, { success: true, data: { web: [{ url: "https://a.test/x", title: "x" }] } })) });
  assert.equal((await fc.search("q")).results.length, 1); assert.equal(n, 2);
  // 400 (a bad query) is not retried
  n = 0; fc = makeFirecrawl({ key: "k", sleep: async () => {}, fetchImpl: async () => { n++; return json(400, { error: "bad query" }); } });
  assert.match((await fc.search("q")).error, /HTTP 400: bad query/); assert.equal(n, 1);
  // a request that never answers is stopped by the time limit, retried once, then reported
  n = 0; fc = makeFirecrawl({ key: "k", timeoutMs: 60, sleep: async () => {}, fetchImpl: (_u, init) => { n++; return new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(new Error("The operation was aborted due to timeout")))); } });
  const t0 = Date.now(), r = await fc.scrape("https://a.test/slow");
  assert.match(r.error, /timeout/); assert.equal(n, 2); assert.ok(Date.now() - t0 < 2000);
  // cache: the second identical search is answered from disk; a failure is never cached
  const dir = tmp(); n = 0;
  fc = makeFirecrawl({ key: "k", cacheDir: dir, sleep: async () => {}, fetchImpl: async () => { n++; return json(200, { success: true, data: { news: [{ url: "https://a.test/n", title: "n", snippet: "s" }] } }); } });
  const first = await fc.search("q", { tbs: "qdr:w" }), second = await fc.search("q", { tbs: "qdr:w" }), other = await fc.search("q", { tbs: "qdr:m" });
  assert.equal(n, 2); assert.ok(!first.cached && second.cached && !other.cached);
  assert.equal(second.results[0].description, "s", "news snippets become descriptions");
  n = 0; fc = makeFirecrawl({ key: "k", cacheDir: dir, sleep: async () => {}, retries: 0, fetchImpl: async () => { n++; return json(500, {}); } });
  await fc.search("fails"); await fc.search("fails"); assert.equal(n, 2);
});

test("dateOf: metadata first, then the article text, then the address; nothing invented", () => {
  assert.deepEqual(dateOf({ published: "2026-10-20T10:00:00+05:30" }), { date: "2026-10-20T04:30:00.000Z", from: "page" });
  assert.equal(dateOf({ metadata: { "article:published_time": "2026-09-01T00:00:00Z" } }).from, "metadata");
  assert.equal(dateOf({ text: "By Staff | Updated: 19 Jan 2026, 10:12 AM IST\nZomato…" }).date.slice(0, 10), "2026-01-19");
  assert.equal(dateOf({ text: "Published Oct 3, 2026 · Mumbai" }).date.slice(0, 10), "2026-10-03");
  assert.equal(dateOf({ url: "https://www.example.test/2026/Oct/26/story" }).date.slice(0, 10), "2026-10-26");
  assert.equal(dateOf({ url: "https://www.example.test/2026/10/05/story" }).from, "address");
  assert.deepEqual(dateOf({ text: "No date here", url: "https://x.test/a" }), { date: null, from: null });
  assert.equal(dateOf({ published: "2099-01-01" }).date, null, "a date in the future is not a publication date");
  assert.equal(tbsFor(45, NOW), "cdr:1,cd_min:9/14/2026,cd_max:10/29/2026");
});

// ---------- campaigns: verified only with evidence ----------
const C = {
  ok: "https://www.afaqs.com/news/advertising/zomato-hunger-ka-dosti-campaign-9700001",
  undated: "https://www.socialsamosa.com/2026/zomato-new-ad-film-9700002",
  roundup: "https://www.exchange4media.com/advertising-news/top-10-ads-of-the-week-9700003.html",
  noBrand: "https://www.afaqs.com/news/advertising/swiggy-ipl-campaign-9700004",
  old: "https://www.campaignindia.in/article/zomato-ad-film-2024/9700005",
  notCampaign: "https://www.bestmediainfo.com/2026/10/zomato-appoints-new-cmo-9700006",
  tag: "https://www.afaqs.com/agencypro/zomato",
  blocked: "https://www.storyboard18.com/brand-marketing/zomato-diwali-film-9700007.htm",
};
const camPage = (headline, paras, date) => html({ headline, paras: [...paras, FILLER, FILLER], date, ld: !!date, image: null });
const CAMPAIGN_PAGES = {
  [C.ok]: camPage("Zomato's 'Hunger Ka Dosti' campaign celebrates late-night cravings", ["Zomato has launched a new campaign, 'Hunger Ka Dosti', a series of ad films about friends who order in after midnight. " + FILLER], "2026-09-18T11:00:00+05:30"),
  [C.undated]: camPage("Zomato rolls out a new ad film for its 10-minute delivery", ["Zomato has rolled out a new ad film that shows a delivery partner racing the rain. " + FILLER], null),
  [C.old]: camPage("Zomato's cricket ad film wins over fans", ["Zomato's new ad film for the cricket season features its delivery partners. " + FILLER], "2024-04-10T11:00:00+05:30"),
  [C.notCampaign]: camPage("Zomato appoints a new chief marketing officer", ["Zomato has appointed a new chief marketing officer who joins from a consumer goods company. " + FILLER], "2026-10-02T11:00:00+05:30"),
  [C.blocked]: new FetchError("HTTP_403", "403 Forbidden"),
};
const CAMPAIGN_SEARCH = [
  { url: C.ok, title: "Zomato's 'Hunger Ka Dosti' campaign celebrates late-night cravings" },
  { url: C.ok + "?ref=home", title: "dupe" },
  { url: C.undated, title: "Zomato rolls out a new ad film for its 10-minute delivery" },
  { url: C.roundup, title: "Top 10 ads of the week: Zomato, Cadbury and more" },
  { url: C.noBrand, title: "Swiggy's IPL campaign takes on late-night hunger" },
  { url: C.old, title: "Zomato's cricket ad film wins over fans" },
  { url: C.notCampaign, title: "Zomato appoints a new chief marketing officer" },
  { url: C.tag, title: "Zomato - afaqs agencypro" },
  { url: C.blocked, title: "Zomato's Diwali film is about the last order of the night" },
];

test("campaigns: verified only on a dated page that names the brand and quotes the campaign; the rest unverified or left out", async () => {
  const calls = [];
  const fc = fcOf([[/^"Zomato"/, json(200, { success: true, data: { web: CAMPAIGN_SEARCH } })],
    [/storyboard18/, json(200, { success: true, data: { markdown: "# Zomato's 'Last Order' Diwali film\n\nBy Storyboard18 | Oct 21, 2026\n\nZomato has released a Diwali ad film, 'Last Order', about a delivery partner's final drop of the night. More lines follow.", metadata: { title: "Zomato's 'Last Order' Diwali film" } } })]], calls);
  const out = await discoverCampaigns({ brand: "Zomato", aliases: ["Eternal"], months: 12, fc, reader: readerOf(CAMPAIGN_PAGES), tradePress: ["afaqs.com", "storyboard18.com"], maxRead: 10, now: NOW });
  assert.deepEqual(out.verified.map((c) => c.url), [C.blocked, C.ok], "newest first; the blocked page verified through Firecrawl's copy");
  const ok = out.verified[1];
  assert.equal(ok.name, "Hunger Ka Dosti"); assert.equal(ok.date.slice(0, 10), "2026-09-18");
  assert.match(ok.evidence, /^Zomato has launched a new campaign, 'Hunger Ka Dosti'/);
  assert.equal(out.verified[0].name, "Last Order"); assert.equal(out.verified[0].dateFrom, "text");
  assert.deepEqual(out.unverified.map((c) => [c.url, c.why]), [[C.undated, "publication date not found — not claimed as recent"]]);
  const why = (u) => out.excluded.find((x) => x.url === u)?.why || "";
  assert.match(why(C.roundup), /round-up/); assert.match(why(C.noBrand), /does not name the brand/);
  assert.match(why(C.old), /older than 12 months \(2024-04-10\)/); assert.match(why(C.notCampaign), /a feature or business story \(appoints\)/);
  assert.match(why(C.tag), /not an article/);
  assert.equal(out.excluded.filter((x) => x.title === "dupe").length, 0, "the duplicate address was dropped before anything else");
  assert.match(calls[0].body.query, /^"Zomato" \(campaign OR "ad film" OR TVC OR commercial OR "new ad"\) \(site:afaqs\.com OR site:storyboard18\.com\)$/);
  assert.deepEqual(out.flags, []);
});

// the false positives a live run found (Amul, Tata Motors, Fevicol on 2026-10-29), as synthetic pages
test("campaigns: a fake ad, a look back at an old film, a sales story or 'commercial vehicles' is never a verified campaign", async () => {
  const P = {
    fake: "https://www.afaqs.com/news/advertising/how-did-the-industry-fall-for-a-fake-ai-made-amul-ad-1",
    retro: "https://www.storyboard18.com/advertising/built-to-last-inside-fevicols-60-year-film-2.htm",
    oldYear: "https://www.afaqs.com/news/advertising/fevicol-moochwali-film-3",
    sales: "https://www.storyboard18.com/brand-marketing/tata-motors-cv-volumes-climb-4.htm",
    mention: "https://www.socialsamosa.com/industry-updates/brands-at-the-asian-games-5",
    real: "https://bestmediainfo.com/ad-craft/tata-motors-cv-better-always-campaign-6",
  };
  const pages = {
    [P.fake]: camPage("How did the industry fall for a fake AI-made Amul ad?", ["Amul's topical butter girl campaign began in the 1960s. A new AI-made ad that was shared widely was not made by Amul. " + FILLER], "2026-04-23T10:00:00+05:30"),
    [P.retro]: camPage("Built to last: inside Fevicol's 60-year film", ["Released in 2019, the 90-second Fevicol commercial marked six decades of the brand. " + FILLER], "2026-02-28T10:00:00+05:30"),
    [P.oldYear]: camPage("Fevicol's Moochwali film, a short story", ["Fevicol launched the 'Moochwali' film in 2009 as a sixty-second commercial. " + FILLER], "2026-02-21T10:00:00+05:30"),
    [P.sales]: camPage("Tata Motors CV volumes climb on infrastructure demand", ["Tata Motors' new commercial vehicles saw demand rise across the quarter. " + FILLER], "2026-10-01T10:00:00+05:30"),
    [P.mention]: camPage("Tata Motors joins other brands as Asian Games sponsor", ["Tata Motors is one of the sponsors this year, alongside a dozen brands. " + FILLER], "2026-09-19T10:00:00+05:30"),
    [P.real]: camPage("Tata Motors CV's 'Better Always' campaign turns to journeys", ["Tata Motors Commercial Vehicles has released a new corporate film, 'Better Always', made by Ogilvy India. " + FILLER], "2026-02-10T10:00:00+05:30"),
  };
  const search = (titles) => json(200, { success: true, data: { web: Object.entries(titles).map(([url, title]) => ({ url, title })) } });
  const amul = await discoverCampaigns({ brand: "Amul", fc: fcOf([[/./, search({ [P.fake]: "How did the industry fall for a fake AI-made Amul ad?" })]]), reader: readerOf(pages), tradePress: ["afaqs.com"], now: NOW });
  assert.deepEqual(amul.verified, []); assert.match(amul.excluded[0].why, /fake or unofficial ad \(fake\)/);
  const fevicol = await discoverCampaigns({ brand: "Fevicol", fc: fcOf([[/./, search({ [P.retro]: "Built to last: inside Fevicol's 60-year film", [P.oldYear]: "Fevicol's Moochwali film, a short story" })]]), reader: readerOf(pages), tradePress: ["afaqs.com"], now: NOW });
  assert.deepEqual(fevicol.verified, []);
  assert.match(fevicol.excluded.find((x) => x.url === P.retro).why, /feature or business story \(inside\)/);
  assert.match(fevicol.excluded.find((x) => x.url === P.oldYear).why, /no sentence says the brand launched a campaign \(only mentions, or an older ad\)/, "a 2009 launch on a 2026 page is not recent");
  const tata = await discoverCampaigns({ brand: "Tata Motors", product: "Nexon EV", fc: fcOf([[/./, search({ [P.sales]: "Tata Motors CV volumes climb on infrastructure demand", [P.mention]: "Tata Motors joins other brands as Asian Games sponsor", [P.real]: "Tata Motors CV's 'Better Always' campaign turns to journeys" })]]), reader: readerOf(pages), tradePress: ["afaqs.com"], now: NOW });
  assert.deepEqual(tata.verified.map((c) => [c.url, c.name, c.forProduct]), [[P.real, "Better Always", false]]);
  assert.match(tata.excluded.find((x) => x.url === P.sales).why, /no sentence says the brand launched/, "'commercial vehicles' is not a commercial");
  assert.match(tata.excluded.find((x) => x.url === P.mention).why, /no sentence says the brand launched/);
  assert.match(tata.flags[0], /none of the verified campaigns names Nexon EV/);
});

test("campaigns: none found → a flag, and nothing is claimed", async () => {
  const out = await discoverCampaigns({ brand: "Fevicol", fc: fcOf([]), reader: readerOf({}), tradePress: ["afaqs.com"], now: NOW });
  assert.deepEqual([out.verified, out.unverified], [[], []]);
  assert.match(out.flags[0], /no verified campaign for Fevicol in the last 12 months/);
});

test("campaignName: the quoted name from the headline, else from the sentence; possessives are not quotes", () => {
  assert.equal(campaignName("Zomato's 'Hunger Ka Dosti' campaign"), "Hunger Ka Dosti");
  assert.equal(campaignName("Cadbury’s new film", "Cadbury launches “Har Pal Meetha” for Diwali."), "Har Pal Meetha");
  assert.equal(campaignName("Zomato's new ad film for monsoon"), null);
});
