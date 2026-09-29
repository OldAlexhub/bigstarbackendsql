import assert from "node:assert/strict";
import test from "node:test";
import User from "../models/User.js";
import { createUser } from "./usersController.js";

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const validBody = {
  username: "warehouse.reader",
  password: "Strong!Access2026",
  name: "Warehouse Reader",
  email: " Data.Team@Example.COM ",
  role: "Coordinator",
  pageAccess: ["deployment.schedule_history"],
  divisionAccess: [],
};

test("user creation normalizes a valid email before persistence", async () => {
  const originalCreate = User.create;
  let stored;
  User.create = async (payload) => {
    stored = payload;
    return {
      ...payload,
      populate: async function populate() { return this; },
      toPublicJSON() { return this; },
    };
  };
  const res = responseRecorder();

  try {
    await createUser({ body: validBody }, res);
  } finally {
    User.create = originalCreate;
  }

  assert.equal(res.statusCode, 201);
  assert.equal(stored.email, "data.team@example.com");
  assert.equal(stored.password, validBody.password);
});

test("user creation rejects malformed emails and weak passwords before persistence", async () => {
  const originalCreate = User.create;
  let createCalled = false;
  User.create = async () => { createCalled = true; };

  try {
    const badEmail = responseRecorder();
    await createUser({ body: { ...validBody, email: "not-an-email" } }, badEmail);
    assert.equal(badEmail.statusCode, 400);
    assert.match(badEmail.body.message, /valid email/i);

    const weakPassword = responseRecorder();
    await createUser({ body: { ...validBody, password: "password" } }, weakPassword);
    assert.equal(weakPassword.statusCode, 400);
    assert.match(weakPassword.body.message, /at least 12/i);
    assert.equal(createCalled, false);
  } finally {
    User.create = originalCreate;
  }
});

test("ELT may bootstrap the first Super Admin but cannot create another", async () => {
  const originalExists = User.exists;
  const originalCreate = User.create;
  let createCount = 0;
  User.create = async (payload) => {
    createCount += 1;
    return {
      ...payload,
      populate: async function populate() { return this; },
      toPublicJSON() { return this; },
    };
  };

  try {
    User.exists = async () => null;
    const bootstrap = responseRecorder();
    await createUser({
      body: { ...validBody, username: "platform.admin", email: "platform@example.com", role: "Super Admin" },
      user: { role: "ELT" },
    }, bootstrap);
    assert.equal(bootstrap.statusCode, 201);

    User.exists = async () => ({ _id: "existing-super-admin" });
    const duplicate = responseRecorder();
    await createUser({
      body: { ...validBody, username: "second.admin", email: "second@example.com", role: "Super Admin" },
      user: { role: "ELT" },
    }, duplicate);
    assert.equal(duplicate.statusCode, 403);
    assert.match(duplicate.body.message, /Only a Super Admin/i);
    assert.equal(createCount, 1);
  } finally {
    User.exists = originalExists;
    User.create = originalCreate;
  }
});
