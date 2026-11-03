// Creative Intelligence Engine, phase 1: stored brand guidelines and the three creative directions
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBrands } from "../../openweb/lib/brands.mjs";
import { buildGuideline, brandFacts, saveGuideline, loadGuideline, unsourced, slug, GOOGLE_FONTS } from "../../openweb/lib/brand-guidelines.mjs";
import { validateConcepts, copyProblem, strongest, makeConcepts, conceptsPrompt } from "../../openweb/lib/concepts.mjs";

const cfg = loadBrands();
const research = { brands: [{ id: "himalaya", identity: { primary: { hex: "#006666", source: "site css" }, secondary: { hex: "#108474", source: "site css" } }, ad_look: "clean herbal", unverified: ["x"] }] };
const aiGuide = async () => ({ visual_identity: "Clean.", supporting_colours: [{ hex: "#F4F1EA", role: "paper" }, { hex: "nope", role: "bad" }], display_font: "Fraunces", text_font: "Inter", type_notes: "light", motion_language: "slow", campaign_tone: "warm", signature_visuals: ["neem leaves"], do: ["space"], dont: ["clutter"] });

test("guidelines: checked facts with sources, one AI call for direction, saved and loaded by slug", async () => {
  let calls = 0;
  const g = await buildGuideline({ cfg, research, brand: "Himalaya", ask: async (...a) => { calls++; return aiGuide(...a); } });
  assert.equal(calls, 1);
  assert.equal(g.inBrandList, true);
  assert.deepEqual(unsourced(g), [], "every field has a source");
  assert.ok(g.colour_system.some((c) => c.hex === "#006666" && c.source !== "ai-direction"), "research colour kept with its source");
  assert.ok(g.colour_system.some((c) => c.hex === "#f4f1ea" && /ai-direction/.test(c.source)) && !g.colour_system.some((c) => c.hex === "nope"));
  assert.equal(g.typography.display.value, "Fraunces"); assert.ok(GOOGLE_FONTS.includes(g.typography.text.value));
  assert.equal(g.product_range.source, "brands.v2");
  assert.ok(g.dont.value.some((x) => /particles/.test(x)), "house rule always present");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gl-"));
  const f = saveGuideline(g, dir); assert.equal(path.basename(f), slug(g.brand) + ".json");
  assert.equal(loadGuideline(g.brand, dir).brand, g.brand);
});

test("guidelines: a brand outside the Top 50 is marked so, with only the rival lines as facts; no AI → unverified", async () => {
  const f = brandFacts(cfg, research, "Amul");
  assert.equal(f.inBrandList, false); assert.ok(f.mentions.length >= 1 && f.products.length >= 1);
  const g = await buildGuideline({ cfg, research, brand: "Amul", ask: null });
  assert.equal(g.visual_identity.source, "unverified"); assert.equal(g.colour_system[0].source, "unverified");
  assert.deepEqual(unsourced(g), []);
});

const good = { directions: [
  { key: "A", name: "Morning light", idea: "A quiet kitchen at dawn where the pack catches the first light.", beats: ["Dawn light fills a kitchen.", "The pack rises into the light.", "The line settles in the shadow."], art: { palette: ["#102030", "#f4e9d8"], type: "Playfair Display", lighting: "low sun", texture: "linen" }, photo_query: "sunlit kitchen window morning", copy: "Mornings, slowly", why: "Article on breakfast.", strength: 8 },
  { key: "B", name: "Type storm", idea: "Huge stacked letters slam in and part to reveal the product.", beats: ["Letters fill the frame.", "They split apart.", "Product in the gap."], art: { palette: ["#e41e2b", "#ffffff"], type: "Anton", lighting: "flat", texture: "paper grain" }, photo_query: "concrete wall texture", copy: "Open up", why: "Bold.", strength: 6 },
  { key: "C", name: "Floating island", idea: "A tiny island of grass floats over a cloud sea, carrying the pack.", beats: ["Clouds part.", "An island drifts.", "The pack stands on it.", "Line appears."], art: { palette: ["#a8c8e8", "#2b4a2b"], type: "Fraunces", lighting: "golden hour", texture: "mist" }, photo_query: "sea of clouds aerial", copy: "Somewhere softer", why: "Escape.", strength: 7 },
] };

test("concepts: three distinct, clean directions pass; the strongest clean one is chosen", () => {
  assert.deepEqual(validateConcepts(good).problems, []);
  assert.equal(strongest(good).key, "A");
});

test("concepts: claims, numbers, missing directions, drawn effects and near-copies are caught", () => {
  assert.match(copyProblem("The best glow"), /best/);
  assert.match(copyProblem("2x fresher"), /number/);
  assert.match(copyProblem("one two three four five six seven"), /6 words/);
  assert.equal(copyProblem("Mornings, slowly"), null);
  const twin = structuredClone(good); twin.directions[1] = { ...twin.directions[0], key: "B", copy: "Other line" };
  assert.ok(validateConcepts(twin).problems.some((p) => /too alike/.test(p)));
  assert.ok(validateConcepts(twin).problems.some((p) => /same photo/.test(p)));
  const bad = structuredClone(good); bad.directions[2].beats.push("Sparkles burst around it."); bad.directions[2].copy = "100% natural";
  const p = validateConcepts(bad).problems;
  assert.ok(p.some((x) => /C: copy/.test(x)) && p.some((x) => /sparkle/.test(x)));
  assert.equal(strongest(bad).key, "A", "a failing direction is not chosen");
  assert.ok(validateConcepts({ directions: good.directions.slice(0, 2) }).problems[0].includes("A, B and C"));
  const logoQ = structuredClone(good); logoQ.directions[0].photo_query = "brand logo png";
  assert.ok(validateConcepts(logoQ).problems.some((x) => /real photograph/.test(x)));
});

test("concepts: one AI call, the guideline and article go into the prompt", async () => {
  let n = 0, text = "";
  const r = await makeConcepts({ ask: async (_s, t) => { n++; text = t; return good; }, brand: "B", product: "p", guideline: { visual_identity: { value: "Calm teal", source: "x" } }, article: { headline: "Breakfast ideas" } });
  assert.equal(n, 1); assert.ok(r.validation.ok);
  assert.match(text, /Calm teal/); assert.match(text, /Breakfast ideas/);
  assert.match(conceptsPrompt({ brand: "B", product: "p", guideline: null, article: null }), /A = premium cinematic/);
});
