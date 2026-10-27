// robots.txt rules and RSS / sitemap parsing. No network here — fetcher.mjs does the requests.

// robots.txt → rules for our user agent (falls back to the "*" group). Supports * and $ in paths, longest match wins.
export function parseRobots(txt, agent = "*") {
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of String(txt || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); if (!line) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === "user-agent") { if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v });
  }
  const a = agent.toLowerCase();
  const g = groups.find((x) => x.agents.some((n) => n !== "*" && a.includes(n))) || groups.find((x) => x.agents.includes("*"));
  return g ? g.rules.filter((r) => r.path !== "" || r.allow) : [];
}
const ruleRe = (p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
export function robotsAllows(rules, urlPath) {
  let best = null;
  for (const r of rules) {
    if (r.path === "") continue;
    if (ruleRe(r.path).test(urlPath) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

const decode = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml); return m ? decode(m[1]) : ""; };

// RSS 2.0 / Atom / sitemap (incl. Google News sitemaps) → [{ url, title, published }]
export function parseFeed(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) out.push({ url: tag(m[0], "link"), title: tag(m[0], "title"), published: tag(m[0], "pubDate") || tag(m[0], "dc:date") || null });
  if (!out.length) for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) { const href = /<link[^>]*href="([^"]+)"/i.exec(m[0]); out.push({ url: decode(href?.[1] || tag(m[0], "link")), title: tag(m[0], "title"), published: tag(m[0], "published") || tag(m[0], "updated") || null }); }
  if (!out.length) for (const m of xml.matchAll(/<url>[\s\S]*?<\/url>/gi)) out.push({ url: tag(m[0], "loc"), title: tag(m[0], "news:title"), published: tag(m[0], "news:publication_date") || tag(m[0], "lastmod") || null });
  return out.filter((x) => /^https?:\/\//.test(x.url)).map((x) => ({ ...x, published: x.published && !isNaN(Date.parse(x.published)) ? new Date(x.published).toISOString() : null }));
}

// Page types that never carry an article body (web stories, AMP stories, videos, live blogs).
export const notAnArticle = (url) => /\/(web-?stories|ampstories|videos?|live-updates|liveblog|photos?-?gallery-?index)\//i.test(new URL(url).pathname);
