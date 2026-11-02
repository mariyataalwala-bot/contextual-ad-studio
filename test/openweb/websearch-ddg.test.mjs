// Product pictures: when Bing answers a scripted request with pictures that have nothing to do with the query, DuckDuckGo is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { imageSearch, ddgImages, relevantResults } from "../../openweb/lib/websearch.mjs";

const tile = (title, murl, purl) => ` m="${JSON.stringify({ t: title, murl, purl, turl: murl + "?t" }).replace(/"/g, "&quot;")}"`;
const bingHtml = (tiles) => `<html><body>${tiles.map((t) => `<a class="iusc"${tile(...t)}></a>`).join("")}</body></html>`;

test("relevance: results that mention the query's words pass; unrelated pictures (posters, a parrot drawing) do not", () => {
  const good = [["Maaza Mango Drink 600 ml", "https://a/1.jpg", "https://www.amazon.in/maaza"], ["Mango 1L - Maaza", "https://a/2.jpg", "https://www.enjoymaaza.com/m"], ["Maaza juice pack", "https://a/3.jpg", "https://shop.in/x"]]
    .map(([title, url, page]) => ({ title, url, page }));
  const junk = [["Ali G poster", "https://a/1.jpg", "https://imdb.com/x"], ["Parrot drawing", "https://a/2.jpg", "https://drawing.com/y"], ["Summer Slam", "https://a/3.jpg", "https://wwe.com/z"]].map(([title, url, page]) => ({ title, url, page }));
  assert.equal(relevantResults(good, "Maaza juice"), true); assert.equal(relevantResults(junk, "Maaza juice"), false);
  assert.equal(relevantResults([], "Maaza juice"), false); assert.equal(relevantResults(junk, "the india"), true, "a query with no distinctive words cannot be judged");
});

const ddgFetch = (results, { noToken = false, status = 200 } = {}) => async (/** @type {any} */ url, /** @type {any} */ _init = undefined) => {
  const u = String(url);
  if (u.startsWith("https://duckduckgo.com/i.js")) return new Response(JSON.stringify({ results }), { status });
  if (u.startsWith("https://duckduckgo.com/")) return new Response(noToken ? "<html></html>" : '<script>vqd="4-12345678901234567890";</script>', { status: 200 });
  throw new Error("unexpected " + u);
};
const R = [{ image: "https://m.media-amazon.com/maaza.jpg", thumbnail: "https://external-content.duckduckgo.com/iu/?u=1", url: "https://www.amazon.in/Maaza-Mango-Drink/dp/B1", title: "Maaza Mango Drink 600 ml" },
  { image: "https://www.enjoymaaza.com/maaza_1l.png", thumbnail: "https://external-content.duckduckgo.com/iu/?u=2", url: "https://www.enjoymaaza.com/product/mango", title: "Mango 1L - Maaza" },
  { image: "https://m.media-amazon.com/maaza.jpg", thumbnail: "x", url: "https://dup", title: "same picture twice" }, { image: "https://bad", url: "not a url", title: "no host" }];

test("DuckDuckGo images: token, then the JSON; each result keeps its picture, thumbnail, source page and host; duplicates and unusable rows are dropped", async () => {
  const r = await ddgImages("Maaza mango drink", { fetchImpl: ddgFetch(R) });
  assert.deepEqual(r.map((x) => x.host), ["amazon.in", "enjoymaaza.com"]); assert.equal(r[0].url, "https://m.media-amazon.com/maaza.jpg"); assert.match(r[0].thumb, /duckduckgo\.com/);
  await assert.rejects(() => ddgImages("x", { fetchImpl: ddgFetch(R, { noToken: true }) }), /no token/);
  await assert.rejects(() => ddgImages("x", { fetchImpl: ddgFetch(R, { status: 403 }) }), /HTTP 403/);
});

test("image search: Bing's list is used when it answers the query; junk from Bing is replaced by DuckDuckGo's; if both fail the old behaviour stays", async () => {
  const mk = (bing) => async (url, init) => (String(url).startsWith("https://www.bing.com/") ? new Response(bingHtml(bing), { status: 200 }) : ddgFetch(R)(url, init));
  const relevant = await imageSearch("Maaza juice", { fetchImpl: mk([["Maaza Mango", "https://b/1.jpg", "https://shop.in/maaza"], ["Maaza juice 1L", "https://b/2.jpg", "https://shop.in/maaza2"], ["Maaza pack", "https://b/3.jpg", "https://shop.in/maaza3"]]) });
  assert.equal(relevant[0].url, "https://b/1.jpg", "Bing's relevant answer is kept");
  const junk = await imageSearch("Maaza juice", { fetchImpl: mk([["Ali G poster", "https://b/1.jpg", "https://imdb.com/x"], ["Parrot drawing", "https://b/2.jpg", "https://d.com/y"]]) });
  assert.deepEqual(junk.map((x) => x.host), ["amazon.in", "enjoymaaza.com"], "unrelated Bing pictures are replaced");
  const bothBad = await imageSearch("Maaza juice", { fetchImpl: async (url, init) => (String(url).startsWith("https://www.bing.com/") ? new Response(bingHtml([["Ali G poster", "https://b/1.jpg", "https://imdb.com/x"]]), { status: 200 }) : ddgFetch(R, { status: 403 })(url, init)) });
  assert.deepEqual(bothBad, [], "no relevant answer anywhere: nothing — never a list of unrelated pictures (the ad is then made without a product picture, and says so)");
});
