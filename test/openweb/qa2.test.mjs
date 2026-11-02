// Quality checks: full-range colour is a note, not a block; the same finding at many moments is reported once, with its times.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { specIssues, runQa } from "../../openweb/lib/qa.mjs";
import { fakeAsk } from "./helpers.mjs";

test("colour range: yuvj420p is a minor note, other pixel formats and codecs are still major", () => {
  const p = (pix, codec = "h264") => ({ format: { duration: "9" }, streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "25/1", codec_name: codec, pix_fmt: pix }] });
  assert.deepEqual(specIssues(p("yuv420p"), {}), []);
  assert.deepEqual(specIssues(p("yuvj420p"), {}).map((i) => i.severity), ["minor"]);
  assert.deepEqual(specIssues(p("yuv444p"), {}).map((i) => i.severity), ["major"]);
  assert.deepEqual(specIssues(p("yuv420p", "hevc"), {}).map((i) => i.severity), ["major"]);
});

test("one finding at several moments is one issue that lists the other times; a minor one does not block approval", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-qa-")), file = path.join(dir, "v.mp4");
  try { execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=25:duration=8", "-pix_fmt", "yuv420p", "-c:v", "libx264", file]); } catch { return t.skip("ffmpeg is not available"); }
  const ui = { type: "platform_ui_over_ad", severity: "minor", what: "YouTube player UI is over the original ad", fix: "Use the client's file" };
  const review = /** @type {any} */ ({ frames: [1, 2, 3, 4].map((k) => ({ k, texts_read: [], issues: [ui] })), logo_consistent: true, logo_note: "", product_consistent: true, product_note: "", labelled_as_ad: true, labelled_note: "" });
  const r = await runQa({ file, kind: "2in1", ask: fakeAsk(null, { image: review }), workDir: dir, brand: "Kissht", product: "Loans", texts: [], expected: { width: 1080, height: 1920 }, safety: { status: "safe" } });
  const same = r.issues.filter((i) => /YouTube player UI/.test(i.what));
  assert.equal(same.length, 1); assert.ok(same[0].also.length >= 2, "the other moments are listed");
  assert.equal(r.status, "approved", "a minor, platform-made overlay is noted but does not block approval");
});

import { textIssues } from "../../openweb/lib/qa.mjs";
test("spelling: a word followed by a full stop is the same word (“running.” is not a misspelling of “running”)", () => {
  assert.deepEqual(textIssues([{ where: "line", text: "Max energy, max running." }], { productNames: ["Power running shoes"] }), []);
  assert.deepEqual(textIssues([{ where: "line", text: "Easy Smart Loans." }], { brandNames: ["Kissht"], productNames: ["Smart Loans"] }), []);
});
