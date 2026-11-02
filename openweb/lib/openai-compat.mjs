// A structured-JSON "ask" for any OpenAI-compatible chat API — Groq, OpenRouter, Together, Mistral, Cloudflare Workers AI,
// a local server … — so the studio can run on a free key from one of them instead of Gemini. Same contract as the
// Gemini and Claude paths in server.mjs: (system, text, schema, images[{label,file}]) → the parsed JSON object.
// Free models are smaller than Gemini's: their picture and layout judgements are weaker, so the quality checks
// (qa.mjs) can report "incomplete" more often. Nothing here pretends otherwise.
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
  const ask = (structured) => ({ model, temperature: 0.2, messages: [
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
