// End-to-end test of Contextual Ad Studio through its HTTP API (what the web page does).
import fs from "node:fs";
const B = "http://127.0.0.1:4777";
const j = async (u, b) => { const r = await fetch(B + u, b ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) } : {}); const t = await r.json(); if (!r.ok) throw new Error(t.error); return t; };
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const logo = "data:image/jpeg;base64," + fs.readFileSync("D:/contextual-ads/lays/assets/logo.jpg").toString("base64");
log("status", JSON.stringify(await j("/api/status")));
const { ads } = await j("/api/ads", { brand: "Lay's", product: "potato chips" });
log("ads:", ads.slice(0, 4).map((a) => `${a.id} | ${a.title} | ${a.channel} | ${a.why}`).join("\n   "));
const ad = ads.find((a) => a.id === "1SIq_mvvs2s") || ads[0];
const { id } = await j("/api/start", { brand: "Lay's", product: "potato chips", adId: ad.id, adTitle: ad.title, logo, packs: [], endcard: false, music: true });
log("job", id, "ad", ad.id);
let last = "", approved = false;
for (;;) {
  const s = await j("/api/job/" + id);
  if (s.step !== last) { log(s.status, "|", s.step); last = s.step; }
  if (s.status === "approve" && !approved) {
    const p = s.proposal;
    log("PROPOSAL:", JSON.stringify({ video: p.video, query: p.query, manual: p.manual, visual: { t: p.pick.visual.t, what: p.pick.visual.what, box: p.pick.visual.box, icon: p.pick.visual.icon }, object: { t: p.pick.object.t, what: p.pick.object.what, box: p.pick.object.box, icon: p.pick.object.icon }, keywords: p.pick.keywords, card: p.pick.card, notes: p.pick.notes }, null, 1));
    fs.writeFileSync("C:/Users/maria/AppData/Local/Temp/claude/D--/15a62a8f-3b04-4162-9eee-b9fee6a2b25f/scratchpad/e2e_proposal.json", JSON.stringify(s, null, 1));
    if (process.argv.includes("--approve")) { await j(`/api/job/${id}/approve`, {}); approved = true; log("approved"); } else { log("stopping at approval (run with --approve to render)"); break; }
  }
  if (s.status === "done") { log("DONE", s.output); break; }
  if (s.status === "failed") { log("FAILED", s.log.slice(-6).join("\n")); break; }
  await new Promise((r) => setTimeout(r, 3000));
}
