import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import ApiAccessToken from "../models/ApiAccessToken.js";
import User from "../models/User.js";
import { createApiAccessToken } from "./apiAccessTokensController.js";
import { hashApiAccessToken, isApiAccessToken } from "../utils/apiAccessTokens.js";

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

test("issuing an API token stores only its hash and returns plaintext once", async () => {
  const originalFindById = User.findById;
  const originalCreate = ApiAccessToken.create;
  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const serviceUser = {
    _id: userId,
    name: "Warehouse Reader",
    username: "warehouse.reader",
    active: true,
    role: "Coordinator",
    pageAccessConfigured: true,
    pageAccess: ["deployment.schedule_history"],
  };
  let stored;
  User.findById = async () => serviceUser;
  ApiAccessToken.create = async (payload) => {
    stored = payload;
    return { _id: new mongoose.Types.ObjectId(), ...payload, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
  };
  const req = {
    body: { name: "Warehouse production", userId: userId.toString(), expiresInDays: 90 },
    user: { _id: adminId, name: "ELT Admin" },
  };
  const res = responseRecorder();

  try {
    await createApiAccessToken(req, res);
  } finally {
    User.findById = originalFindById;
    ApiAccessToken.create = originalCreate;
  }

  assert.equal(res.statusCode, 201);
  assert.equal(isApiAccessToken(res.body.accessToken), true);
  assert.equal(stored.tokenHash, hashApiAccessToken(res.body.accessToken));
  assert.notEqual(stored.tokenHash, res.body.accessToken);
  assert.equal(Object.hasOwn(stored, "accessToken"), false);
  assert.equal(res.body.token.user.username, "warehouse.reader");
});

test("ELT identities cannot be used as API service users", async () => {
  const originalFindById = User.findById;
  const userId = new mongoose.Types.ObjectId();

  try {
    User.findById = async () => ({
      _id: userId,
      active: true,
      role: "ELT",
      pageAccessConfigured: true,
      pageAccess: ["dashboard"],
    });
    const res = responseRecorder();
    await createApiAccessToken({
      body: { name: "Unsafe token", userId: userId.toString(), expiresInDays: 90 },
      user: { _id: new mongoose.Types.ObjectId() },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /ELT accounts cannot be used/i);
  } finally {
    User.findById = originalFindById;
  }
});

test("Super Admin can issue a read-only token with full-site access", async () => {
  const originalFindById = User.findById;
  const originalCreate = ApiAccessToken.create;
  const userId = new mongoose.Types.ObjectId();
  User.findById = async () => ({
    _id: userId,
    name: "System Administrator",
    username: "super.admin",
    active: true,
    role: "Super Admin",
    pageAccessConfigured: false,
    pageAccess: [],
  });
  ApiAccessToken.create = async (payload) => ({
    _id: new mongoose.Types.ObjectId(),
    ...payload,
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
  });
  const res = responseRecorder();

  try {
    await createApiAccessToken({
      body: { name: "All divisions", userId: userId.toString(), expiresInDays: 90 },
      user: { _id: new mongoose.Types.ObjectId(), name: "System Administrator" },
    }, res);
  } finally {
    User.findById = originalFindById;
    ApiAccessToken.create = originalCreate;
  }

  assert.equal(res.statusCode, 201);
  assert.equal(isApiAccessToken(res.body.accessToken), true);
});
