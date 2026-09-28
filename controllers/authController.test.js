import assert from "node:assert/strict";
import test from "node:test";
import User from "../models/User.js";
import { login } from "./authController.js";

test("login authenticates with an HttpOnly cookie without returning the JWT to JavaScript", async () => {
  const originalFindOne = User.findOne;
  const originalSecret = process.env.JWT_SECRET;
  const originalEnvironment = process.env.NODE_ENV;
  process.env.JWT_SECRET = "test-only-cookie-signing-secret";
  process.env.NODE_ENV = "test";

  const user = {
    _id: "507f1f77bcf86cd799439011",
    active: true,
    role: "ELT",
    comparePassword: async () => true,
    toSessionJSON: () => ({ id: "507f1f77bcf86cd799439011", username: "elt.user", role: "ELT" }),
  };
  let selected = "";
  User.findOne = () => ({
    select: async (fields) => {
      selected = fields;
      return user;
    },
  });
  const response = {
    cookieName: "",
    cookieValue: "",
    cookieOptions: null,
    body: null,
    cookie(name, value, options) {
      this.cookieName = name;
      this.cookieValue = value;
      this.cookieOptions = options;
    },
    json(body) { this.body = body; return this; },
  };

  try {
    await login({ body: { username: "ELT.User", password: "secret" } }, response);
    assert.equal(selected, "+password");
    assert.equal(response.cookieName, "token");
    assert.equal(response.cookieOptions.httpOnly, true);
    assert.ok(response.cookieValue);
    assert.equal(Object.hasOwn(response.body, "token"), false);
    assert.equal(Object.hasOwn(response.body.user, "password"), false);
  } finally {
    User.findOne = originalFindOne;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});
