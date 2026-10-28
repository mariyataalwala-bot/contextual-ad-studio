// Brand knowledge v2 (openweb/config/brands.v2.json, checked online): what the In-Image Studio and the YouTube tool rely on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrands, findBrand, brandBrief, bannedReason, ownNames, namesBrand, BRANDS_FILE } from "../../openweb/lib/brands.mjs";

const c = loadBrands();

test("v2 is loaded: 50 brands, each with current hero products, 3+ rivals, official sites and a colour source", () => {
  assert.equal(BRANDS_FILE, "brands.v2.json"); assert.equal(c.version, "brands.v2"); assert.equal(c.brands.length, 50);
  for (const b of c.brands) {
    assert.ok(b.heroProducts?.length, `${b.name}: hero products`);
    assert.ok(b.competitors.length >= 3 && b.domains.length, `${b.name}: rivals and sites`);
    assert.ok(b.coloursSource, `${b.name}: where the colours come from`);
    if (b.logo?.png) assert.match(b.logo.png, /^https:\/\/(upload|thumb)\.wikimedia\.org\/[^?]+\.(png|jpe?g)$/, `${b.name}: logo is a Wikimedia PNG rendering`);
  }
});

test("infant formula and infant foods are never advertised (India's IMS Act)", () => {
  for (const product of ["NAN PRO 2", "Lactogen", "Cerelac wheat apple", "infant formula"]) assert.match(bannedReason(findBrand(c, "Nestle", product), product), /IMS Act/, product);
  const maggi = findBrand(c, "Nestle", "Maggi 2-Minute Noodles");
  assert.equal(maggi.name, "Maggi"); assert.equal(bannedReason(maggi, "Maggi 2-Minute Noodles"), null);
  assert.equal(bannedReason(findBrand(c, "Sprite", ""), "Sprite"), null, "other brands are not affected");
  assert.match(brandBrief(findBrand(c, "Nestle", "")), /Never advertise: NAN/);
});

test("sister brands are never rivals, and rivals that no longer exist are gone", () => {
  for (const b of c.brands) {
    const fam = new Set(b.family.map((f) => f.toLowerCase()));
    for (const r of b.competitors) assert.ok(!fam.has(r.toLowerCase()), `${b.name}: ${r} is a sister brand, not a rival`);
    for (const gone of ["Dunzo", "Vistara", "Swiggy Genie", "Pureit"]) assert.ok(!b.competitors.includes(gone), `${b.name}: ${gone} no longer exists`);
  }
  assert.ok(findBrand(c, "Sprite", "").family.includes("Schweppes"));
  assert.ok(findBrand(c, "Philips", "").family.includes("Preethi"));
  assert.ok(findBrand(c, "redBus", "").family.includes("MakeMyTrip"));
});

test("a brand's own names cover its sister brands; everyday-word names count only next to a product word", () => {
  const sprite = findBrand(c, "Sprite", "");
  assert.ok(ownNames(sprite).includes("coca cola") && ownNames(sprite).includes("thums up"), "a Sprite ad never runs on a Coca-Cola or Thums Up video");
  const boat = findBrand(c, "boAt", "earbuds");
  assert.equal(namesBrand(boat, "Boat capsizes in the Ganga, 12 rescued"), false);
  assert.equal(namesBrand(boat, "boAt Airdopes 141 review"), true);
  const samsung = findBrand(c, "Samsung", "");
  assert.equal(namesBrand(samsung, "James Webb spots a distant galaxy"), false);
  assert.equal(namesBrand(samsung, "Galaxy S26 Ultra camera test"), true);
  assert.equal(namesBrand(findBrand(c, "Yatra", ""), "Amarnath Yatra begins today"), false);
});

test("stray deck names are not brand names, and rival product lines that are common words only count with their brand", () => {
  assert.ok(!findBrand(c, "Nestle", "").aliases.includes("nestle pitch deck"));
  assert.ok(!findBrand(c, "Samsung", "").aliases.includes("samsung deck"));
  const jblRivals = c.brands.flatMap((b) => b.competitors).map((x) => x.toLowerCase());
  for (const w of ["live", "tune", "find", "buds", "reno"]) assert.ok(!jblRivals.includes(w), `"${w}" alone would match unrelated headlines`);
});
