import assert from "node:assert/strict";
import test from "node:test";
import { createErrorHandler } from "./errorHandler.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("production errors never expose stack traces, database details, or secrets", () => {
  const originalError = console.error;
  console.error = () => {};
  const res = response();
  const error = new Error("MongoServerError mongodb://user:password@internal-host secret-token");
  error.stack = "sensitive stack";
  try {
    createErrorHandler({ nodeEnv: "production" })(error, {}, res, () => {});
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { message: "Internal server error" });
  assert.equal(JSON.stringify(res.body).includes("Mongo"), false);
  assert.equal(JSON.stringify(res.body).includes("password"), false);
});

test("production also masks non-public client errors while preserving intentional API messages", () => {
  const handler = createErrorHandler({ nodeEnv: "production" });
  const hidden = response();
  handler(Object.assign(new Error("malformed body contained secret-token"), { status: 400 }), {}, hidden, () => {});
  assert.deepEqual(hidden.body, { message: "Request could not be processed" });

  const publicError = response();
  handler(Object.assign(new Error("Choose a valid service date."), { status: 400, publicMessage: true }), {}, publicError, () => {});
  assert.deepEqual(publicError.body, { message: "Choose a valid service date." });
});
