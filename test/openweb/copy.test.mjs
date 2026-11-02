// 2-in-1 ads: the panel copy rule is enforced on the words themselves, not left to the AI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCopy } from "../../openweb/lib/panel-assets.mjs";

test("copy: nothing after a superlative, price word or offer word survives; no trailing dash or connector; too short is dropped", () => {
  assert.equal(cleanCopy("Discover Airtel Postpaid Plans - Best"), "Discover Airtel Postpaid Plans");
  assert.equal(cleanCopy("Smart loans with the best rates"), "Smart loans");
  assert.equal(cleanCopy("Get a free phone and more"), "", "cut at \"free\", the dangling \"a\" goes, one word is left — dropped");
  assert.equal(cleanCopy("Reliable service for your family and offers"), "Reliable service for your family");
  assert.equal(cleanCopy("Speed in the crowd"), "Speed in the crowd", "clean copy is untouched");
  assert.equal(cleanCopy("Best prices"), "", "nothing left to say is nothing");
  assert.equal(cleanCopy("Fast & reliable &"), "Fast & reliable");
  assert.equal(cleanCopy("Save big today"), "");
  assert.equal(cleanCopy("  Matches   your vibe  "), "Matches your vibe");
});
