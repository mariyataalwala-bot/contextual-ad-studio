// Small hosts: a server that cannot open a browser says so, instead of crashing (HTTP 502 / "instance restarted").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { memoryLimitMB, isLowMemory, LOW_MEMORY_WHY } from "../../openweb/lib/hostmem.mjs";
import { createOpenWeb } from "../../openweb/routes.mjs";

const reader = (files) => (f) => { if (f in files) return files[f]; throw new Error("ENOENT"); };

test("memory limit: read from the container (v2, then v1); 'max' and absurd values mean no limit; unreadable means unknown", () => {
  assert.equal(memoryLimitMB(reader({ "/sys/fs/cgroup/memory.max": "536870912\n" })), 512);
  assert.equal(memoryLimitMB(reader({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "2147483648" })), 2048);
  assert.equal(memoryLimitMB(reader({ "/sys/fs/cgroup/memory.max": "max" })), null);
  assert.equal(memoryLimitMB(reader({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712" })), null);
  assert.equal(memoryLimitMB(reader({})), null);
});
test("low memory: a 512 MB host is low, a 2 GB host and an unknown one (your PC) are not; LITE_MODE overrides both ways", () => {
  const at = (mb) => reader({ "/sys/fs/cgroup/memory.max": String(mb * 1048576) });
  assert.equal(isLowMemory({}, at(512)), true); assert.equal(isLowMemory({}, at(1000)), true);
  assert.equal(isLowMemory({}, at(2048)), false); assert.equal(isLowMemory({}, reader({})), false);
  assert.equal(isLowMemory({ LITE_MODE: "1" }, at(8192)), true); assert.equal(isLowMemory({ LITE_MODE: "0" }, at(512)), false);
});

test("In-Image on a small host: a clear 503 that says why, before anything starts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-lite-")), was = process.env.LITE_MODE; process.env.LITE_MODE = "1";
  const ow = createOpenWeb({ dataDir: path.join(dir, "data"), studioDir: path.join(dir, "inimage") });
  const srv = http.createServer((req, res) => ow.handle(req, res, new URL(req.url, "http://x"), { local: true }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(null)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  try {
    const r = await fetch(base + "/api/ow/studio/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: "Bata", product: "shoes" }) });
    const j = await r.json(); assert.equal(r.status, 503); assert.ok(j.error.includes(LOW_MEMORY_WHY) && /In-Image records its video/.test(j.error));
    process.env.LITE_MODE = "0";
    const ok = await fetch(base + "/api/ow/studio/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: "Bata", product: "shoes" }) });
    assert.notEqual(ok.status, 503, "with enough memory the request goes on (here it stops for want of an AI key, with its own message)");
  } finally { srv.close(); if (was === undefined) delete process.env.LITE_MODE; else process.env.LITE_MODE = was; }
});
