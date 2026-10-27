// Test helpers. All article HTML here is synthetic test data written for these tests — not real publisher content.
import { loadConfig } from "../../openweb/lib/config.mjs";
import { extractArticle } from "../../openweb/lib/extract.mjs";
import { lexicalFeatures } from "../../openweb/lib/analyse.mjs";
import { pageSafety } from "../../openweb/lib/safety.mjs";
import { sha256 } from "../../openweb/lib/text.mjs";
import { articleId } from "../../openweb/lib/store.mjs";

export const cfg = loadConfig();

/** @param {{ headline?: string, paras?: string[], section?: string|null, image?: string|null, ld?: boolean, nav?: string, date?: string }} o */
export function html({ headline = "", paras = [], section = null, image = "https://img.example.test/lead.jpg", ld = true, nav = "", date = "2026-10-20T10:00:00+05:30" }) {
  const body = paras.join("\n\n");
  const json = { "@context": "https://schema.org", "@type": "NewsArticle", headline, articleBody: body, datePublished: date, ...(section ? { articleSection: section } : {}), ...(image ? { image } : {}) };
  return `<!doctype html><html lang="en"><head><title>${headline}</title>${image ? `<meta property="og:image" content="${image}">` : ""}
${ld ? `<script type="application/ld+json">${JSON.stringify(json)}</script>` : ""}</head>
<body><nav>${nav}</nav><h1>${headline}</h1>${paras.map((p) => `<p>${p}</p>`).join("")}<footer>${nav}</footer></body></html>`;
}

// AI stub: returns a fixed answer (or throws), records calls
export function fakeAsk(answer, { image = { objects: [] } } = {}) {
  const calls = [];
  const fn = async (system, text, schema, images) => {
    calls.push({ system, text, images });
    if (answer instanceof Error) throw answer;
    return images?.length ? image : answer;
  };
  fn.calls = calls;
  return fn;
}
export const aiOk = (over = {}) => ({ status: "ok", categories: [], sensitive: [], entities: [], objects: [], dropped: [], ...over });

// Build a stored-article record the way the pipeline does, from synthetic HTML.
/** @param {Record<string, any>} o @returns {Record<string, any>} */
export function article({ url = "https://www.news18.com/food/test-article-1.html", publisherId = "news18-food", ai = aiOk(), ...h }) {
  const a = extractArticle(html(h), url);
  const lexical = lexicalFeatures(a, cfg);
  const features = { lexical, ai };
  return { id: articleId(url), url, publisherId, fetchedAt: "2026-10-26T06:00:00Z", contentHash: sha256(`${a.headline}\n${a.body}`), ...a, features, safety: pageSafety(a, features, cfg.safety), versions: cfg.versions };
}

export const pub = (id = "news18-food") => cfg.publishers.publishers.find((p) => p.id === id);

export function campaign(over = {}) {
  return {
    id: "c-test", brand: "TestBrand", product: "Test product", status: "active", start: "2026-10-01", end: "2026-12-31",
    creatives: [{ id: "cr1", label: "Test creative", format: "in-image", file: "" }],
    targeting: { iab: ["210"], keywords: [], objects: [] }, exclusions: { competitors: [], keywords: [], iab: [] },
    ...over,
    ...(over.targeting ? { targeting: { iab: [], keywords: [], objects: [], ...over.targeting } } : {}),
    ...(over.exclusions ? { exclusions: { competitors: [], keywords: [], iab: [], ...over.exclusions } } : {}),
  };
}

export const NOW = new Date("2026-10-26T06:30:00Z");   // 12:00 IST

// Long, neutral filler so bodies pass the minimum length without adding signals
export const FILLER = "This section was written for the test suite and describes nothing in particular, so that the body is long enough for the policy minimum without adding category or safety signals of its own.";
