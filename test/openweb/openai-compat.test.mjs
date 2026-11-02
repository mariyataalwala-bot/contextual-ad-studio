// A free OpenAI-compatible key (Groq, OpenRouter, Together …) can replace Gemini: structured JSON in, structured JSON out.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askOpenAICompat, parseJsonReply, missingKeys } from "../../openweb/lib/openai-compat.mjs";

const SCHEMA = { type: "object", required: ["ok", "why"], properties: { ok: { type: "boolean" }, why: { type: "string" } } };
const reply = (obj, status = 200, headers = {}) => new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content: typeof obj === "string" ? obj : JSON.stringify(obj) } }] } : { error: { message: obj } }), { status, headers });
const base = { baseUrl: "https://api.example.test/v1/", key: "k-test", model: "m", system: "You judge.", text: "Question?", schema: SCHEMA };

test("replies: plain JSON, a code fence and JSON inside a sentence are all read; a reply with no JSON is an error", () => {
  assert.deepEqual(parseJsonReply('{"ok":true}'), { ok: true });
  assert.deepEqual(parseJsonReply('```json\n{"ok":false,"why":"x"}\n```'), { ok: false, why: "x" });
  assert.deepEqual(parseJsonReply('Sure! Here it is: {"ok":true,"why":"y"} Hope that helps.'), { ok: true, why: "y" });
  assert.throws(() => parseJsonReply("no json here"), /did not return JSON/);
  assert.deepEqual(missingKeys({ ok: true }, SCHEMA), ["why"]);
});

test("request: bearer key, chat/completions on the base URL, each picture as a labelled data URL, and the schema asked for", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-oa-")), png = path.join(dir, "a.png"), jpg = path.join(dir, "b.jpg");
  fs.writeFileSync(png, Buffer.from("png")); fs.writeFileSync(jpg, Buffer.from("jpg"));
  /** @type {any} */ let seen;
  const fetchImpl = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return reply({ ok: true, why: "fine" }); };
  const r = await askOpenAICompat({ ...base, images: [{ label: "Frame 1", file: png }, { label: "Frame 2", file: jpg }], fetchImpl });
  assert.deepEqual(r, { ok: true, why: "fine" });
  assert.equal(seen.url, "https://api.example.test/v1/chat/completions"); assert.equal(seen.init.headers.Authorization, "Bearer k-test");
  const parts = seen.body.messages[1].content;
  assert.deepEqual(parts.map((p) => p.type), ["text", "image_url", "text", "image_url", "text"]);
  assert.match(parts[1].image_url.url, /^data:image\/png;base64,/); assert.match(parts[3].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(parts[0].text, "Frame 1"); assert.equal(seen.body.response_format.type, "json_schema");
});

test("a model without a schema mode: the same call is retried in JSON mode with the schema written into the prompt", async () => {
  const calls = [];
  const fetchImpl = async (_u, init) => { const b = JSON.parse(init.body); calls.push(b); return calls.length === 1 ? reply("response_format json_schema is not supported by this model", 400) : reply({ ok: true, why: "json mode" }); };
  const r = await askOpenAICompat({ ...base, fetchImpl });
  assert.equal(r.why, "json mode"); assert.equal(calls.length, 2);
  assert.equal(calls[1].response_format.type, "json_object"); assert.match(calls[1].messages[0].content, /JSON Schema/);
});

test("rate limits: a busy provider is retried after its Retry-After; a provider that stays out of quota gives a plain message, not a crash", async () => {
  let n = 0;
  const flaky = async () => (++n < 3 ? reply("slow down", 429, { "retry-after": "0.01" }) : reply({ ok: true, why: "third time" }));
  assert.equal((await askOpenAICompat({ ...base, fetchImpl: flaky })).why, "third time"); assert.equal(n, 3);
  const dead = async () => reply("Rate limit reached for model", 429, { "retry-after": "0.01" });
  await assert.rejects(() => askOpenAICompat({ ...base, fetchImpl: dead }), /out of quota or rate-limited/);
  await assert.rejects(() => askOpenAICompat({ ...base, fetchImpl: async () => reply("Invalid API Key", 401) }), /refused the request \(Invalid API Key\)/);
  await assert.rejects(() => askOpenAICompat({ ...base, key: "" }), /No key/);
});

test("an incomplete answer (a required key missing) is retried, then reported — never passed on as if it were complete", async () => {
  let n = 0;
  await assert.rejects(() => askOpenAICompat({ ...base, fetchImpl: async () => { n++; return reply({ ok: true }); } }), /incomplete \(the reply lacked: why\)/);
  assert.equal(n, 3);
  const fixed = async () => (n++ < 4 ? reply({ ok: true }) : reply({ ok: true, why: "now complete" }));
  assert.equal((await askOpenAICompat({ ...base, retries: 2, fetchImpl: fixed })).why, "now complete");
});
