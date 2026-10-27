// Text helpers shared by analysis, safety and ranking. Everything here is deterministic.
import { createHash } from "node:crypto";

// Same normalisation everywhere, so offsets and quote checks agree: NFKC, straight quotes, single spaces.
export const norm = (s) => String(s ?? "").normalize("NFKC").replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').replace(/[\u00a0\s]+/g, " ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word, case-insensitive matcher for a term (multi-word terms allow any whitespace between words).
// Letters/digits on either side mean "not a whole word" — so "pet" does not match "petrol", and it works for Devanagari too.
export function termRegex(term) {
  const body = norm(term).split(" ").map(esc).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${body}(?![\\p{L}\\p{M}\\p{N}])`, "giu");
}

// Every occurrence of a term in text: [{ start, end, match }]
export function findTerm(text, term) {
  const out = [];
  for (const m of norm(text).matchAll(termRegex(term))) out.push({ start: m.index, end: m.index + m[0].length, match: m[0] });
  return out;
}

// The sentence around a character offset, used as a verbatim evidence quote (capped, cut at word edges).
export function sentenceAt(text, start, end, max = 240) {
  const t = norm(text);
  let a = start, b = end;
  while (a > 0 && !/[.!?।]\s$/.test(t.slice(Math.max(0, a - 2), a)) && start - a < max / 2) a--;
  while (b < t.length && !/[.!?।]/.test(t[b - 1] || "") && b - end < max / 2) b++;
  let q = t.slice(a, b).trim();
  if (q.length > max) {   // long sentence: a window around the match, cut only at spaces so no word is split
    a = Math.max(0, start - max / 2); b = Math.min(t.length, end + max / 2);
    if (a > 0) { const sp = t.indexOf(" ", a); a = sp >= 0 && sp < start ? sp + 1 : start; }
    if (b < t.length) { const sp = t.lastIndexOf(" ", b); b = sp > end ? sp : end; }
    q = t.slice(a, b).trim();
  }
  return q;
}

// Anti-fabrication check: a quote counts only if it appears word for word in the stored text.
export const quoteFound = (text, quote) => { const q = norm(quote).toLowerCase(); return q.length >= 3 && norm(text).toLowerCase().includes(q); };

// Term hits for a list of terms in one field: [{ term, count, quote }], distinct terms only.
export function termHits(text, terms) {
  const out = [];
  for (const term of terms || []) {
    const occ = findTerm(text, term);
    if (occ.length) out.push({ term, count: occ.length, quote: sentenceAt(text, occ[0].start, occ[0].end), start: occ[0].start });
  }
  return out;
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
