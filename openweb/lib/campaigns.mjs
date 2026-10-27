// Campaign records (entered by people, never generated) and the date / status gate.
import path from "node:path";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => DATE.test(s || "") && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().startsWith(s);
// Today in India (campaign dates are IST calendar dates, inclusive at both ends)
export const todayIST = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const list = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,\n]/)).map((x) => String(x).trim()).filter(Boolean);

// Clean up form input into the stored shape; returns { campaign, problems }.
export function normaliseCampaign(input, cfg) {
  const c = {
    id: String(input.id || "").trim() || "c" + Date.now().toString(36),
    brand: String(input.brand || "").trim(),
    product: String(input.product || "").trim(),
    status: String(input.status || "").trim(),
    start: String(input.start || "").trim(),
    end: String(input.end || "").trim(),
    creatives: (input.creatives || []).map((k, i) => ({ id: String(k.id || `cr${i + 1}`), label: String(k.label || "").trim(), format: String(k.format || "").trim(), file: String(k.file || "").trim(), showcaseRef: k.showcaseRef ? String(k.showcaseRef) : null })),
    brief: String(input.brief || "").replace(/\s+/g, " ").trim().slice(0, 1500),   // what the brand sells and when people need it — used for meaning match
    targeting: { iab: list(input.targeting?.iab), keywords: list(input.targeting?.keywords), objects: list(input.targeting?.objects).map((x) => x.toLowerCase()) },
    exclusions: { competitors: list(input.exclusions?.competitors), keywords: list(input.exclusions?.keywords), iab: list(input.exclusions?.iab) },
    enteredBy: String(input.enteredBy || "").trim() || null,
    updatedAt: new Date().toISOString(),
  };
  return { campaign: c, problems: validateCampaign(c, cfg) };
}

export function validateCampaign(c, cfg) {
  const p = [];
  if (!c.brand) p.push("brand is required");
  if (!["active", "paused", "draft"].includes(c.status)) p.push("status must be active, paused or draft");
  if (!validDate(c.start)) p.push("start date must be YYYY-MM-DD");
  if (!validDate(c.end)) p.push("end date must be YYYY-MM-DD");
  if (validDate(c.start) && validDate(c.end) && c.start > c.end) p.push("start date is after the end date");
  if (!c.creatives.length) p.push("add at least one creative");
  for (const k of c.creatives) {
    if (!cfg.formats.formats[k.format]) p.push(`creative ${k.id}: unknown format "${k.format}"`);
    if (k.file && (path.isAbsolute(k.file) || k.file.split(/[\\/]/).includes(".."))) p.push(`creative ${k.id}: file must be a name inside the creatives folder`);
  }
  if (!c.targeting.iab.length && !c.brief) p.push("pick at least one IAB category to target, or write a brief for meaning match");
  for (const id of [...c.targeting.iab, ...c.exclusions.iab]) if (!cfg.taxonomy.has(id)) p.push(`unknown IAB id ${id}`);
  return p;
}

// G3: is the campaign live today? → { pass, reason }
export function campaignGate(c, now = new Date()) {
  const today = todayIST(now);
  if (!validDate(c.start) || !validDate(c.end)) return { pass: false, reason: "CAMPAIGN_DATES_MISSING" };
  if (c.status !== "active") return { pass: false, reason: `CAMPAIGN_${c.status.toUpperCase()}` };
  if (today < c.start) return { pass: false, reason: "CAMPAIGN_NOT_STARTED", detail: `starts ${c.start}, today ${today} IST` };
  if (today > c.end) return { pass: false, reason: "CAMPAIGN_EXPIRED", detail: `ended ${c.end}, today ${today} IST` };
  return { pass: true, reason: "CAMPAIGN_LIVE", detail: `${c.start} → ${c.end}, today ${today} IST` };
}
