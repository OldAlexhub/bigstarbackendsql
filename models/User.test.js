import assert from "node:assert/strict";
import test from "node:test";
import User from "./User.js";
import { canWritePage } from "../utils/pageAccess.js";

test("page access levels safely store dotted page keys and serialize for the client", async () => {
  const user = new User({
    username: "permissions.test",
    password: "temporary-password",
    name: "Permissions Test",
    pageAccessConfigured: true,
    pageAccess: ["network_success.performance", "report_builder"],
    pageAccessLevels: [
      { page: "network_success.performance", level: "read" },
      { page: "report_builder", level: "write" },
    ],
  });

  await user.validate();
  assert.deepEqual(user.toPublicJSON().pageAccessLevels, {
    "network_success.performance": "read",
    report_builder: "write",
  });
});

test("a persisted-style read-only Master Run Cuts permission cannot write", async () => {
  const user = new User({
    username: "readonly.run.cuts",
    password: "temporary-password",
    name: "Read Only Run Cuts",
    role: "Manager",
    pageAccessConfigured: true,
    pageAccess: ["master_run_cuts.run_cuts"],
    pageAccessLevels: [{ page: "master_run_cuts.run_cuts", level: "read" }],
  });

  await user.validate();
  assert.equal(canWritePage(user, "master_run_cuts.run_cuts"), false);
});

test("passwords and authentication data are excluded from queries and public user JSON", () => {
  const user = new User({
    username: "privacy.test",
    password: "temporary-password",
    name: "Privacy Test",
  });
  const publicUser = user.toPublicJSON();

  assert.equal(User.schema.path("password").options.select, false);
  assert.equal(Object.hasOwn(publicUser, "password"), false);
  assert.equal(Object.hasOwn(publicUser, "token"), false);
});

test("session JSON includes permissions but omits user-directory contact fields", () => {
  const user = new User({
    username: "session.privacy",
    password: "temporary-password",
    name: "Session Privacy",
    email: "private@example.com",
    phone: "555-0100",
    title: "Manager",
    department: "Operations",
    pageAccessConfigured: true,
    pageAccess: ["dashboard"],
    pageAccessLevels: [{ page: "dashboard", level: "read" }],
  });
  const sessionUser = user.toSessionJSON();

  assert.equal(sessionUser.name, "Session Privacy");
  assert.deepEqual(sessionUser.pageAccess, ["dashboard"]);
  assert.equal(Object.hasOwn(sessionUser, "email"), false);
  assert.equal(Object.hasOwn(sessionUser, "phone"), false);
  assert.equal(Object.hasOwn(sessionUser, "title"), false);
  assert.equal(Object.hasOwn(sessionUser, "department"), false);
});
