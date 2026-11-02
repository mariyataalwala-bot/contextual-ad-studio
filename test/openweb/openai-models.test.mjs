// Free plans retire models: when the configured one does not exist, the key's own model list is read and the best one is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askOpenAICompat, pickModel, listModels } from "../../openweb/lib/openai-compat.mjs";

const SCHEMA = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const chat = (obj) => json({ choices: [{ message: { content: JSON.stringify(obj) } }] });
const gone = (m) => json({ error: { message: `The model \`${m}\` does not exist or you do not have access to it.` } }, 404);

test("pick: a picture-reading model is preferred when pictures are sent, speech and guard models are never chosen, and no picture model means null", () => {
  const ids = ["whisper-large-v3", "llama-3.3-70b-versatile", "meta-llama/llama-4-maverick-17b-128e-instruct", "llama-guard-4-12b", "openai/gpt-oss-120b"];
  assert.equal(pickModel(ids, true), "meta-llama/llama-4-maverick-17b-128e-instruct");
  assert.equal(pickModel(["whisper-large-v3", "llama-3.3-70b-versatile", "openai/gpt-oss-20b"], false), "openai/gpt-oss-20b");
  assert.equal(pickModel(["whisper-large-v3", "llama-3.3-70b-versatile"], true), null);
  assert.equal(pickModel(["orpheus-tts", "llama-guard-4-12b"], false), null);
});

test("a retired model: the key's model list is read, a working one is used and remembered, and the answer comes back", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url.replace("https://api.models.test/v1", ""));
    if (url.endsWith("/models")) return json({ data: [{ id: "whisper-large-v3" }, { id: "meta-llama/llama-4-maverick-17b-128e-instruct" }, { id: "llama-3.3-70b-versatile" }] });
    const used = JSON.parse(init.body).model; return used === "meta-llama/llama-4-scout-17b-16e-instruct" ? gone(used) : chat({ ok: true, used });
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-om-")), png = path.join(dir, "a.png"); fs.writeFileSync(png, "png");
  const base = { baseUrl: "https://api.models.test/v1", key: "k", model: "meta-llama/llama-4-scout-17b-16e-instruct", system: "s", text: "t", schema: SCHEMA, images: [{ label: "x", file: png }], fetchImpl };
  const r = await askOpenAICompat(base);
  assert.deepEqual(r, { ok: true, used: "meta-llama/llama-4-maverick-17b-128e-instruct" });
  assert.deepEqual(calls, ["/chat/completions", "/models", "/chat/completions"]);
  calls.length = 0;
  assert.equal((await askOpenAICompat(base)).ok, true); assert.deepEqual(calls, ["/chat/completions"], "the replacement is remembered: no second look at the list, no second failure");
});

test("no usable model on the key: the error names the models it does have and says what to set", async () => {
  const fetchImpl = async (url) => (url.endsWith("/models") ? json({ data: [{ id: "whisper-large-v3" }, { id: "llama-3.3-70b-versatile" }] }) : gone("some-old-model"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-om-")), png = path.join(dir, "a.png"); fs.writeFileSync(png, "png");
  await assert.rejects(() => askOpenAICompat({ baseUrl: "https://api.nomodel.test/v1", key: "k", model: "some-old-model", system: "s", text: "t", schema: SCHEMA, images: [{ label: "x", file: png }], fetchImpl }),
    /none of the key's models can read pictures.*whisper-large-v3, llama-3\.3-70b-versatile.*OPENAI_COMPAT_MODEL/s);
  const text = await askOpenAICompat({ baseUrl: "https://api.nomodel2.test/v1", key: "k", model: "some-old-model", system: "s", text: "t", schema: SCHEMA, fetchImpl: async (url, init) => (url.endsWith("/models") ? json({ data: [{ id: "llama-3.3-70b-versatile" }] }) : JSON.parse(init.body).model === "some-old-model" ? gone("some-old-model") : chat({ ok: true })) });
  assert.equal(text.ok, true, "a text-only call can use a text-only model");
});

test("model list: ids are read from either list shape; an unreadable list is an error with the reason", async () => {
  assert.deepEqual(await listModels({ baseUrl: "https://x.test/v1/", key: "k", fetchImpl: async () => json({ data: [{ id: "a" }, { id: "b" }] }) }), ["a", "b"]);
  await assert.rejects(() => listModels({ baseUrl: "https://x.test/v1", key: "k", fetchImpl: async () => json({ error: { message: "Invalid API Key" } }, 401) }), /Invalid API Key/);
});
