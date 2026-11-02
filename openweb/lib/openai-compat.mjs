// A structured-JSON "ask" for any OpenAI-compatible chat API — Groq, OpenRouter, Together, Mistral, Cloudflare Workers AI,
// a local server … — so the studio can run on a free key from one of them instead of Gemini. Same contract as the
// Gemini and Claude paths in server.mjs: (system, text, schema, images[{label,file}]) → the parsed JSON object.
// Free models are smaller than Gemini's: their picture and layout judgements are weaker, so the quality checks
// (qa.mjs) can report "incomplete" more often. Nothing here pretends otherwise.
//
// Free plans retire models without notice. When the provider says the configured model does not exist, the model list of the
// same key is read and the best available one is used instead (a picture-reading one when pictures are sent), and remembered.
import fs from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pulls the first JSON object out of a reply (models sometimes wrap it in a code fence or add a sentence). */
export function parseJsonReply(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch { /* look for the object inside */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new Error("The model did not return JSON.");
}

/** Every required key of the schema's top level must be there — the same check Gemini's structured mode gives for free. */
export function missingKeys(obj, schema) { return (schema?.required || []).filter((k) => !(k in (obj || {}))); }

const mime = (f) => (/\.png$/i.test(f) ? "image/png" : "image/jpeg");

// ---------- a model that exists ----------
const NOT_CHAT = /whisper|tts|guard|embed|moderation|orpheus|playai|safeguard|rerank|transcrib|speech|image-gen|dall|flux|stable-diffusion|sdxl/i;
const SEES = [/llama-4-maverick/i, /llama-4-scout/i, /pixtral/i, /llama-3\.2-90b-vision/i, /llama-3\.2-11b-vision/i, /qwen.*-vl/i, /gemma-?3/i, /gpt-4o|gpt-4\.1|gpt-5/i, /gemini/i, /llava|vision|[-_]vl\b/i];
const TEXT = [/gpt-oss/i, /llama-3\.3-70b/i, /llama-3\.1-70b/i, /qwen/i, /mistral|mixtral/i, /llama/i, /gemma/i, /deepseek/i];

/** The best model among `ids` for this call: one that reads pictures when pictures are sent, else the best chat model; null if none fits. */
export function pickModel(ids, needsVision) {
  const chat = ids.filter((id) => !NOT_CHAT.test(id));
  for (const re of SEES) { const hit = chat.find((id) => re.test(id)); if (hit) return hit; }
  if (needsVision) return null;
  for (const re of TEXT) { const hit = chat.find((id) => re.test(id)); if (hit) return hit; }
  return chat[0] || null;
}

/** @param {{ baseUrl: string, key: string, fetchImpl?: typeof fetch }} o @returns {Promise<string[]>} */
export async function listModels({ baseUrl, key, fetchImpl = globalThis.fetch }) {
  const r = await fetchImpl(baseUrl.replace(/\/+$/, "") + "/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`the model list could not be read (${String(j.error?.message || "HTTP " + r.status).slice(0, 100)})`);
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
}
const swapped = new Map();   // "baseUrl|model|vision" → the model used instead (remembered for the life of the server)
const GONE = /(model|deployment).{0,60}(does not exist|not found|decommission|deprecated|no longer|not supported|do not have access|unknown)|(does not exist|not found|decommission|deprecated).{0,60}model/i;

/**
 * @param {{ baseUrl: string, key: string, model: string, system: string, text: string, schema?: any, images?: { label: string, file: string }[],
 *   fetchImpl?: typeof fetch, retries?: number, timeoutMs?: number }} o
 */
export async function askOpenAICompat({ baseUrl, key, model, system, text, schema, images = [], fetchImpl = globalThis.fetch, retries = 2, timeoutMs = 90000 }) {
  if (!key) throw new Error("No key for the OpenAI-compatible provider.");
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const user = [];
  for (const im of images) {
    user.push({ type: "text", text: im.label });
    user.push({ type: "image_url", image_url: { url: `data:${mime(im.file)};base64,${fs.readFileSync(im.file).toString("base64")}` } });
  }
  const sw = `${baseUrl}|${model}|${images.length ? "v" : "t"}`;
  let use = swapped.get(sw) || model, retiredOnce = false;
  const ask = (structured) => ({ model: use, temperature: 0.2, messages: [
    { role: "system", content: system + (schema && !structured ? `\n\nReply with ONE JSON object only, no prose, matching this JSON Schema:\n${JSON.stringify(schema)}` : "") },
    { role: "user", content: [...user, { type: "text", text }] }],
  response_format: schema ? (structured ? { type: "json_schema", json_schema: { name: "answer", schema, strict: false } } : { type: "json_object" }) : undefined });
  let structured = !!schema, lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    let r;
    try { r = await fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(ask(structured)), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { lastErr = `network: ${String(e.message).slice(0, 100)}`; if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; } break; }
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const content = j.choices?.[0]?.message?.content;
      const obj = parseJsonReply(Array.isArray(content) ? content.map((c) => c.text || "").join("") : content);
      const miss = schema ? missingKeys(obj, schema) : [];
      if (miss.length) { lastErr = `the reply lacked: ${miss.join(", ")}`; if (attempt < retries) continue; throw new Error(`The model's answer was incomplete (${lastErr}).`); }
      return obj;
    }
    const msg = String(j.error?.message || j.message || `HTTP ${r.status}`).slice(0, 200);
    // the model was retired or this key has no access to it: use the best model the key does have
    if ((r.status === 404 || r.status === 400 || r.status === 403) && GONE.test(msg) && !retiredOnce) {
      retiredOnce = true;
      let ids; try { ids = await listModels({ baseUrl, key, fetchImpl }); } catch (e) { throw new Error(`The AI model “${use}” is not available and the key's model list could not be read (${e.message}). Set OPENAI_COMPAT_MODEL to a model your key can use.`); }
      const next = pickModel(ids.filter((id) => id !== use), images.length > 0);
      if (!next) throw new Error(`The AI model “${use}” is not available, and none of the key's models ${images.length ? "can read pictures" : "fits"}. Models on this key: ${ids.slice(0, 12).join(", ") || "none"}. Set OPENAI_COMPAT_MODEL to one that can.`);
      swapped.set(sw, next); use = next; attempt--; continue;
    }
    if (r.status === 400 && structured && /response_format|json_schema|schema/i.test(msg)) { structured = false; attempt--; continue; }   // this model has no schema mode: JSON mode + the schema in the prompt
    if (r.status === 429 || r.status >= 500) {
      lastErr = `${r.status}: ${msg}`;
      if (attempt < retries) { await sleep(Math.min(20000, (+r.headers?.get?.("retry-after") || 2 * (attempt + 1)) * 1000)); continue; }
      throw new Error(r.status === 429 ? `The free AI plan is out of quota or rate-limited right now (${msg}).` : `The AI provider had a problem (${msg}).`);
    }
    throw new Error(`The AI provider refused the request (${msg}).`);
  }
  throw new Error(`The AI provider could not be reached (${lastErr}).`);
}
