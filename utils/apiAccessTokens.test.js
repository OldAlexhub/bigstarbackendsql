import assert from "node:assert/strict";
import test from "node:test";
import {
  apiAccessTokenPrefix,
  generateApiAccessToken,
  hashApiAccessToken,
  isApiAccessToken,
} from "./apiAccessTokens.js";

test("generates recognizable high-entropy API access tokens", () => {
  const first = generateApiAccessToken();
  const second = generateApiAccessToken();

  assert.equal(isApiAccessToken(first), true);
  assert.equal(isApiAccessToken(second), true);
  assert.notEqual(first, second);
  assert.equal(apiAccessTokenPrefix(first), first.slice(0, 17));
});

test("hashes tokens deterministically without retaining their plaintext", () => {
  const token = `cmp_live_${"a".repeat(43)}`;
  const digest = hashApiAccessToken(token);

  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, hashApiAccessToken(token));
  assert.equal(digest.includes(token), false);
  assert.equal(isApiAccessToken("not-a-token"), false);
});
