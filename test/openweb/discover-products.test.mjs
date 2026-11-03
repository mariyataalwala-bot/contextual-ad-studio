// Product discovery at brand and category level: "Himalaya" + "Facewash" lists the brand's real face washes (names cut from real
// search-result titles or the brand knowledge file), each with a picture; other brands and other product types are left out.
// Everything here is offline: a fake image search with Himalaya-style titles, a fake AI, a fake Bing page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { discoverProducts, nameFromTitle } from "../../openweb/lib/discover-products.mjs";
import { foldKey, termTokens, categoryOf, mentionsCategory, otherCategories } from "../../openweb/lib/product-terms.mjs";
import { loadBrands, findBrand } from "../../openweb/lib/brands.mjs";
import { createOpenWeb } from "../../openweb/routes.mjs";

const brands = loadBrands();
const r = (title, host, n) => ({ title, url: `https://img.${host}/p${n}.jpg`, thumb: `https://th.bing.com/th?id=${n}`, page: `https://${host}/p/${n}`, host });
const RESULTS = [
  r("Himalaya Purifying Neem Face Wash - 100 ml | Himalaya Wellness", "himalayawellness.in", 1),
  r("Himalaya Purifying Neem Face Wash 150ml, Buy Online at Best Price", "amazon.in", 2),
  r("Himalaya Neem Face Wash (Pack of 2) - Nykaa", "nykaa.com", 3),
  r("Himalaya Detoxifying Charcoal Face Wash 100ml | jiomart.com", "jiomart.com", 4),
  r("HIMALAYA OIL CLEAR LEMON FACE WASH", "flipkart.com", 5),
  r("Himalaya Tan Removal Orange Face Wash - 100 ml", "bigbasket.com", 6),
  r("Garnier Pure Active Neem Face Wash", "garnier.in", 7),
  r("Himalaya Anti-Hair Fall Shampoo with Bhringaraja 400 ml", "amazon.in", 8),
  r("Himalaya Neem Face Wash and Shampoo Combo", "amazon.in", 9),
  r("Himalaya vs Garnier face wash comparison", "blog.example.in", 10),
  r("Himalaya Wellness logo png", "logos.example.com", 11),
  r("Dabur Gulabari Face Wash", "dabur.com", 12),
];
const fakeSearch = (list = RESULTS) => { const f = async (q) => { f.queries.push(q); return list; }; f.queries = /** @type {string[]} */ ([]); return f; };
const NAMES = ["Himalaya Purifying Neem Face Wash", "Himalaya Detoxifying Charcoal Face Wash", "Himalaya Oil Clear Lemon Face Wash", "Himalaya Tan Removal Orange Face Wash"];

// ---------- words: compound and spaced spellings are one ----------
test("compound and spaced forms are the same word: facewash = face wash, bodylotion = body lotion, hairoil = hair oil", () => {
  for (const [a, b] of [["Facewash", "face wash"], ["FACE-WASH", "face wash"], ["bodylotion", "Body Lotion"], ["hairoil", "hair oil"], ["Handwash", "hand wash"], ["sunscreen", "sun screen"], ["moisturizer", "moisturiser"], ["lipbalm", "lip balm"]])
    assert.equal(foldKey(a), foldKey(b), `${a} = ${b}`);
  assert.deepEqual(termTokens("Face Washes"), ["face", "wash"], "plural forms fold too");
  assert.equal(foldKey("Pond's  Cold-Cream"), "pond s cold cream");
  assert.equal(foldKey("Maggi 2-Minute Noodles"), "maggi 2 minute noodles", "words that are not in the vocabulary are left alone");
});

test("brand lookup treats compound and spaced forms as equal", () => {
  for (const [brand, product] of [["Himalaya Facewash", ""], ["Himalaya Face Wash", ""], ["himalaya", "Facewash"], ["HIMALAYA", "face wash"]]) assert.equal(findBrand(brands, brand, product)?.id, "himalaya", `${brand} / ${product}`);
  assert.equal(findBrand(brands, "Nestle", "Maggi Noodles")?.name, "Maggi", "sub-brands still win over their parent");
  assert.equal(findBrand(brands, "No Such Brand Facewash", ""), null);
});

test("category: the phrase, its synonyms and the head noun; other product types are told apart", () => {
  const fw = categoryOf("Facewash");
  assert.deepEqual(fw.phrases, ["face wash"]);
  assert.ok(mentionsCategory("Himalaya Neem Face Wash", fw) && mentionsCategory("neem facewash 100ml", fw) && mentionsCategory("Gentle Face Cleanser", fw));
  assert.ok(!mentionsCategory("Himalaya Anti-Hair Fall Shampoo", fw) && !mentionsCategory("Neem Face Pack", fw) && !mentionsCategory("Hand Wash", fw));
  assert.deepEqual(otherCategories("Neem Face Wash and Shampoo Combo", fw), ["shampoo"]);
  assert.deepEqual(otherCategories("Tea Tree Face Wash", fw), [], "everyday words are not other categories");
  assert.deepEqual(categoryOf("Power Running Shoes").variants, [["shoe"]], "no vocabulary entry: the last word is the head noun");
  assert.ok(mentionsCategory("Bata Power sports shoes", categoryOf("Power running shoes")));
});

test("name from a title: shop words, sizes, brackets and the site name are cut; the product name stays", () => {
  const cat = categoryOf("face wash"), o = { names: (t) => /himalaya/i.test(t), category: (t) => mentionsCategory(t, cat), brandLabel: "Himalaya" };
  assert.equal(nameFromTitle("Himalaya Purifying Neem Face Wash - 100 ml | Himalaya Wellness", o), "Himalaya Purifying Neem Face Wash");
  assert.equal(nameFromTitle("Himalaya Purifying Neem Face Wash 150ml, Buy Online at Best Price", o), "Himalaya Purifying Neem Face Wash");
  assert.equal(nameFromTitle("HIMALAYA OIL CLEAR LEMON FACE WASH", o), "Himalaya Oil Clear Lemon Face Wash");
  assert.equal(nameFromTitle("Neem Face Wash (Pack of 2) | Himalaya Wellness", o), "Himalaya Neem Face Wash", "the brand comes from the title's own site-name part");
  assert.equal(nameFromTitle("Himalaya Shampoo 400 ml", o), "");
});

// ---------- discovery ----------
test("Himalaya + Facewash: the face-wash variants are listed with real names and pictures; other brands, shampoo, bundles and logos are not", async () => {
  const search = fakeSearch(), out = await discoverProducts({ brand: "Himalaya", product: "Facewash", brands, search });
  assert.equal(out.brand, "Himalaya Wellness");
  assert.equal(out.query.normalised, "face wash");
  assert.deepEqual(search.queries, ["Himalaya Facewash", "Himalaya face wash", "Himalaya face wash range", "Himalaya face wash variants"], "typed, normalised, range, variants");
  const names = out.items.map((x) => x.name);
  assert.deepEqual([...names].sort(), [...NAMES].sort(), "the four variants, the Neem one once although three results show it");
  for (const x of out.items) { assert.ok(x.picture?.thumb && x.picture.page && x.picture.host, `${x.name} has a picture with its source page`); assert.equal(x.match, "category", "typed the category only: every variant is a category match"); }
  assert.ok(!names.some((n) => /garnier|dabur|shampoo|combo|logo|vs/i.test(n)), "no other brand, no shampoo, no bundle, no logo");
  assert.equal(names[0], "Himalaya Purifying Neem Face Wash", "the official site's product, which the brand knowledge names too, comes first");
  assert.equal(out.items[0].official, true); assert.equal(out.items[0].picture.host, "himalayawellness.in", "its picture is the official site's, not a shop's");
});

test("exact matches rank first: typing 'Neem Face Wash' puts the Neem products before the other variants", async () => {
  const more = [...RESULTS, r("Himalaya Neem Face Wash for Oily Skin", "himalayawellness.in", 20), r("Himalaya Gentle Exfoliating Daily Clean Face Wash", "amazon.in", 21)];
  const out = await discoverProducts({ brand: "Himalaya", product: "Neem Facewash", brands, search: fakeSearch(more) });
  assert.deepEqual(out.items.map((x) => x.match), ["exact", "exact", "category", "category", "category", "category"].slice(0, out.items.length));
  assert.ok(/neem/i.test(out.items[0].name) && /neem/i.test(out.items[1].name), out.items.map((x) => x.name).join(" | "));
  assert.ok(out.items.filter((x) => x.match === "category").every((x) => !/neem/i.test(x.name)));
  assert.ok(out.items.every((x) => !/garnier/i.test(x.name)));
});

test("a name that is just brand + product is exact; the other variants are related", async () => {
  const list = [r("Himalaya Face Wash", "amazon.in", 1), ...RESULTS.slice(0, 6)];
  const out = await discoverProducts({ brand: "Himalaya", product: "face wash", brands, search: fakeSearch(list) });
  assert.equal(out.items[0].name, "Himalaya Face Wash"); assert.equal(out.items[0].match, "exact");
  assert.ok(out.items.slice(1).every((x) => x.match === "category"));
});

test("no name is made up: every word of every name is in a search-result title or the brand knowledge file", async () => {
  const known = findBrand(brands, "Himalaya", "");
  const allowed = new Set([...RESULTS.map((x) => x.title), ...known.products, known.name].flatMap((t) => termTokens(t)));
  for (const ask of [null, async () => ({ groups: [] })]) {
    const out = await discoverProducts({ brand: "Himalaya", product: "Facewash", brands, search: fakeSearch(), ask });
    assert.ok(out.items.length >= 4);
    for (const x of out.items) for (const w of termTokens(x.name)) assert.ok(allowed.has(w), `“${w}” in “${x.name}” is from no title`);
  }
  // with no search result at all, only the brand knowledge file's own product name is offered — and it has no picture
  const none = await discoverProducts({ brand: "Himalaya", product: "Facewash", brands, search: fakeSearch([]) });
  assert.deepEqual(none.items.map((x) => [x.name, x.picture, x.source, x.known]), [["Himalaya Purifying Neem Face Wash", null, "brand knowledge", true]]);
});

test("the AI step is one text-only call; it can merge, drop and tidy, but an invented name is refused", async () => {
  const calls = [];
  const ask = async (system, text, schema, images, effort) => {
    calls.push({ text, images, effort });
    const rows = text.split("\n").filter((l) => /^\d+ \| /.test(l)).map((l) => ({ id: +l.split(" | ")[0], name: l.split(" | ")[1] }));
    return { groups: rows.map((g) => ({ id: g.id, keep: !/orange/i.test(g.name), merge_into: -1, name: /charcoal/i.test(g.name) ? "Himalaya Ultra Glow Gold Face Wash" : g.name })) };   // drops Orange; invents a name for Charcoal
  };
  const out = await discoverProducts({ brand: "Himalaya", product: "Facewash", brands, search: fakeSearch(), ask });
  assert.equal(calls.length, 1, "exactly one AI call"); assert.deepEqual(calls[0].images, [], "text only");
  assert.ok(/Garnier/.test(calls[0].text) === false, "the other brand never reaches the AI: it was left out before");
  const names = out.items.map((x) => x.name);
  assert.ok(!names.some((n) => /orange/i.test(n)), "the AI dropped the Orange one");
  assert.ok(names.includes("Himalaya Detoxifying Charcoal Face Wash") && !names.some((n) => /ultra glow/i.test(n)), "the invented name is refused, the title's own name is kept");
  // a merge: the AI says two groups are one product
  const merging = async (_s, text) => { const ids = text.split("\n").filter((l) => /^\d+ \| /.test(l)).map((l) => ({ id: +l.split(" | ")[0], name: l.split(" | ")[1] }));
    const lemon = ids.find((g) => /lemon/i.test(g.name)), orange = ids.find((g) => /orange/i.test(g.name));
    return { groups: ids.map((g) => ({ id: g.id, keep: true, merge_into: g === orange ? lemon.id : -1, name: g.name })) }; };
  const merged = await discoverProducts({ brand: "Himalaya", product: "Facewash", brands, search: fakeSearch(), ask: merging });
  assert.equal(merged.items.length, NAMES.length - 1);
  // a failing AI: the rule-based list is returned and the reason is noted
  const failing = await discoverProducts({ brand: "Himalaya", product: "Facewash", brands, search: fakeSearch(), ask: async () => { throw new Error("quota"); } });
  assert.equal(failing.items.length, NAMES.length); assert.match(failing.notes.join(" "), /AI grouping skipped: quota/);
});

test("rival and other-category titles never reach the list, even from the AI's side; a brand that is not in the knowledge file works from its typed name", async () => {
  const list = [r("Whisper Ultra Clean Sanitary Pads", "amazon.in", 1), r("Acme Glow Face Wash 100 ml", "acme.in", 2), r("Acme Fresh Face Wash", "amazon.in", 3), r("Garnier Acme Face Wash", "amazon.in", 4), r("Acme Hand Wash Refill", "amazon.in", 5)];
  const out = await discoverProducts({ brand: "Acme", product: "facewash", brands, search: fakeSearch(list) });
  assert.equal(out.brand, "Acme");
  assert.deepEqual(out.items.map((x) => x.name).sort(), ["Acme Fresh Face Wash", "Acme Glow Face Wash"]);
});

test("at most 12 items; a search that fails is noted, not thrown", async () => {
  const many = Array.from({ length: 14 }, (_, i) => r(`Himalaya Variant${String.fromCharCode(65 + i)} Face Wash`, "amazon.in", i + 1));
  assert.equal((await discoverProducts({ brand: "Himalaya", product: "Facewash", brands, search: fakeSearch(many) })).items.length, 12);
  const broken = await discoverProducts({ brand: "Himalaya", product: "Facewash", brands, search: async () => { throw new Error("offline"); } });
  assert.match(broken.notes.join(" "), /failed: offline/); assert.equal(broken.items.length, 1, "the brand knowledge product is still offered");
});

// ---------- the real search path, with a fake Bing page ----------
const tile = (title, murl, purl) => ` m="${JSON.stringify({ t: title, murl, purl, turl: murl + "?t" }).replace(/"/g, "&quot;")}"`;
const bingFetch = (list) => async (url) => {
  assert.match(String(url), /^https:\/\/www\.bing\.com\/images\/search\?/, "only Bing is asked (its results are relevant, so no fallback)");
  return new Response(`<html><body>${list.map((x) => `<a class="iusc"${tile(x.title, x.url, x.page)}></a>`).join("")}</body></html>`, { status: 200 });
};
test("through the real image search (a fake Bing page): the same list", async () => {
  const out = await discoverProducts({ brand: "Himalaya", product: "Facewash", brands, fetchImpl: bingFetch(RESULTS) });
  assert.deepEqual(out.items.map((x) => x.name).sort(), [...NAMES].sort());
  assert.ok(out.items.every((x) => /^https:\/\/img\./.test(x.picture.url) && x.picture.thumb.endsWith("?t")));
});

// ---------- the route ----------
async function serve(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-products-"));
  const ow = createOpenWeb({ dataDir: path.join(dir, "data"), studioDir: path.join(dir, "inimage"), ...opts });
  const srv = http.createServer((req, res) => ow.handle(req, res, new URL(req.url, "http://x"), { local: true }));
  await new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(null)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  return { srv, get: (p) => fetch(base + p).then(async (x) => ({ status: x.status, json: await x.json() })) };
}
test("GET /api/ow/products?brand=&product= returns { brand, query, items }", async () => {
  let asked = 0;
  const { srv, get } = await serve({ fetchImpl: async (u) => { asked++; return bingFetch(RESULTS)(u); } });
  try {
    const x = await get("/api/ow/products?brand=Himalaya&product=Facewash");
    assert.equal(x.status, 200); assert.equal(x.json.brand, "Himalaya Wellness"); assert.equal(x.json.query.product, "Facewash"); assert.equal(x.json.query.normalised, "face wash");
    assert.deepEqual(x.json.items.map((i) => i.name).sort(), [...NAMES].sort());
    assert.ok(x.json.items.every((i) => i.picture.thumb && ["exact", "category"].includes(i.match)));
    const n = asked; await get("/api/ow/products?brand=himalaya&product=facewash");
    assert.equal(asked, n, "the same lookup within minutes is answered from memory");
    assert.equal((await get("/api/ow/products?brand=Himalaya")).status, 400);
    assert.equal((await get("/api/ow/products?product=Facewash")).status, 400);
    const banned = await get("/api/ow/products?brand=Nestle&product=Lactogen");
    assert.equal(banned.status, 400); assert.match(banned.json.error, /IMS Act/);
  } finally { srv.close(); }
});

// ---------- the picked product's photo link is used by the 2-in-1 panel (and refused unless https) ----------
test("2-in-1 panel: a product photo link (picked from the list) replaces the searched pictures and goes through the same cut-out and check", async () => {
  const { preparePanel } = await import("../../openweb/lib/panel-assets.mjs");
  const { loadStudioConfig } = await import("../../openweb/lib/studio.mjs");
  const { fakeAsk } = await import("./helpers.mjs");
  const studio = loadStudioConfig(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-panel-pick-"));
  const link = "https://himalayawellness.in/cdn/neem.png", seen = /** @type {string[]} */ ([]);
  const png = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.alloc(3000, 7)]);
  const fetchImpl = async (u) => { seen.push(String(u)); return String(u) === link ? new Response(png, { status: 200, headers: { "content-type": "image/png" } }) : new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }); };
  const ask = fakeAsk({ headline: "Clear skin starts here today", subline: "Discover Himalaya Purifying Neem Face Wash", cta: studio.copy.ctas[0], category: "face wash", highlights: [], opener: "Fresh start?" }, { image: /** @type {any} */ ({ ok: true, problem: "", kind: "cutout", logo_ok: true, logo_problem: "" }) });
  const py = async (a) => (a[0] === "cutout.py" && a[1] === "product" ? JSON.stringify({ method: "cutout", clear: 0 }) : "");
  const r = await preparePanel({ brand: "Himalaya", product: "Purifying Neem Face Wash", known: null, studio, ask, py, ffmpeg: async () => {}, fetchImpl, workDir: dir, budgetMs: 60000, productImage: link, productThumb: "https://th.bing.com/th?id=1" });
  assert.ok(seen.includes(link), "the link was downloaded");
  assert.ok(r.product?.endsWith("product.png"), "and it became the panel's product picture"); assert.equal(r.productInfo.url, link); assert.equal(r.productInfo.title, "photo link given by the user");
  assert.ok(!r.flags.some((f) => /No pictures of/.test(f)), "no 'nothing found online' note: the picture was given");
});

test("2-in-1 start: the product photo link must be https", async () => {
  const { srv } = await serve({ ask: async () => ({}), provider: () => "gemini", py: async () => "", ffmpeg: async () => {} });
  try {
    const base = srv.address(); assert.ok(base);
    const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (base).port}/api/ow/twoinone/start`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: "Himalaya", product: "Neem Face Wash", productImage: "http://x.test/neem.png", youtubeId: "dQw4w9WgXcQ" }) });
    assert.equal(res.status, 400); assert.match((await res.json()).error, /must start with https/);
  } finally { srv.close(); }
});
