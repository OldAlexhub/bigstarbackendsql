import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import ApiAccessToken from "../models/ApiAccessToken.js";
import { getBearerToken, getRequestToken, protect } from "./authMiddleware.js";

const ACCESS_TOKEN = `cmp_live_${"a".repeat(43)}`;

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

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

test("dedicated API Bearer tokens are parsed separately from browser sessions", () => {
  assert.equal(getBearerToken({ headers: { authorization: `Bearer ${ACCESS_TOKEN}` } }), ACCESS_TOKEN);
  assert.equal(getBearerToken({ headers: { authorization: "Basic abc" } }), null);
});

test("a PIN challenge cookie cannot be used as an authenticated session", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "purpose-test-secret";
  const challenge = jwt.sign(
    { id: "user-1", purpose: "pin_challenge", mode: "verify" },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );
  const res = responseRecorder();
  let nextCalled = false;

  try {
    await protect({ method: "GET", headers: {}, cookies: { token: challenge } }, res, () => { nextCalled = true; });
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("a valid API Bearer token authenticates its linked active user", async () => {
  const originalFindOne = ApiAccessToken.findOne;
  const user = { _id: "user-1", active: true, pageAccessConfigured: true };
  const token = { user, lastUsedAt: null, save: async () => {} };
  ApiAccessToken.findOne = () => ({ populate: async () => token });
  const req = { method: "GET", headers: { authorization: `Bearer ${ACCESS_TOKEN}` }, cookies: {} };
  const res = responseRecorder();
  let nextCalled = false;

  try {
    await protect(req, res, () => { nextCalled = true; });
  } finally {
    ApiAccessToken.findOne = originalFindOne;
  }

  assert.equal(nextCalled, true);
  assert.equal(req.user, user);
  assert.equal(req.authType, "api_access_token");
  assert.ok(token.lastUsedAt instanceof Date);
});

test("API Bearer tokens cannot authorize mutation requests", async () => {
  const req = { method: "POST", headers: { authorization: `Bearer ${ACCESS_TOKEN}` }, cookies: {} };
  const res = responseRecorder();
  let nextCalled = false;

  await protect(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { message: "API access tokens are read-only." });
});

test("revoked or expired API Bearer tokens are rejected", async () => {
  const originalFindOne = ApiAccessToken.findOne;
  ApiAccessToken.findOne = () => ({ populate: async () => null });
  const req = { method: "GET", headers: { authorization: `Bearer ${ACCESS_TOKEN}` }, cookies: {} };
  const res = responseRecorder();

  try {
    await protect(req, res, () => assert.fail("next should not be called"));
  } finally {
    ApiAccessToken.findOne = originalFindOne;
  }

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { message: "Invalid or expired API access token." });
});

test("an issued token stops working if its service user becomes ELT", async () => {
  const originalFindOne = ApiAccessToken.findOne;
  const token = { user: { active: true, role: "ELT" }, save: async () => {} };
  ApiAccessToken.findOne = () => ({ populate: async () => token });
  const res = responseRecorder();

  try {
    await protect(
      { method: "GET", headers: { authorization: `Bearer ${ACCESS_TOKEN}` }, cookies: {} },
      res,
      () => assert.fail("next should not be called")
    );
  } finally {
    ApiAccessToken.findOne = originalFindOne;
  }

  assert.equal(res.statusCode, 401);
});

test("a Super Admin API token receives full-site read access", async () => {
  const originalFindOne = ApiAccessToken.findOne;
  const user = { active: true, role: "Super Admin" };
  const token = { user, save: async () => {} };
  ApiAccessToken.findOne = () => ({ populate: async () => token });
  const req = { method: "GET", headers: { authorization: `Bearer ${ACCESS_TOKEN}` }, cookies: {} };
  const res = responseRecorder();
  let nextCalled = false;

  try {
    await protect(req, res, () => { nextCalled = true; });
  } finally {
    ApiAccessToken.findOne = originalFindOne;
  }

  assert.equal(nextCalled, true);
  assert.equal(req.user, user);
  assert.equal(req.authType, "api_access_token");
});
