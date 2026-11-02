// 2-in-1 contextual ads: the video checks (wrong brand, unavailable, expired, incompatible formats), the explainable
// match (irrelevant and unsafe articles are not forced), candidate discovery without duplicate searches, the safe
// preview page and the routes' guards. All data here is synthetic test data — no network, no real publisher content.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { verifyYoutubeAd, checkClientVideo, judgeMatch, discoverVideoCandidates, assertPublicUrl, downloadVideo, probeFile, youtubeId, brandNames, recencyScore, DEFAULTS, WEIGHTS } from "../../openweb/lib/twoinone.mjs";
import { previewHtml } from "../../openweb/lib/twoinone-preview.mjs";
import { createOpenWeb } from "../../openweb/routes.mjs";
import { fakeAsk } from "./helpers.mjs";

const NOW = Date.parse("2026-10-30T10:00:00Z");
const ad = (o = {}) => ({ id: "AAAAAAAAAAA", title: "Official TVC | New launch", channel: "", length: "0:30", aspect: 1.78, ...o });
const ok = { status: "ok", title: "x", author: "y", width: 200, height: 113 };

// the five reference brands: an official ad passes; the same title from a reseller / a rival's channel does not
const REFERENCE = [
  { brand: "Airtel", product: "Priority Postpaid", channel: "Airtel India", title: "Airtel Priority Postpaid | Bheed mein bhi speed" },
  { brand: "Kissht", product: "Smart Loans", channel: "Kissht", title: "Kissht Smart Loans for Smart India | Official TVC" },
  { brand: "Xiaomi", product: "Redmi Note 17", channel: "Xiaomi India", title: "Redmi Note 17 5G | 8000 mAh | Official TVC" },
  { brand: "Motul", product: "GP Ultimate", channel: "Motul India", title: "Motul India | The thrill of next-gen performance" },
  { brand: "Titan", product: "Eye+ glasses", channel: "Titan Eyeplus", title: "Titan Eye+ | Official ad film" },
];
for (const r of REFERENCE) {
  test(`video check — ${r.brand} ${r.product}: the official ad passes, a reseller's upload and a review do not`, () => {
    const good = verifyYoutubeAd({ brand: r.brand, product: r.product, video: ad({ title: r.title, channel: r.channel }), details: { publishedAt: "2026-08-01T00:00:00Z", embeddable: true }, probe: ok, now: NOW });
    assert.equal(good.ok, true, good.reasons.join("; ")); assert.equal(good.official, true);
    const reseller = verifyYoutubeAd({ brand: r.brand, product: r.product, video: ad({ title: r.title, channel: "Deals Bazaar Mobiles" }), probe: ok, now: NOW });
    assert.equal(reseller.ok, false); assert.match(reseller.reasons.join(" "), /not the brand's own channel/);
    const review = verifyYoutubeAd({ brand: r.brand, product: r.product, video: ad({ title: `${r.brand} ${r.product} review + unboxing`, channel: r.channel }), probe: ok, now: NOW });
    assert.equal(review.ok, false); assert.match(review.reasons.join(" "), /review/);
  });
}

test("video check: a wrong-brand video is rejected even from a big channel", () => {
  const r = verifyYoutubeAd({ brand: "Airtel", product: "Priority Postpaid", video: ad({ title: "Jio Postpaid Plus | Official TVC", channel: "Jio" }), probe: ok, now: NOW });
  assert.equal(r.ok, false); assert.match(r.reasons.join(" "), /Names the brand/);
});
test("video check: unavailable, embedding off, expired, vertical and wrong-length videos are rejected with a reason each", () => {
  const base = { brand: "Kissht", product: "loans", now: NOW, video: ad({ title: "Kissht loans Official TVC", channel: "Kissht" }) };
  assert.match(verifyYoutubeAd({ ...base, probe: { status: "gone" } }).reasons.join(" "), /removed or private/);
  assert.match(verifyYoutubeAd({ ...base, probe: { status: "embed_off" } }).reasons.join(" "), /embedding off/);
  assert.match(verifyYoutubeAd({ ...base, probe: ok, details: { publishedAt: "2022-01-01T00:00:00Z", embeddable: true } }).reasons.join(" "), /expired campaign/);
  assert.match(verifyYoutubeAd({ ...base, probe: ok, video: { ...base.video, aspect: 0.56 } }).reasons.join(" "), /not landscape/);
  assert.match(verifyYoutubeAd({ ...base, probe: ok, video: { ...base.video, length: "4:30" } }).reasons.join(" "), /outside/);
  assert.match(verifyYoutubeAd({ ...base, probe: ok, video: { ...base.video, title: "Kissht Shorts #shorts", aspect: 0.56 } }).reasons.join(" "), /not landscape/);
});
test("video check: what YouTube could not tell is flagged, never invented — an unknown date does not pass as 'current' or 'expired'", () => {
  const r = verifyYoutubeAd({ brand: "Kissht", product: "loans", video: ad({ title: "Kissht loans Official TVC", channel: "Kissht" }), probe: { status: "unknown" }, now: NOW });
  assert.equal(r.ok, true);
  assert.ok(r.flags.some((f) => /publication date is not available/.test(f)) && r.flags.some((f) => /could not be reached/.test(f)));
  assert.equal(r.checks.find((c) => c.name === "Current campaign").pass, null);
});
test("video check: a client's own YouTube link need not come from a brand-named channel, but must still name the brand", () => {
  const mine = { brand: "Motul", product: "oil", now: NOW, probe: ok, clientSupplied: true };
  assert.equal(verifyYoutubeAd({ ...mine, video: ad({ title: "Motul GP Ultimate TVC", channel: "Agency Films" }) }).ok, true);
  assert.equal(verifyYoutubeAd({ ...mine, video: ad({ title: "Some other brand's film", channel: "Agency Films" }) }).ok, false);
});
test("video check: another country's channel of the same brand still passes but ranks below the India channel", () => {
  const mk = (channel) => verifyYoutubeAd({ brand: "Xiaomi", product: "Redmi Note 17", video: ad({ title: "REDMI Note 17 | Official TVC", channel }), details: { publishedAt: "2026-09-01T00:00:00Z", embeddable: true }, probe: ok, now: NOW });
  const india = mk("Xiaomi India"), ph = mk("Xiaomi Philippines");
  assert.equal(ph.ok, true); assert.ok(india.score > ph.score + 30); assert.equal(ph.checks.find((c) => c.name === "For Indian readers").pass, false);
});
test("youtubeId reads watch, short and embed links and a bare id; brandNames drops filler words", () => {
  for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=3", "https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"]) assert.equal(youtubeId(u), "dQw4w9WgXcQ");
  assert.equal(youtubeId("https://example.com/video.mp4"), null);
  assert.deepEqual(brandNames({ brand: "Airtel India Official", known: null }), ["airtel"]);
});

// ---------- the client's file ----------
const probeOf = (o = {}) => ({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "30" }, streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }, { codec_type: "audio", codec_name: "aac" }], ...o });
test("client video check: a 16:9 H.264 ad passes; vertical, square, rotated, too long, HEVC and picture-less files are incompatible", () => {
  assert.equal(checkClientVideo({ probe: probeOf() }).ok, true);
  const bad = (streams, format = { format_name: "mov,mp4", duration: "30" }) => checkClientVideo({ probe: { format, streams } });
  assert.match(bad([{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }]).problems.join(" "), /vertical or square/);
  assert.match(bad([{ codec_type: "video", codec_name: "h264", width: 1080, height: 1080 }]).problems.join(" "), /16:9/);
  assert.match(bad([{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, tags: { rotate: "90" } }]).problems.join(" "), /1080×1920/);   // a phone clip stored sideways
  assert.match(bad([{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }], { format_name: "mp4", duration: "400" }).problems.join(" "), /400 s long/);
  assert.match(bad([{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 }]).problems.join(" "), /H\.265/);
  assert.match(bad([{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }], { format_name: "avi", duration: "30" }).problems.join(" "), /not supported/);
  assert.match(bad([{ codec_type: "audio", codec_name: "aac" }]).problems.join(" "), /no video/);
});
test("client video check on real files: ffprobe reads a 16:9 clip as fine and a 9:16 clip as incompatible", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-two-")), mk = (name, size) => { const f = path.join(dir, name); execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=25:duration=6`, "-pix_fmt", "yuv420p", f]); return f; };
  let wide, tall; try { wide = mk("wide.mp4", "640x360"); tall = mk("tall.mp4", "360x640"); } catch { return t.skip("ffmpeg is not available"); }
  const a = checkClientVideo({ probe: await probeFile(wide) }), b = checkClientVideo({ probe: await probeFile(tall) });
  assert.equal(a.ok, true, a.problems.join(" ")); assert.equal(a.facts.width, 640); assert.equal(a.facts.audio, false);
  assert.equal(b.ok, false); assert.match(b.problems[0], /vertical or square/);
  await assert.rejects(() => probeFile(path.join(dir, "missing.mp4")), /could not be read/);
});
test("a video link must be a public web address: localhost, private networks and non-video files are refused", async () => {
  for (const u of ["http://localhost/a.mp4", "http://127.0.0.1/a.mp4", "http://10.0.0.5/a.mp4", "http://192.168.1.2/a.mp4", "http://[::1]/a.mp4", "http://169.254.169.254/latest", "ftp://example.com/a.mp4"]) await assert.rejects(() => assertPublicUrl(u), /public web address|https/, u);
  await assert.rejects(() => assertPublicUrl("https://sneaky.example.com/a.mp4", /** @type {any} */ (async () => [{ address: "10.1.2.3" }])), /public web address/, "a name that resolves to a private address");
  const fetchImpl = async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
  await assert.rejects(() => downloadVideo("https://cdn.example.com/page", path.join(os.tmpdir(), "mk-never"), { fetchImpl, lookup: /** @type {any} */ (async () => [{ address: "93.184.216.34" }]) }), /not a video file/);
  const big = async () => new Response("x", { status: 200, headers: { "content-type": "video/mp4", "content-length": "999999999" } });
  await assert.rejects(() => downloadVideo("https://cdn.example.com/a.mp4", path.join(os.tmpdir(), "mk-never"), { fetchImpl: big, lookup: /** @type {any} */ (async () => [{ address: "93.184.216.34" }]), maxBytes: 1e6 }), /larger than/);
});

// ---------- YouTube discovery: verified candidates, no duplicate searches ----------
test("discovery: official ads are offered best-first, the rest are turned away with reasons, and a repeat search is served from the cache", async () => {
  const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mk-two-")), "c.json");
  let searches = 0;
  const found = [ad({ id: "OFFICIAL001", title: "Airtel Priority Postpaid | Official TVC", channel: "Airtel India", why: "brand channel" }), ad({ id: "REVIEWREV01", title: "Airtel Priority review", channel: "Tech Guru" }),
    ad({ id: "REMOVED0001", title: "Airtel Priority old film", channel: "Airtel India" }), ad({ id: "NOEMBED0001", title: "Airtel Priority launch film", channel: "Airtel India" })];
  const probe = async (id) => ({ OFFICIAL001: ok, REVIEWREV01: ok, REMOVED0001: { status: "gone" }, NOEMBED0001: { status: "embed_off" } })[id];
  const run = () => discoverVideoCandidates({ brand: "Airtel", product: "Priority Postpaid", known: null, findAds: async () => { searches++; return found; }, probe, cacheFile, now: NOW, say() {} });
  const r = await run();
  assert.deepEqual(r.candidates.map((c) => c.id), ["OFFICIAL001"]);
  assert.equal(r.rejected.length, 3); assert.match(r.rejected.find((x) => x.id === "REMOVED0001").reasons.join(" "), /removed or private/); assert.match(r.rejected.find((x) => x.id === "NOEMBED0001").reasons.join(" "), /embedding off/);
  assert.ok(r.flags.some((f) => /No YouTube API key/.test(f)), "without an API key the missing dates are said out loud");
  const again = await run(); assert.equal(again.cached, true); assert.equal(searches, 1, "the second lookup did not search again");
  const none = await discoverVideoCandidates({ brand: "Zzzz", product: "", findAds: async () => [], probe, now: NOW, say() {} });
  assert.equal(none.candidates.length, 0); assert.match(none.flags[0], /no official 16:9 ads/);
  await assert.rejects(() => discoverVideoCandidates({ brand: "Zzzz", product: "", findAds: null }), /not available/);
});

// ---------- the contextual match ----------
const art = (headline, body, o = {}) => ({ a: { headline, body, url: "https://x.test/" + headline.replace(/\W+/g, "-"), published: "2026-10-28T08:00:00+05:30", extraction: { status: "complete" }, ...o }, publisher: "Indian Express", sourceScore: 9 });
const BODY = "Mobile networks are rolling out faster postpaid plans and 5G coverage this winter, telecom operators said on Tuesday, as customers ask for steady speed on crowded trains. ";
test("match: a relevant, safe article scores high with checkable evidence; an unrelated one is not forced", async () => {
  const items = [art("Telecom operators race to improve postpaid speed in crowded cities", BODY.repeat(3)), art("Ten easy dinner recipes for a rainy week", "Add the onions and stir the dal slowly until it is thick. ".repeat(10))];
  const ask = fakeAsk({ articles: [
    { n: 1, product_relevance: 9, topic_intent: 8, campaign_fit: 8, article_safe: true, safety_why: "", exclusion: "", evidence_quote: "telecom operators said on Tuesday, as customers ask for steady speed on crowded trains", why: "About postpaid speed" },
    { n: 2, product_relevance: 1, topic_intent: 2, campaign_fit: 1, article_safe: true, safety_why: "", exclusion: "", evidence_quote: "", why: "A recipe list" }] });
  const r = await judgeMatch({ ask, brand: "Airtel", product: "Priority Postpaid", video: { title: "Airtel Priority Postpaid" }, items, topicWords: ["telecom", "postpaid"], now: NOW });
  assert.equal(r[0].a.headline, items[0].a.headline); assert.equal(r[0].judge.fits, true); assert.ok(r[0].judge.score >= DEFAULTS.minScore);
  assert.match(r[0].judge.evidence, /customers ask for steady speed/);
  const w = WEIGHTS, expected = +(9 * w.product + 8 * w.topic + 8 * w.campaign + 10 * w.recency + 9 * w.source).toFixed(1);
  assert.equal(r[0].judge.score, expected, "the score is the stated weighted sum");
  assert.equal(r[1].judge.fits, false); assert.ok(r[1].judge.score < 4);
});
test("match: a quote that is not in the article is dropped and caps the relevance; a headline without the product's topics is capped at 6", async () => {
  const items = [art("Winter wedding trends this season", BODY.repeat(3))];
  const ask = fakeAsk({ articles: [{ n: 1, product_relevance: 10, topic_intent: 10, campaign_fit: 10, article_safe: true, safety_why: "", exclusion: "", evidence_quote: "A sentence the article never contained at all, honestly", why: "great" }] });
  const [r] = await judgeMatch({ ask, brand: "Airtel", product: "Priority Postpaid", video: {}, items, topicWords: ["telecom", "postpaid"], now: NOW });
  assert.equal(r.judge.evidence, null); assert.equal(r.judge.product_relevance, 5); assert.match(r.judge.flags.join(" "), /no verifiable evidence/);
  assert.equal(r.judge.fits, false, "a loose fit is not placed");
});
test("match: an unsafe article or a named exclusion is never placed, however relevant", async () => {
  const items = [art("Telecom firm fined after postpaid billing scandal, customers protest", BODY.repeat(3)), art("Telecom operators race to improve postpaid speed", BODY.repeat(3))];
  const q = "telecom operators said on Tuesday, as customers ask for steady speed on crowded trains";
  const ask = fakeAsk({ articles: [
    { n: 1, product_relevance: 9, topic_intent: 9, campaign_fit: 9, article_safe: false, safety_why: "a scandal story", exclusion: "", evidence_quote: q, why: "" },
    { n: 2, product_relevance: 9, topic_intent: 9, campaign_fit: 9, article_safe: true, safety_why: "", exclusion: "names a competitor, Jio", evidence_quote: q, why: "" }] });
  const r = await judgeMatch({ ask, brand: "Airtel", product: "Priority Postpaid", video: {}, items, topicWords: ["telecom", "postpaid"], now: NOW });
  assert.ok(r.every((x) => x.judge.fits === false && x.judge.safe === false)); assert.equal(r.find((x) => x.judge.exclusion)?.judge.exclusion, "names a competitor, Jio");
});
test("match: an article with no date counts as neutral recency and says so; recency falls with age", async () => {
  assert.equal(recencyScore("2026-10-28T00:00:00Z", NOW), 10); assert.equal(recencyScore("2026-10-15T00:00:00Z", NOW), 8.5); assert.equal(recencyScore("2026-10-01T00:00:00Z", NOW), 7); assert.equal(recencyScore("2026-07-01T00:00:00Z", NOW), 4); assert.equal(recencyScore(null, NOW), null);
  const ask = fakeAsk({ articles: [{ n: 1, product_relevance: 8, topic_intent: 8, campaign_fit: 8, article_safe: true, safety_why: "", exclusion: "", evidence_quote: "", why: "" }] });
  const [r] = await judgeMatch({ ask, brand: "A", product: "B", video: {}, items: [art("Telecom speed test", BODY, { published: null })], topicWords: ["telecom"], now: NOW });
  assert.equal(r.judge.recency, null); assert.match(r.judge.flags.join(" "), /publication date not available/);
});

// ---------- the preview page ----------
/** @type {any} */ const sample = { brand: "Kissht", product: "Smart Loans", publisher: "Indian Express", article: { headline: "Gold loans: what borrowers should watch", url: "https://x.test/a", published: "2026-10-27T00:00:00Z", paragraphs: ["First paragraph of the article text that is long enough to read.", "Second paragraph.", "Third paragraph.", "Fourth paragraph."], hero: "/api/ow/twoinone/file?path=k%2Fhero.jpg" },
  video: { kind: "youtube", id: "dQw4w9WgXcQ", title: "Kissht TVC" }, display: { colour: "#2b3fa0", logo: null, productName: "Smart Loans", cta: "Know more", ctaUrl: "https://kissht.com" } };
test("preview: the unit has a close button, an 'Advertisement' label, a mock bar, a muted YouTube embed from the privacy-friendly host and the article's own text", () => {
  const h = previewHtml(sample);
  for (const s of ["Close advertisement", "Advertisement", "MOCK PREVIEW", "youtube-nocookie.com/embed/dQw4w9WgXcQ", "mute=1", "Gold loans: what borrowers should watch", "Second paragraph.", "Know more"]) assert.ok(h.includes(s), s);
  assert.ok(!/<script[^>]*src=/.test(h), "no external script");
  assert.equal(previewHtml({ ...sample, video: { kind: "file", src: "/api/ow/twoinone/file?path=a%2Fb.mp4" } }).includes('<video id="vid"'), true);
});
test("preview: text from publishers, YouTube or clients is escaped and only web links are made clickable", () => {
  const evil = '"><script>alert(1)</script>';
  const h = previewHtml({ ...sample, brand: evil, product: evil, publisher: evil, article: { ...sample.article, headline: evil, paragraphs: [evil, evil, evil] }, video: { kind: "youtube", id: 'x"><b>', title: evil }, display: { ...sample.display, productName: evil, ctaUrl: "javascript:alert(1)", colour: "red;}</style><script>alert(2)</script>" } });
  assert.ok(!h.includes("<script>alert"), "no injected script"); assert.ok(!h.includes('"><b>'), "the video id is encoded"); assert.ok(!/href="javascript:/i.test(h), "no javascript: link"); assert.ok(!h.includes("</style><script>alert(2)"), "the colour is validated");
});

// ---------- the routes ----------
test("routes: the 2-in-1 page is served and the start route refuses bad input before any work", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-two-"));
  const ow = createOpenWeb({ dataDir: path.join(dir, "data"), studioDir: path.join(dir, "inimage") });
  const srv = http.createServer((req, res) => ow.handle(req, res, new URL(req.url, "http://x"), { local: true }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(null)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  const call = async (p, body) => { const r = await fetch(base + p, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* html */ } return { status: r.status, json, text: t, headers: r.headers }; };
  try {
    const page = await call("/twoinone"); assert.equal(page.status, 200); assert.match(page.text, /2-in-1 Studio/); assert.match(page.text, /Choose the video ad/);
    assert.equal((await call("/api/ow/twoinone/start", { brand: "", product: "" })).status, 400);
    assert.match((await call("/api/ow/twoinone/candidates", { brand: "" })).json.error, /Type the brand/);
    assert.match((await call("/api/ow/twoinone/start", { brand: "Airtel", product: "Postpaid" })).json.error, /AI key/, "without an AI key the run stops at once, with the reason");
    assert.equal((await call("/api/ow/twoinone/preview?dir=../../etc")).status, 404);
    assert.equal((await call("/api/ow/twoinone/file?path=..%2F..%2Fpackage.json")).status, 404);
    assert.deepEqual((await call("/api/ow/twoinone/list")).json, []);
    for (const f of ["/inimage", "/openweb"]) assert.match((await call(f)).text, /href="\/twoinone"/, `${f} links to the 2-in-1 tab`);
  } finally { srv.close(); }
});
