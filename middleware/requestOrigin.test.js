import assert from "node:assert/strict";
import test from "node:test";
import { createRequestOriginProtection } from "./requestOrigin.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const request = (method, origin) => ({ method, get: (name) => name === "origin" ? origin : undefined });

test("production state-changing requests require the configured frontend origin", () => {
  const protectOrigin = createRequestOriginProtection({
    nodeEnv: "production",
    clientOrigin: "https://operations.example.com",
  });

  for (const origin of [undefined, "https://attacker.example", "https://operations.example.com.evil.test"]) {
    const res = response();
    let allowed = false;
    protectOrigin(request("POST", origin), res, () => { allowed = true; });
    assert.equal(allowed, false);
    assert.equal(res.statusCode, 403);
  }

  let allowed = false;
  protectOrigin(request("PATCH", "https://operations.example.com"), response(), () => { allowed = true; });
  assert.equal(allowed, true);
});

test("origin protection does not break local development or read-only requests", () => {
  let allowed = false;
  createRequestOriginProtection({ nodeEnv: "development", clientOrigin: null })(
    request("DELETE", undefined),
    response(),
    () => { allowed = true; }
  );
  assert.equal(allowed, true);

  allowed = false;
  createRequestOriginProtection({ nodeEnv: "production", clientOrigin: "https://operations.example.com" })(
    request("GET", "https://attacker.example"),
    response(),
    () => { allowed = true; }
  );
  assert.equal(allowed, true);
});

