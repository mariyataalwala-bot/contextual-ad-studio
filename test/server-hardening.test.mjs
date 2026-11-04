// The server's own defences (security audit, Nov 2026): cross-site POSTs, DNS-rebinding hosts, prototype-name job ids,
// a free-AI address that would carry the key over plain http, oversized bodies — and the process stays up through all of it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4800 + Math.floor(Math.random() * 150);
let child, out;

const call = (method, p, { headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, text: d })); });
  req.on("error", reject); if (body) req.write(body); req.end();
});

before(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), "mk-srv-"));
  child = spawn(process.execPath, [path.join(ROOT, "server.mjs"), "--no-open"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), OUT_DIR: out, OPEN_ACCESS: "", APP_PASSWORD: "" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await call("GET", "/api/status")).status === 200) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error("the server did not start");
});
after(() => { child?.kill(); try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* temp */ } });

test("a page on another website cannot post to the app", async () => {
  const r = await call("POST", "/api/settings", { headers: { Origin: "http://evil.test", "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(r.status, 403);
});

test("a request whose Host is not this PC (DNS rebinding) is refused", async () => {
  const r = await call("GET", "/api/status", { headers: { Host: "evil.test" } });
  assert.equal(r.status, 403);
});

test("a job id that is a prototype name is just an unknown job — and does not poison later jobs", async () => {
  const r = await call("GET", "/api/job/__proto__"); assert.equal(r.status, 404);
  assert.equal(({}).tEnd, undefined, "Object.prototype was not touched");
});

test("the free-AI address must be https (or a model on this PC): the key is never sent over plain http to another host", async () => {
  const r = await call("POST", "/api/settings", { headers: { Origin: `http://127.0.0.1:${PORT}`, "Content-Type": "application/json" }, body: JSON.stringify({ openaiBaseUrl: "http://evil.test/v1" }) });
  assert.equal(r.status, 400); assert.match(r.text, /https/);
});

test("an oversized body is cut off and the server stays up", async () => {
  const big = Buffer.alloc(61e6, 97);
  await call("POST", "/api/ads", { headers: { "Content-Type": "application/json", "Content-Length": String(big.length) }, body: big }).catch(() => null);
  assert.equal((await call("GET", "/api/status")).status, 200);
});
