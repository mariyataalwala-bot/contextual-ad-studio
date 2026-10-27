// Regression: the existing YouTube studio behaves as before with the Open Web tab mounted.
// Starts the real server.mjs on a free local port with a temporary output folder; no AI or YouTube calls are made.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

// STUDIO_DIR + STUDIO_BASELINE=1 run the same checks against an older copy of the app (before the Open Web tab).
const APP = process.env.STUDIO_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = !!process.env.STUDIO_BASELINE;
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = /** @type {import("node:net").AddressInfo} */ (s.address()).port; s.close(() => r(p)); }); });
async function start(env) {
  const port = await freePort(), out = fs.mkdtempSync(path.join(os.tmpdir(), "studio-"));
  const p = spawn(process.execPath, ["server.mjs", "--no-open"], { cwd: APP, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OUT_DIR: out, ...env }, windowsHide: true });
  let log = ""; p.stdout.on("data", (d) => (log += d)); p.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100 && !/running on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  if (!/running on/.test(log)) { p.kill(); throw new Error("server did not start: " + log); }
  return { base: `http://127.0.0.1:${port}`, out, stop: () => p.kill(), log: () => log };
}

let S;
before(async () => { S = await start({}); });
after(() => S?.stop());

test("health check", async () => {
  const r = await fetch(S.base + "/healthz"); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
});
test("the YouTube studio page is served unchanged, with a link to the Open Web tab", async () => {
  const t = await (await fetch(S.base + "/")).text();
  for (const s of ["Contextual Ad Studio", 'id="stepper"', 'id="findAds"', 'id="approve"', ...(BASELINE ? [] : ['href="/openweb"'])]) assert.ok(t.includes(s), s);
});
test("/api/status keeps its fields", async () => {
  const j = await (await fetch(S.base + "/api/status")).json();
  for (const k of ["local", "queue", "hasKey", "provider", "youtube", "keyFromEnv", "ffmpeg", "hosted", "outDir"]) assert.ok(k in j, k);
  assert.equal(j.local, true); assert.equal(j.outDir, S.out);
});
test("existing validation and error responses are unchanged", async () => {
  const r = await fetch(S.base + "/api/start", { method: "POST", body: "{}" });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /Pick an ad/);
  const j = await fetch(S.base + "/api/job/nojob"); assert.equal(j.status, 404); assert.match((await j.json()).error, /isn't on the server/);
  const a = await fetch(S.base + "/api/ads/nothing"); assert.equal(a.status, 404);
  const n = await fetch(S.base + "/no/such/route"); assert.equal(n.status, 404); assert.deepEqual(await n.json(), { error: "not found" });
});
test("the Open Web tab is mounted and keeps its data under the output folder", { skip: BASELINE }, async () => {
  const r = await fetch(S.base + "/api/ow/status"); assert.equal(r.status, 200);
  assert.equal((await r.json()).dataDir, path.join(S.out, "openweb"));
  assert.match(await (await fetch(S.base + "/openweb")).text(), /Open Web Contextual/);
});
test("with a share password, both the studio and Open Web require sign-in (health check stays open)", async () => {
  const P = await start({ APP_PASSWORD: "test-pass-123" });
  try {
    assert.equal((await fetch(P.base + "/healthz")).status, 200);
    assert.equal((await fetch(P.base + "/api/status")).status, 401);
    const auth = { Authorization: "Basic " + Buffer.from("x:test-pass-123").toString("base64") };
    assert.equal((await fetch(P.base + "/api/status", { headers: auth })).status, 200);
    if (!BASELINE) {
      assert.equal((await fetch(P.base + "/api/ow/status")).status, 401);
      assert.equal((await fetch(P.base + "/api/ow/status", { headers: auth })).status, 200);
    }
  } finally { P.stop(); }
});
