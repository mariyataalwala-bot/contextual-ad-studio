// Live check of discovery for six brands: Firecrawl Search results recorded on 2026-10-29 (fixtures/firecrawl-search.*.json,
// the top topic per publisher and the campaign query) are replayed; every page is then read live by the app's reader
// (the page, then Trafilatura) and checked: date, staleness, relevance, safety, campaign evidence.
// Not part of `npm test` (it reads publisher sites). Run: node test/openweb/live/discover.replay.mjs [Brand]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeFirecrawl, discoverArticles, discoverCampaigns } from "../../../openweb/lib/discover.mjs";
import { makeReader } from "../../../openweb/lib/reader.mjs";
import { makeFetcher } from "../../../openweb/lib/fetcher.mjs";
import { loadStudioConfig, rivalMatcher } from "../../../openweb/lib/studio.mjs";
import { loadBrands, findBrand, namesBrand } from "../../../openweb/lib/brands.mjs";
import { loadConfig } from "../../../openweb/lib/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), APP = path.resolve(HERE, "../../..");
const CONFIG = path.join(APP, "openweb", "config");
const studio = loadStudioConfig(CONFIG), brands = loadBrands(CONFIG), cfg = loadConfig();
const recorded = Object.assign({}, ...["part1", "part2"].map((p) => JSON.parse(fs.readFileSync(path.join(HERE, "..", "fixtures", `firecrawl-search.${p}.json`), "utf8"))));
const NOW = Date.parse("2026-10-29T06:30:00Z");

// the Firecrawl API, answered from the recording (a query that was not recorded gets no results, and is reported)
const notRecorded = [];
const fetchImpl = async (url, init) => {
  if (!String(url).startsWith("https://api.firecrawl.dev/")) return globalThis.fetch(url, init);
  const q = JSON.parse(init.body).query || "";
  const key = Object.keys(recorded).find((k) => q === k || q.startsWith(k + " ("));
  if (!key) notRecorded.push(q);
  const web = (recorded[key] || []).map(([u, title, description]) => ({ url: u, title, description }));
  return { ok: true, status: 200, json: async () => ({ success: true, data: { web } }) };
};
const py = (args) => new Promise((res, rej) => { const p = spawn(process.platform === "win32" ? "python" : "python3", [path.join(APP, "pipeline", "scripts", args[0]), ...args.slice(1)], { windowsHide: true });
  let out = "", err = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
  const t = setTimeout(() => p.kill(), 60000); p.on("close", (c) => { clearTimeout(t); c === 0 ? res(out) : rej(new Error(err.slice(-300))); }); });

const fc = makeFirecrawl({ key: "replay", fetchImpl, cacheDir: null });
const reader = makeReader({ fetcher: makeFetcher({ fetchImpl: globalThis.fetch, gapMs: 600 }), py, firecrawl: null, fetchImpl: globalThis.fetch, timeoutMs: 30000, tmpDir: path.join(os.tmpdir(), "mk-replay") });
const publishers = [...studio.sections, ...(studio.sitemaps || [])].map((p) => ({ domain: p.domain, id: p.id }));
// topics for brands outside the brand file are the words the studio's AI step would give (written here by hand)
// (and so are their rivals)
/** @type {[string, string, string[]?, string[]?][]} */
const CASES = [["Zomato", "food delivery"], ["Amul", "butter", ["butter", "breakfast", "paratha"], ["Mother Dairy", "Britannia", "Nandini", "Go Cheese"]], ["Maaza", "mango drink"],
  ["Nykaa", "lipstick", ["lipstick", "makeup", "skincare"], ["Purplle", "Myntra", "Tira", "Sugar Cosmetics", "Lakme", "Maybelline"]],
  ["Tata Motors", "Nexon EV", ["electric car", "suv", "road trip"], ["Mahindra", "Hyundai", "Maruti", "MG", "Kia", "BMW", "Mercedes", "Tesla", "BYD", "Toyota", "Honda"]],
  ["Fevicol", "adhesive", ["adhesive", "carpentry", "furniture"], ["Araldite", "Fevikwik", "Anchor", "3M"]]];

const only = process.argv[2];
const report = [];
for (const [brand, product, own, rivalNames] of CASES.filter((c) => !only || c[0] === only)) {
  const known = findBrand(brands, brand, product);
  const topics = own || [product, ...(known?.topics || [])];
  const rivals = rivalMatcher([...(known?.competitors || []), ...(rivalNames || [])]), ownNews = (t) => (known ? namesBrand(known, t) : new RegExp(`\\b${brand}\\b`, "i").test(t));
  const t0 = Date.now();
  const [a, c] = await Promise.all([
    discoverArticles({ brand, product, topics, rivals, ownNews, publishers, days: studio.discovery.articleDays, fc, reader, cfg, maxRead: studio.discovery.maxRead, perPublisher: 3, limit: 5, now: NOW }),
    discoverCampaigns({ brand, product, aliases: known?.aliases || [], months: studio.discovery.campaignMonths, fc, reader, tradePress: studio.discovery.tradePress, maxRead: studio.discovery.maxCampaignReads, now: NOW }),
  ]);
  report.push({ brand, product, seconds: Math.round((Date.now() - t0) / 1000), articles: a, campaigns: c });
  console.log(`\n=== ${brand} (${product}) — ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const x of a.candidates) console.log(`  ARTICLE ${x.score}  ${x.date?.slice(0, 10) || "no date"}  ${x.title.slice(0, 80)}\n          ${x.url}\n          ${x.reason}${x.flags.length ? "  ⚑ " + x.flags.join("; ") : ""}`);
  if (!a.candidates.length) console.log("  ARTICLE none —", a.flags.join("; "));
  const tally = {}; for (const e of a.excluded) { const k = e.why.replace(/\(.*$/, "").replace(/published \S+, /, "").trim(); tally[k] = (tally[k] || 0) + 1; }
  console.log("  left out:", JSON.stringify(tally));
  for (const x of c.verified) console.log(`  CAMPAIGN ✓ ${x.forProduct === false ? "(other line) " : ""}${x.date.slice(0, 10)} ${x.name ? `"${x.name}" ` : ""}${x.title.slice(0, 70)}\n             “${x.evidence.slice(0, 160)}”`);
  for (const x of c.unverified) console.log(`  CAMPAIGN ? ${x.title.slice(0, 70)} — ${x.why}`);
  const ct = {}; for (const e of c.excluded) { const k = e.why.replace(/\(.*$/, "").trim(); ct[k] = (ct[k] || 0) + 1; }
  console.log("  campaigns left out:", JSON.stringify(ct), c.flags.length ? "⚑ " + c.flags.join("; ") : "");
}
if (notRecorded.length) console.log(`\n(${notRecorded.length} queries were not recorded and returned nothing)`);
fs.writeFileSync(path.join(os.tmpdir(), "mk-discover-replay.json"), JSON.stringify(report, null, 1));
