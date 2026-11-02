// A free key's models: Qwen 3.x reads pictures, GPT-OSS does not — a text-only model that is sent a picture is set aside for the next.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askOpenAICompat, pickModel } from "../../openweb/lib/openai-compat.mjs";

const SCHEMA = { type: "object", required: ["colour"], properties: { colour: { type: "string" } } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const IDS = ["canopylabs/orpheus-v1-english", "whisper-large-v3", "qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "meta-llama/llama-prompt-guard-2-86m"];

test("pick: Qwen 3.x counts as able to read pictures; models already tried are skipped", () => {
  assert.equal(pickModel(IDS, true), "qwen/qwen3.8-27b");
  assert.equal(pickModel(IDS, true, ["qwen/qwen3.8-27b"]), null, "nothing else on this key reads pictures");
  assert.equal(pickModel(IDS, false, ["openai/gpt-oss-120b"]), "qwen/qwen3.8-27b");
});

test("a text-only model sent a picture says so: the next model is used, and the answer comes back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-vis-")), png = path.join(dir, "a.png"); fs.writeFileSync(png, "png");
  const used = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/models")) return json({ data: IDS.map((id) => ({ id })) });
    const m = JSON.parse(init.body).model; used.push(m);
    if (m === "openai/gpt-oss-120b") return json({ error: { message: "messages[1].content must be a string" } }, 400);
    return json({ choices: [{ message: { content: JSON.stringify({ colour: "red" }) } }] });
  };
  const r = await askOpenAICompat({ baseUrl: "https://api.vision.test/v1", key: "k", model: "openai/gpt-oss-120b", system: "s", text: "t", schema: SCHEMA, images: [{ label: "x", file: png }], fetchImpl });
  assert.deepEqual(r, { colour: "red" }); assert.deepEqual(used, ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);
});

test("a model with a small picture limit is never fed fewer pictures silently: the run stops and says what to do", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-vis-")), png = path.join(dir, "a.png"); fs.writeFileSync(png, "png");
  const fetchImpl = async () => json({ error: { message: "Too many images provided.  This model supports up to 3 images" } }, 400);
  await assert.rejects(() => askOpenAICompat({ baseUrl: "https://api.few.test/v1", key: "k", model: "qwen/qwen3.8-27b", system: "s", text: "t", schema: SCHEMA, images: Array.from({ length: 5 }, () => ({ label: "x", file: png })), fetchImpl }), /up to 3 images.*Gemini key/s);
});
