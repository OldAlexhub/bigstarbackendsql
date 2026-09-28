import assert from "node:assert/strict";
import test from "node:test";
import { getRequestToken } from "./authMiddleware.js";

test("authentication accepts the HttpOnly cookie", () => {
  assert.equal(getRequestToken({ headers: {}, cookies: { token: "cookie-token" } }), "cookie-token");
});

test("authentication does not accept browser-readable bearer token fallbacks", () => {
  assert.equal(
    getRequestToken({
      headers: { authorization: "bearer fresh-token" },
      cookies: { token: "stale-token" },
    }),
    "stale-token"
  );
  assert.equal(getRequestToken({ headers: { authorization: "Bearer header-token" }, cookies: {} }), null);
});

test("authentication ignores unsupported authorization schemes", () => {
  assert.equal(getRequestToken({ headers: { authorization: "Basic abc" }, cookies: {} }), null);
});
