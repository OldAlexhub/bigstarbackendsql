import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { login, resetPassword, setupPin, verifyPin } from "./authController.js";

const SECRET = "test-only-cookie-signing-secret";

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  cookies: [],
  clearedCookies: [],
  status(code) { this.statusCode = code; return this; },
  cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
  clearCookie(name, options) { this.clearedCookies.push({ name, options }); return this; },
  json(body) { this.body = body; return this; },
});

const withAuthEnvironment = async (callback) => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  try {
    await callback();
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
};

test("password login starts PIN setup for an existing user without a PIN", async () => {
  const originalFindOne = User.findOne;
  const user = {
    _id: "507f1f77bcf86cd799439011",
    active: true,
    role: "ELT",
    pinHash: null,
    comparePassword: async () => true,
  };
  let selected = "";
  User.findOne = () => ({ select: async (fields) => { selected = fields; return user; } });
  const response = responseRecorder();

  try {
    await withAuthEnvironment(() => login({ body: { username: "ELT.User", password: "secret" } }, response));
  } finally {
    User.findOne = originalFindOne;
  }

  assert.equal(selected, "+password +pinHash");
  assert.deepEqual(response.body, { requiresPinSetup: true });
  assert.ok(response.clearedCookies.some(({ name }) => name === "token"));
  const challenge = response.cookies.find(({ name }) => name === "pin_challenge");
  assert.equal(challenge.options.httpOnly, true);
  assert.equal(jwt.verify(challenge.value, SECRET).mode, "setup");
  assert.equal(response.cookies.some(({ name }) => name === "token"), false);
});

test("password login asks a configured user to verify their PIN", async () => {
  const originalFindOne = User.findOne;
  User.findOne = () => ({
    select: async () => ({
      _id: "507f1f77bcf86cd799439012",
      active: true,
      role: "Manager",
      pinHash: "stored-hash",
      comparePassword: async () => true,
    }),
  });
  const response = responseRecorder();

  try {
    await withAuthEnvironment(() => login({ body: { username: "manager", password: "secret" } }, response));
  } finally {
    User.findOne = originalFindOne;
  }

  assert.deepEqual(response.body, { requiresPin: true });
  const challenge = response.cookies.find(({ name }) => name === "pin_challenge");
  assert.equal(jwt.verify(challenge.value, SECRET).mode, "verify");
});

test("PIN setup hashes the PIN and only then issues the normal session", async () => {
  const originalFindById = User.findById;
  let configuredPin = "";
  let saved = false;
  const user = {
    _id: "507f1f77bcf86cd799439013",
    active: true,
    role: "Coordinator",
    pinHash: null,
    setPin: async (value) => { configuredPin = value; user.pinHash = "hashed"; },
    save: async () => { saved = true; },
    toSessionJSON: () => ({ id: "507f1f77bcf86cd799439013", username: "new.user" }),
  };
  User.findById = () => ({ select: async () => user });
  const challenge = jwt.sign(
    { id: user._id, purpose: "pin_challenge", mode: "setup" },
    SECRET,
    { expiresIn: "5m" }
  );
  const response = responseRecorder();

  try {
    await withAuthEnvironment(() => setupPin(
      { body: { pin: "483920", pinConfirmation: "483920" }, cookies: { pin_challenge: challenge } },
      response
    ));
  } finally {
    User.findById = originalFindById;
  }

  assert.equal(configuredPin, "483920");
  assert.equal(saved, true);
  const session = response.cookies.find(({ name }) => name === "token");
  assert.equal(jwt.verify(session.value, SECRET).purpose, "session");
  assert.equal(response.clearedCookies.some(({ name }) => name === "pin_challenge"), true);
  assert.equal(Object.hasOwn(response.body, "token"), false);
});

test("PIN verification rejects an incorrect PIN without issuing a session", async () => {
  const originalFindById = User.findById;
  User.findById = () => ({
    select: async () => ({ active: true, pinHash: "stored-hash", comparePin: async () => false }),
  });
  const challenge = jwt.sign(
    { id: "507f1f77bcf86cd799439014", purpose: "pin_challenge", mode: "verify" },
    SECRET,
    { expiresIn: "5m" }
  );
  const response = responseRecorder();

  try {
    await withAuthEnvironment(() => verifyPin(
      { body: { pin: "123456" }, cookies: { pin_challenge: challenge } },
      response
    ));
  } finally {
    User.findById = originalFindById;
  }

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { message: "Invalid PIN." });
  assert.equal(response.cookies.some(({ name }) => name === "token"), false);
});

test("password recovery requires the matching email and PIN before saving a strong password", async () => {
  const originalFindOne = User.findOne;
  let selected = "";
  let saved = false;
  const user = {
    active: true,
    pinHash: "stored-hash",
    password: "old-hash",
    comparePin: async (pin) => pin === "483920",
    comparePassword: async () => false,
    save: async () => { saved = true; },
  };
  User.findOne = () => ({ select: async (fields) => { selected = fields; return user; } });
  const response = responseRecorder();

  try {
    await resetPassword({
      body: {
        email: " User@Example.com ",
        pin: "483920",
        newPassword: "Fresh!Password908",
        passwordConfirmation: "Fresh!Password908",
      },
    }, response);
  } finally {
    User.findOne = originalFindOne;
  }

  assert.equal(selected, "+pinHash +password");
  assert.equal(user.password, "Fresh!Password908");
  assert.equal(saved, true);
  assert.equal(response.statusCode, 200);
  assert.match(response.body.message, /password updated/i);
});
