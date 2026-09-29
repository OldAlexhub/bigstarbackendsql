import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidEmail,
  normalizeEmail,
  passwordValidationMessage,
} from "./userCredentials.js";

test("password policy accepts a strong password and rejects weak or unsafe values", () => {
  assert.equal(passwordValidationMessage("Strong!Access2026"), null);
  assert.match(passwordValidationMessage("Short1!"), /at least 12/i);
  assert.match(passwordValidationMessage("alllowercase123!"), /uppercase/i);
  assert.match(passwordValidationMessage("ALLUPPERCASE123!"), /lowercase/i);
  assert.match(passwordValidationMessage("NoNumbersHere!"), /number/i);
  assert.match(passwordValidationMessage("NoSymbolsHere123"), /symbol/i);
  assert.match(passwordValidationMessage("Password123!"), /less common/i);
  assert.match(passwordValidationMessage("Warehouse!2026", { username: "warehouse" }), /username or email/i);
  assert.match(passwordValidationMessage("🔐".repeat(30) + "Aa1!"), /UTF-8 bytes/i);
});

test("persisted bcrypt hashes are accepted without weakening new-password checks", () => {
  const bcryptHash = `$2b$10$${"a".repeat(53)}`;
  assert.equal(passwordValidationMessage(bcryptHash, { allowHash: true }), null);
  assert.notEqual(passwordValidationMessage(bcryptHash), null);
});

test("email validation normalizes proper addresses and rejects malformed addresses", () => {
  assert.equal(normalizeEmail("  Data.Team@Example.COM "), "data.team@example.com");
  for (const email of ["data.team@example.com", "first+warehouse@sub.example.co.uk"]) {
    assert.equal(isValidEmail(email), true);
  }
  for (const email of ["missing-at.example.com", "a@localhost", "a..b@example.com", "a@-example.com", "a@example.c", "a b@example.com"]) {
    assert.equal(isValidEmail(email), false, email);
  }
});
