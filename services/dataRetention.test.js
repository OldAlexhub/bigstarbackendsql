import assert from "node:assert/strict";
import test from "node:test";
import {
  RETENTION_COLLECTION_NAMES,
  retentionCutoff,
  runRetentionCleanup,
} from "./dataRetention.js";

const policies = (unit = "years") => ({
  enabled: true,
  operationalHistory: { value: 7, unit },
  auditLogs: { value: 7, unit },
  teamPosts: { value: 3, unit },
  networkSubmissionStaging: { value: 1, unit },
});

const harness = (dataRetention, collections) => {
  const audits = [];
  return {
    options: {
      now: new Date("2030-06-15T12:00:00.000Z"),
      SettingsModel: { getSingleton: async () => ({ dataRetention }) },
      CleanupLogModel: { create: async (entry) => { audits.push(entry); return entry; } },
      collections,
    },
    audits,
  };
};

test("retention disabled performs no cleanup", async () => {
  let calls = 0;
  const { options, audits } = harness(
    { ...policies(), enabled: false },
    { operationalHistory: [{ name: "History", field: "date", format: "date", model: { deleteMany: async () => { calls += 1; } } }] }
  );
  const result = await runRetentionCleanup(options);

  assert.equal(calls, 0);
  assert.equal(result.recordsDeleted, 0);
  assert.equal(audits.length, 1);
});

test("retain indefinitely performs no cleanup", async () => {
  let calls = 0;
  const { options } = harness(
    policies("indefinite"),
    { teamPosts: [{ name: "TeamPost", field: "createdAt", format: "date", model: { deleteMany: async () => { calls += 1; } } }] }
  );
  await runRetentionCleanup(options);
  assert.equal(calls, 0);
});

test("expired eligible history is deleted and old submission staging is cleared", async () => {
  const queries = [];
  const updates = [];
  const { options, audits } = harness(policies("days"), {
    operationalHistory: [{
      name: "History",
      field: "date",
      format: "date",
      model: { deleteMany: async (query) => { queries.push(query); return { deletedCount: 4 }; } },
    }],
    networkSubmissionStaging: [{
      name: "NetworkSubmission",
      field: "createdAt",
      format: "date",
      action: "clean",
      model: { updateMany: async (...args) => { updates.push(args); return { modifiedCount: 2 }; } },
    }],
  });
  const result = await runRetentionCleanup(options);

  assert.equal(result.recordsDeleted, 4);
  assert.equal(result.recordsCleaned, 2);
  assert.equal(result.success, true);
  assert.equal(queries[0].date.$lt.toISOString(), "2030-06-08T12:00:00.000Z");
  assert.equal(updates[0][0].createdAt.$lt.toISOString(), "2030-06-14T12:00:00.000Z");
  assert.deepEqual(updates[0][1].$set.parsedRows, []);
  assert.deepEqual(updates[0][1].$set.previewRows, []);
  assert.equal(audits[0].recordsDeleted, 4);
});

test("retention targets never include master or current operational collections", () => {
  for (const protectedName of [
    "User", "Division", "RunCut", "Provider", "Operator", "Vehicle", "Settings", "CorrectiveActionPlan",
  ]) {
    assert.equal(RETENTION_COLLECTION_NAMES.includes(protectedName), false, `${protectedName} must not be a retention target`);
  }
});

test("calendar retention cutoffs clamp leap-day years safely", () => {
  assert.equal(
    retentionCutoff({ value: 1, unit: "years" }, new Date("2028-02-29T08:00:00.000Z")).toISOString(),
    "2027-02-28T08:00:00.000Z"
  );
});

