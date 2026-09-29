import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { MemoryStore } from "express-rate-limit";
import {
  createLoginRateLimiter,
  createPasswordResetAccountRateLimiter,
  createSensitiveAuthRateLimiter,
  LOGIN_RATE_LIMIT_MAX,
  SENSITIVE_AUTH_RATE_LIMIT_MAX,
} from "./loginRateLimiter.js";

test("login rate limiting blocks requests beyond the configured limit", async (t) => {
  const app = express();
  app.use(express.json());
  app.post("/api/auth/login", createLoginRateLimiter({ store: new MemoryStore() }), (_req, res) => {
    res.status(400).json({ message: "Invalid login" });
  });

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const { port } = server.address();
  const request = () =>
    fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

  for (let attempt = 0; attempt < LOGIN_RATE_LIMIT_MAX; attempt += 1) {
    const response = await request();
    assert.equal(response.status, 400);
  }

  const blocked = await request();
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), {
    message: "Too many login attempts. Try again in 15 minutes.",
  });
});

test("PIN attempts are restricted more aggressively than password login", async (t) => {
  const app = express();
  app.use(express.json());
  app.post("/api/auth/pin/verify", createSensitiveAuthRateLimiter({ store: new MemoryStore() }), (_req, res) => {
    res.status(401).json({ message: "Invalid PIN." });
  });
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  for (let attempt = 0; attempt < SENSITIVE_AUTH_RATE_LIMIT_MAX; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/pin/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "000000" }),
    });
    assert.equal(response.status, 401);
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/auth/pin/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: "000000" }),
  })).status, 429);
});

test("password reset attempts are limited by normalized account email", async (t) => {
  const app = express();
  app.use(express.json());
  app.post("/api/auth/password/reset", createPasswordResetAccountRateLimiter({ store: new MemoryStore() }), (_req, res) => {
    res.status(401).json({ message: "Email or PIN is incorrect." });
  });
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  for (let attempt = 0; attempt < SENSITIVE_AUTH_RATE_LIMIT_MAX; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/password/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: attempt % 2 ? " USER@example.com " : "user@example.com" }),
    });
    assert.equal(response.status, 401);
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/auth/password/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.com" }),
  })).status, 429);
});
