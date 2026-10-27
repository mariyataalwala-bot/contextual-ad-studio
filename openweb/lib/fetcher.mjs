// Polite HTTP fetching for feeds and articles: robots.txt honoured, one request per domain every few seconds,
// timeouts and size caps. Bot protection (403 / captcha pages) is reported as "blocked" — never worked around.
import { parseRobots, robotsAllows } from "./feeds.mjs";

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_BYTES = 6 * 1024 * 1024;

export class FetchError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** @param {{ fetchImpl?: any, gapMs?: number, timeoutMs?: number, now?: () => number, sleep?: (ms: number) => Promise<any> }} [opts] */
export function makeFetcher({ fetchImpl = globalThis.fetch, gapMs = 2500, timeoutMs = 25000, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const robots = new Map(), last = new Map();
  async function polite(host) {
    const wait = (last.get(host) || 0) + gapMs - now();
    last.set(host, Math.max(now(), (last.get(host) || 0) + gapMs));
    if (wait > 0) await sleep(wait);
  }
  async function raw(url, accept) {
    const u = new URL(url); await polite(u.host);
    let r;
    try { r = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-IN,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new FetchError("NETWORK", `${u.host}: ${e.cause?.code || e.message}`.slice(0, 200)); }
    if (r.status === 403 || r.status === 429) throw new FetchError("BLOCKED", `${u.host} refused the request (HTTP ${r.status}) — needs a publisher feed or allowlisting`);
    if (!r.ok) throw new FetchError("HTTP_" + r.status, `${url} → HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new FetchError("TOO_LARGE", `${url} is larger than ${MAX_BYTES} bytes`);
    const text = buf.toString("utf8");
    if (/<title>\s*(Access Denied|Attention Required|Just a moment)/i.test(text)) throw new FetchError("BLOCKED", `${u.host} served a bot-check page — not bypassed`);
    return { text, finalUrl: r.url || url, status: r.status };
  }
  async function allowed(url) {
    const u = new URL(url);
    if (!robots.has(u.host)) {
      robots.set(u.host, raw(`${u.protocol}//${u.host}/robots.txt`, "text/plain").then((r) => parseRobots(r.text, "Mozilla")).catch((e) => {
        if (e.code === "HTTP_404" || e.code === "HTTP_410") return [];   // no robots.txt = no restrictions
        throw e;
      }));
    }
    return robotsAllows(await robots.get(u.host), u.pathname + u.search);
  }
  return {
    async get(url, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8") {
      if (!(await allowed(url))) throw new FetchError("ROBOTS", `robots.txt disallows ${url}`);
      return raw(url, accept);
    },
    allowed,
  };
}
