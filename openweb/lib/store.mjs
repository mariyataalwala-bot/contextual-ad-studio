// Evidence store: plain JSON files under one data folder, so every fact can be opened and checked by hand.
//   articles/<id>.json    fetched article + features + safety, with the fetch time and content hash
//   campaigns.json        campaigns you enter (no campaign → no recommendation)
//   reviews.jsonl         human review decisions, append-only
//   recommendations.json  the latest recommendation run, with config versions
//   embeddings.json       meaning vectors of articles and campaign briefs (model + text hash → unit vector)
//   creatives/            source creative files you supply
//   mocks/                rendered mock screenshots
//   snapshots/            dated copies of imported inventory (showcase feed)
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./text.mjs";

export const articleId = (url) => sha256(String(url).replace(/[#?].*$/, "").replace(/\/$/, "")).slice(0, 16);

export function makeStore(root) {
  const p = (...a) => path.join(root, ...a);
  for (const d of ["articles", "creatives", "mocks", "snapshots"]) fs.mkdirSync(p(d), { recursive: true });
  const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { if (e.code === "ENOENT") return dflt; throw new Error(`${path.basename(f)} is not valid JSON: ${e.message}`); } };
  const writeJson = (f, v) => { const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, f); };   // atomic replace
  return {
    root,
    dir: p,
    saveArticle: (a) => writeJson(p("articles", a.id + ".json"), a),
    getArticle: (id) => (/^[0-9a-f]{16}$/.test(id) ? readJson(p("articles", id + ".json"), null) : null),
    listArticles: () => fs.readdirSync(p("articles")).filter((f) => f.endsWith(".json")).map((f) => readJson(p("articles", f), null)).filter(Boolean),
    getCampaigns: () => readJson(p("campaigns.json"), { campaigns: [] }).campaigns,
    saveCampaigns: (campaigns) => writeJson(p("campaigns.json"), { note: "Entered by MediaKart users. Only active campaigns inside their dates can be recommended.", campaigns }),
    addReview: (r) => fs.appendFileSync(p("reviews.jsonl"), JSON.stringify(r) + "\n"),
    getReviews: () => { try { return fs.readFileSync(p("reviews.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { if (e.code === "ENOENT") return []; throw e; } },
    saveRecommendations: (r) => writeJson(p("recommendations.json"), r),
    getVectors: () => readJson(p("embeddings.json"), {}),
    saveVectors: (v) => writeJson(p("embeddings.json"), v),
    getRecommendations: () => readJson(p("recommendations.json"), null),
    writeJson, readJson,
  };
}
