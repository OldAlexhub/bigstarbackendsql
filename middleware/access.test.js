import assert from "node:assert/strict";
import test from "node:test";
import {
  requireAnyPageWrite,
  requireELT,
  requirePageAccess,
  requirePageWrite,
  requireSection,
} from "./access.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("Network Success is assignable while ELT retains automatic access", () => {
  const gate = requireSection("network_success");
  let allowed = false;
  gate({ user: { role: "Coordinator", sections: ["network_success"] } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);

  allowed = false;
  gate({ user: { role: "ELT", sections: [] } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);

  const denied = response();
  gate({ user: { role: "Coordinator", sections: [] } }, denied, () => {});
  assert.equal(denied.statusCode, 403);
});

test("Company Outlook remains ELT-only", () => {
  let allowed = false;
  requireELT({ user: { role: "ELT" } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);

  const denied = response();
  requireELT({ user: { role: "manager" } }, denied, () => {});
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.message, "ELT access required");
});

test("a non-ELT Settings writer still cannot change retention configuration", () => {
  const user = {
    role: "Manager",
    pageAccessConfigured: true,
    pageAccess: ["settings.general"],
    pageAccessLevels: { "settings.general": "write" },
  };
  let reachedRetentionUpdate = false;
  requirePageWrite("settings.general")({ user }, response(), () => {
    requireELT({ user }, response(), () => { reachedRetentionUpdate = true; });
  });
  assert.equal(reachedRetentionUpdate, false);
});

test("configured page access allows one tab without opening its sibling tabs", () => {
  const user = {
    role: "Coordinator",
    sections: ["deployment"],
    pageAccessConfigured: true,
    pageAccess: ["deployment.client_report"],
  };

  let allowed = false;
  requirePageAccess("deployment.client_report")({ user }, response(), () => { allowed = true; });
  assert.equal(allowed, true);

  const denied = response();
  requirePageAccess("deployment.live_schedule")({ user }, denied, () => {});
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.message, "Access to this page is required");
});

test("legacy section assignments continue to allow all matching tabs", () => {
  const user = { role: "Coordinator", sections: ["safety"] };
  let allowed = false;
  requirePageAccess("safety.analytics")({ user }, response(), () => { allowed = true; });
  assert.equal(allowed, true);
});

test("read-only access passes page viewing but blocks write middleware", () => {
  const user = {
    role: "Coordinator",
    pageAccessConfigured: true,
    pageAccess: ["deployment.issue_log"],
    pageAccessLevels: { "deployment.issue_log": "read" },
  };

  let allowed = false;
  requirePageAccess("deployment.issue_log")({ user }, response(), () => { allowed = true; });
  assert.equal(allowed, true);

  const denied = response();
  requirePageWrite("deployment.issue_log")({ user }, denied, () => {});
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.message, "Read & write access to this page is required");
});

test("any-page write middleware accepts one writable page", () => {
  const user = {
    role: "Coordinator",
    pageAccessConfigured: true,
    pageAccess: ["deployment.live_schedule", "deployment.schedule_history"],
    pageAccessLevels: {
      "deployment.live_schedule": "read",
      "deployment.schedule_history": "write",
    },
  };
  let allowed = false;
  requireAnyPageWrite(["deployment.live_schedule", "deployment.schedule_history"])(
    { user },
    response(),
    () => { allowed = true; }
  );
  assert.equal(allowed, true);
});
