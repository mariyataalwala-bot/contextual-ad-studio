// Who may use the hosted app: a login by default, no login only when the owner opts in with OPEN_ACCESS=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessMode } from "../../openweb/lib/access.mjs";

test("access: you on your own computer never log in; a shared or hosted app asks for the password; with no password it is locked unless open access was chosen", () => {
  assert.equal(accessMode({ viaShare: false }), "open");
  assert.equal(accessMode({ viaShare: true, pw: "secret" }), "login");
  assert.equal(accessMode({ viaShare: false, appPassword: "x", pw: "x" }), "login");
  assert.equal(accessMode({ viaShare: true }), "locked");
  assert.equal(accessMode({ viaShare: true, openAccess: false }), "locked");
  assert.equal(accessMode({ viaShare: true, openAccess: true }), "open");
  assert.equal(accessMode({ viaShare: true, pw: "secret", openAccess: true }), "login", "a password, when there is one, is always asked for");
});
