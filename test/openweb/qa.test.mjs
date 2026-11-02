// MediaKart creative quality checks: claims, spelling, layout geometry, the file checks over a whole video, and the
// approval rule (a critical / major issue, or a check that could not run, means NOT approved — with a timestamp and a fix).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sampleTimes, claimIssues, textIssues, geometryIssues, specIssues, parseBlack, parseFreeze, videoChecks, runQa, CHECKS, stamp } from "../../openweb/lib/qa.mjs";
import { fakeAsk } from "./helpers.mjs";

test("sampling: even moments, extra ones around the transition and the end, never more than the limit, sorted and distinct", () => {
  const t = sampleTimes(30, { extra: [2.3], every: 2.5, max: 12 });
  assert.ok(t.length <= 12 && t.every((x, i) => i === 0 || x - t[i - 1] >= 0.5) && t.includes(2.3) && t.includes(2.9) && t.at(-1) >= 29, JSON.stringify(t));
  assert.deepEqual(sampleTimes(1, { every: 2.5 }).length > 0, true);
  assert.ok(sampleTimes(300).length <= 12);
});

test("claims: prices, discounts and offers, unsupported claims, superlatives, urgency and testimonials are caught; supplied model names and clean copy are not", () => {
  const t = (text) => [{ where: "headline", text }];
  assert.equal(claimIssues(t("Flat 20% off today"))[0].severity, "critical");
  assert.equal(claimIssues(t("Get ₹999 cashback"))[0].severity, "critical");
  assert.equal(claimIssues(t("100% guaranteed results"))[0].severity, "critical");
  assert.equal(claimIssues(t("The best phone"))[0].severity, "major");
  assert.equal(claimIssues(t("Hurry, limited stock"))[0].severity, "major");
  assert.equal(claimIssues(t("Loved by customers"))[0]?.severity ?? "none", "none", "‘loved by customers’ alone is not on the list");
  assert.equal(claimIssues(t("Customers say it works"))[0].severity, "major");
  assert.deepEqual(claimIssues(t("Discover the new Redmi Note 17 5G"), { allowed: "Redmi Note 17 5G Official TVC" }), [], "numbers from the product's own name are fine");
  assert.equal(claimIssues(t("Discover the new Redmi Note 18"), { allowed: "Redmi Note 17" })[0].severity, "major", "a number nobody supplied");
  assert.deepEqual(claimIssues(t("Speed in the crowd")), []);
  assert.match(claimIssues(t("Flat 20% off"))[0].fix, /Remove/);
});

test("spelling: a near-miss of the brand name, a repeated word and a line that stops mid-phrase are flagged; a correct line is not", () => {
  const r = (text) => textIssues([{ where: "subline", text }], { brandNames: ["Airtel"], productNames: ["Priority Postpaid"] });
  assert.match(r("Discover Airtal Priority")[0].what, /misspelling of “airtel”/);
  assert.match(r("Speed speed in the crowd")[0].what, /repeated/);
  assert.match(r("Discover Airtel Postpaid and")[0].what, /middle of a phrase/);
  assert.match(r("Discover Airtel Postpaid -")[0].what, /middle of a phrase/);
  assert.deepEqual(r("Discover Airtel Priority Postpaid"), []);
});

const card = { x: 20, y: 20, w: 300, h: 533 };
const G = (over = {}) => ({ view: { w: 360, h: 640 }, card, video: { x: 20, y: 20, w: 300, h: 169 }, picture: { x: 20, y: 300, w: 300, h: 180 }, logo: { x: 36, y: 200, w: 60, h: 24 }, product: null, panelColour: "#2e42a5", ad: true,
  texts: [{ k: "headline-0", x: 36, y: 230, w: 120, h: 30, fs: 28, color: "rgb(255, 255, 255)", text: "Speed" }, { k: "subline", x: 36, y: 264, w: 200, h: 28, fs: 13, color: "rgb(255, 255, 255)", text: "Discover Airtel" }, { k: "cta", x: 36, y: 296, w: 90, h: 28, fs: 12, color: "rgb(16, 24, 40)", text: "Apply now" }], ...over });
test("geometry: a clean layout passes; overlapping text, text over the picture or the original ad, over the logo, outside the margin, tiny type, weak contrast and a missing ad label are each caught", () => {
  // the picture starts below the words in the clean layout
  const clean = G({ picture: { x: 20, y: 330, w: 300, h: 180 } });
  assert.deepEqual(geometryIssues([{ t: 5, geom: clean }]), []);
  const sev = (g) => geometryIssues([{ t: 5, geom: g }]);
  assert.equal(sev(G({ picture: { x: 20, y: 330, w: 300, h: 180 }, texts: [...clean.texts, { k: "chip-0", x: 40, y: 236, w: 60, h: 14, fs: 12, color: "rgb(0,0,0)", text: "Smart" }] }))[0].check, "text_overlap");
  assert.equal(sev(G())[0].severity, "critical", "the cta sits on the picture in the default (overlapping) fixture");
  assert.ok(sev(G({ picture: { x: 20, y: 330, w: 300, h: 180 }, video: { x: 20, y: 200, w: 300, h: 169 } })).some((i) => /original video ad/.test(i.what)));
  assert.ok(sev(G({ picture: { x: 20, y: 330, w: 300, h: 180 }, logo: { x: 30, y: 225, w: 60, h: 40 } })).some((i) => i.check === "logo_product_obstruction"));
  assert.ok(sev(G({ picture: { x: 20, y: 330, w: 300, h: 180 }, texts: [{ ...clean.texts[1], x: 250, w: 200 }] })).some((i) => i.check === "safe_margins" && /safe margin/.test(i.what)));
  assert.ok(sev(G({ picture: { x: 20, y: 330, w: 300, h: 180 }, texts: [{ ...clean.texts[1], fs: 8 }] })).some((i) => /too small/.test(i.what)));
  assert.ok(sev(G({ picture: { x: 20, y: 330, w: 300, h: 180 }, panelColour: "#ffffff" })).some((i) => /weak contrast/.test(i.what)));
  assert.ok(sev(G({ picture: { x: 20, y: 330, w: 300, h: 180 }, ad: false })).some((i) => /not labelled/.test(i.what)));
});

test("spec + detectors: size, frame rate, codec and length; black and frozen segments are read from ffmpeg's report", () => {
  const probe = { format: { duration: "20" }, streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "25/1", codec_name: "h264", pix_fmt: "yuv420p" }] };
  assert.deepEqual(specIssues(probe, { width: 1080, height: 1920, minSeconds: 10 }), []);
  assert.match(specIssues(probe, { width: 1080, height: 1080 })[0].what, /expected 1080×1080/);
  assert.match(specIssues({ ...probe, format: { duration: "3" } }, { minSeconds: 10 })[0].what, /expected at least/);
  assert.match(specIssues({ streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "10/1", codec_name: "hevc", pix_fmt: "yuv444p" }], format: { duration: "20" } }, {}).map((i) => i.what).join(" "), /frame rate.*hevc/s);
  assert.deepEqual(parseBlack("[blackdetect @ 0x1] black_start:3.2 black_end:5.0 black_duration:1.8"), [{ start: 3.2, end: 5 }]);
  assert.deepEqual(parseFreeze("lavfi.freezedetect.freeze_start: 7.5\nlavfi.freezedetect.freeze_end: 12"), [{ start: 7.5, end: 12 }]);
  assert.equal(stamp(65.4), "1:05.4"); assert.equal(stamp(null), "whole video");
});

const mk = (dir, name, vf, secs = 6, size = "1080x1920") => { const f = path.join(dir, name); execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `${vf}=size=${size}:rate=25:duration=${secs}`, "-pix_fmt", "yuv420p", "-c:v", "libx264", f]); return f; };
test("file checks over the whole video: a good file passes, an all-black file and a truncated file are caught", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-qa-")); let good, black;
  try { good = mk(dir, "good.mp4", "testsrc"); black = path.join(dir, "black.mp4"); execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:size=1080x1920:rate=25:duration=6", "-pix_fmt", "yuv420p", "-c:v", "libx264", black]); } catch { return t.skip("ffmpeg is not available"); }
  const g = await videoChecks(good);
  assert.equal(g.decodeErrors.length, 0); assert.equal(g.black.length, 0); assert.equal(g.hasAudio, false);
  assert.deepEqual(specIssues(g.probe, { width: 1080, height: 1920 }), []);
  const cut = path.join(dir, "cut.mp4"); fs.writeFileSync(cut, fs.readFileSync(good).subarray(0, 4000));
  const c = await videoChecks(cut); assert.ok(c.decodeErrors.length > 0, "a truncated file is reported");
  const b = await videoChecks(black); assert.ok(b.black.length > 0 && b.black[0].end - b.black[0].start > 5, "an all-black video is reported");
});

const review = (frames = [], over = {}) => /** @type {any} */ ({ frames, logo_consistent: true, logo_note: "", product_consistent: true, product_note: "", labelled_as_ad: true, labelled_note: "", ...over });
test("approval: a clean video is approved; a face covered at 3.1 s is NOT approved and names the time and the fix; a failed AI review leaves it incomplete, never approved", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-qa-")); let file;
  try { file = mk(dir, "v.mp4", "testsrc", 8); } catch { return t.skip("ffmpeg is not available"); }
  const base = { file, kind: /** @type {"2in1"} */ ("2in1"), workDir: dir, brand: "Kissht", product: "Smart Loans", brandNames: ["Kissht"], texts: [{ where: "headline", text: "A YES for you" }, { where: "subline", text: "Kissht digital personal loans" }], expected: { width: 1080, height: 1920, minSeconds: 6 }, transitions: [2.3], safety: { status: "safe" } };
  const clean = await runQa({ ...base, ask: fakeAsk(null, { image: review([{ k: 1, texts_read: ["A YES for you"], issues: [] }]) }) });
  assert.equal(clean.status, "approved"); assert.equal(clean.approved, true); assert.equal(clean.checks.length, CHECKS.length); assert.ok(clean.checks.every((c) => c.status === "pass" || c.status === "warn"));
  assert.ok(clean.notes.some((n) => /silent by design/.test(n)), "the missing audio is explained, not hidden");
  const bad = await runQa({ ...base, ask: fakeAsk(null, { image: review([{ k: 2, texts_read: [], issues: [{ type: "face_obstructed", severity: "critical", what: "The headline sits over the actor's face", fix: "Move the headline below the picture" }] }]) }) });
  assert.equal(bad.approved, false); assert.equal(bad.status, "needs_fix");
  const face = bad.issues.find((i) => i.check === "face_obstruction"); assert.ok(face.t > 0 && /face/.test(face.what) && /Move/.test(face.fix), JSON.stringify(face));
  assert.equal(bad.checks.find((c) => c.id === "face_obstruction").status, "fail"); assert.match(bad.summary, /Not approved/);
  const down = await runQa({ ...base, ask: fakeAsk(new Error("Gemini is out of quota")) });
  assert.equal(down.approved, false); assert.equal(down.status, "incomplete"); assert.match(down.summary, /could not run/); assert.equal(down.checks.find((c) => c.id === "face_obstruction").status, "unchecked");
  const claim = await runQa({ ...base, texts: [{ where: "headline", text: "Flat 30% off" }], ask: fakeAsk(null, { image: review([]) }) });
  assert.equal(claim.status, "needs_fix"); assert.ok(claim.issues.some((i) => i.check === "claims_safety" && i.severity === "critical"));
  const unsafe = await runQa({ ...base, safety: { status: "unsafe", reasons: ["VIOLENCE"] }, ask: fakeAsk(null, { image: review([]) }) });
  assert.equal(unsafe.status, "needs_fix"); assert.ok(unsafe.issues.some((i) => /not a brand-safe place/.test(i.what)));
  const garbled = await runQa({ ...base, ask: fakeAsk(null, { image: review([{ k: 1, texts_read: ["A YES for yuo", "Kissht digital personal loans"], issues: [] }]) }) });
  assert.ok(garbled.issues.some((i) => /reads “yuo”/.test(i.what)), "garbled text read from a frame is caught against the approved copy");
});
