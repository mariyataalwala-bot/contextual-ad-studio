// Product pictures from Google's official image search (a free key + search-engine id), used first when set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { imageSearch, googleImages, setImageSearchConfig } from "../../openweb/lib/websearch.mjs";

const ITEMS = [{ title: "Maaza Mango Drink 600 ml", link: "https://m.media-amazon.com/maaza.jpg", image: { contextLink: "https://www.amazon.in/Maaza/dp/B1", thumbnailLink: "https://t/1" } },
  { title: "Mango 1L - Maaza", link: "https://www.enjoymaaza.com/maaza_1l.png", image: { contextLink: "https://www.enjoymaaza.com/p", thumbnailLink: "https://t/2" } },
  { title: "Maaza pack", link: "https://shop.in/maaza.jpg", image: { contextLink: "https://shop.in/maaza", thumbnailLink: "https://t/3" } },
  { title: "duplicate", link: "https://shop.in/maaza.jpg", image: { contextLink: "https://shop.in/other" } }, { title: "no link" }];
const api = (status = 200, /** @type {any} */ body = { items: ITEMS }) => async (url) => { assert.match(String(url), /^https:\/\/www\.googleapis\.com\/customsearch\/v1\?/); return new Response(JSON.stringify(body), { status }); };

test("Google images: key, engine id and the image search type are sent; each result keeps picture, thumbnail, source page and host", async () => {
  let seen = "";
  const r = await googleImages("Maaza juice", { key: "AIzaK", cx: "cx1", transparent: true, fetchImpl: async (url) => { seen = String(url); return api()(url); } });
  const q = new URL(seen).searchParams;
  assert.equal(q.get("key"), "AIzaK"); assert.equal(q.get("cx"), "cx1"); assert.equal(q.get("searchType"), "image"); assert.equal(q.get("imgColorType"), "trans"); assert.equal(q.get("gl"), "in");
  assert.deepEqual(r.map((x) => x.host), ["amazon.in", "enjoymaaza.com", "shop.in"]); assert.equal(r[0].thumb, "https://t/1");
  await assert.rejects(() => googleImages("x", { key: "k", cx: "c", fetchImpl: api(403, { error: { message: "Custom Search API has not been used in project 1 before" } }) }), /has not been used/);
});

test("image search: with a Google key it answers from Google and never touches the scraped pages; if Google fails it falls back", async () => {
  setImageSearchConfig(() => ({ googleKey: "AIzaK", googleCx: "cx1" }));
  try {
    const touched = [];
    const ok = await imageSearch("Maaza juice", { fetchImpl: async (url) => { touched.push(String(url).split("?")[0]); return api()(url); } });
    assert.equal(ok.length, 3); assert.deepEqual([...new Set(touched)], ["https://www.googleapis.com/customsearch/v1"]);
    const bing = ` m="${JSON.stringify({ t: "Maaza Mango", murl: "https://b/1.jpg", purl: "https://shop.in/maaza", turl: "https://t" }).replace(/"/g, "&quot;")}"`;
    const fb = await imageSearch("Maaza juice", { fetchImpl: async (url) => (String(url).startsWith("https://www.googleapis.com/") ? api(429, { error: { message: "quota" } })(url) : new Response(`<a${bing}></a>`, { status: 200 })) });
    assert.equal(fb[0].url, "https://b/1.jpg", "a Google error (quota, key) falls back to the scraped pages");
  } finally { setImageSearchConfig(() => ({ googleKey: "", googleCx: "" })); }
});
