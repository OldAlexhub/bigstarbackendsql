import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "../db/sqlMongoose.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import { syncAutoIssuesBulk } from "./autoIssueSync.js";
import { OSR_DISRUPTION_TYPE } from "./disruptionTypes.js";

const installModelStubs = ({ manualIssues = [], bulkWrite }) => {
  const originalFind = DailyIssueLog.find;
  const originalBulkWrite = DailyIssueLog.bulkWrite;
  let findCalls = 0;
  DailyIssueLog.find = () => ({
    select() {
      return this;
    },
    async lean() {
      findCalls += 1;
      return typeof manualIssues === "function" ? manualIssues(findCalls) : manualIssues;
    },
  });
  DailyIssueLog.bulkWrite = bulkWrite;
  return {
    getFindCalls: () => findCalls,
    restore: () => {
      DailyIssueLog.find = originalFind;
      DailyIssueLog.bulkWrite = originalBulkWrite;
    },
  };
};

const runCutDay = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  division: new mongoose.Types.ObjectId(),
  route: new mongoose.Types.ObjectId(),
  operator: new mongoose.Types.ObjectId(),
  date: new Date("2026-09-08T00:00:00.000Z"),
  status: "active",
  clientNotes: "",
  disruptionType: null,
  disruptionNotes: "",
  ...overrides,
});

test("live-day client notes are copied to distinct status and disruption issues", async () => {
  let operations;
  const stubs = installModelStubs({
    bulkWrite: async (received) => {
      operations = received;
    },
  });

  try {
    await syncAutoIssuesBulk(
      [
        runCutDay({
          status: "suspended",
          clientNotes: "Client-facing explanation",
          disruptionType: "Vehicle Breakdown",
          disruptionNotes: "Mechanical detail",
        }),
      ],
      new mongoose.Types.ObjectId()
    );

    const updates = operations.filter((operation) => operation.updateOne);
    assert.equal(updates.length, 2);
    assert.equal(updates[0].updateOne.update.$set.notes, "Client-facing explanation — Mechanical detail");
    assert.equal(updates[1].updateOne.update.$set.notes, "Client-facing explanation — Mechanical detail");
    assert.equal(updates[0].updateOne.update.$set.disruptionType, "Unperformed Duty");
    assert.equal(updates[1].updateOne.update.$set.disruptionType, "Vehicle Breakdown");
  } finally {
    stubs.restore();
  }
});

test("status and disruption sources collapse when they describe the same issue", async () => {
  let operations;
  const stubs = installModelStubs({
    bulkWrite: async (received) => {
      operations = received;
    },
  });

  try {
    await syncAutoIssuesBulk(
      [runCutDay({ status: "suspended", disruptionType: "Unperformed Duty" })],
      new mongoose.Types.ObjectId()
    );

    const updates = operations.filter((operation) => operation.updateOne);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].updateOne.update.$set.disruptionType, "Unperformed Duty");
    assert.equal(updates[0].updateOne.update.$set.autoSyncTag, "status_suspended");
  } finally {
    stubs.restore();
  }
});

test("duplicate live-day note text is not repeated", async () => {
  let operations;
  const stubs = installModelStubs({
    bulkWrite: async (received) => {
      operations = received;
    },
  });

  try {
    await syncAutoIssuesBulk(
      [runCutDay({ clientNotes: "Same note", disruptionType: "Late Deploy", disruptionNotes: "Same note" })],
      new mongoose.Types.ObjectId()
    );

    const update = operations.find((operation) => operation.updateOne);
    assert.equal(update.updateOne.update.$set.notes, "Same note");
  } finally {
    stubs.restore();
  }
});

test("an off live-day status is logged as a route closure", async () => {
  let operations;
  const stubs = installModelStubs({
    bulkWrite: async (received) => {
      operations = received;
    },
  });

  try {
    await syncAutoIssuesBulk(
      [runCutDay({ status: "off", clientNotes: "Closed at the client's request" })],
      new mongoose.Types.ObjectId()
    );

    const update = operations.find((operation) => operation.updateOne);
    assert.equal(update.updateOne.update.$set.disruptionType, "Route Closed");
    assert.equal(update.updateOne.update.$set.notes, "Closed at the client's request");
  } finally {
    stubs.restore();
  }
});

test("a matching manual issue suppresses the generated issue", async () => {
  const day = runCutDay({ status: "suspended" });
  let operations;
  const stubs = installModelStubs({
    manualIssues: [
      {
        division: day.division,
        route: day.route,
        operator: day.operator,
        date: day.date,
        disruptionType: "Unperformed Duty",
      },
    ],
    bulkWrite: async (received) => {
      operations = received;
    },
  });

  try {
    await syncAutoIssuesBulk([day], new mongoose.Types.ObjectId());

    assert.equal(operations.some((operation) => operation.updateOne), false);
    assert.equal(
      operations.some(
        (operation) => operation.deleteMany?.filter.disruptionType === "Unperformed Duty"
      ),
      true
    );
  } finally {
    stubs.restore();
  }
});

test("a duplicate-key race rebuilds the auto-sync plan", async () => {
  const calls = [];
  const stubs = installModelStubs({
    bulkWrite: async (operations, options) => {
      calls.push({ operations, options });
      if (calls.length === 1) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }
    },
  });

  try {
    await syncAutoIssuesBulk([runCutDay({ status: "suspended" })], new mongoose.Types.ObjectId());

    assert.equal(calls.length, 2);
    assert.equal(stubs.getFindCalls(), 2);
    assert.deepEqual(calls[0].options, { ordered: false });
    assert.deepEqual(calls[1].options, { ordered: false });
  } finally {
    stubs.restore();
  }
});

test("auto-sync does not retry a non-duplicate database failure", async () => {
  let calls = 0;
  const stubs = installModelStubs({
    bulkWrite: async () => {
      calls += 1;
      throw new Error("database unavailable");
    },
  });

  try {
    await assert.rejects(
      syncAutoIssuesBulk(
        [runCutDay({ disruptionType: "Late Deploy" })],
        new mongoose.Types.ObjectId()
      ),
      /database unavailable/
    );
    assert.equal(calls, 1);
  } finally {
    stubs.restore();
  }
});

test("an active Orion Service Request still synchronizes its OSR issue without a suspension issue", async () => {
  let operations;
  const stubs = installModelStubs({
    bulkWrite: async (received) => { operations = received; },
  });
  try {
    await syncAutoIssuesBulk([
      runCutDay({ status: "active", disruptionType: OSR_DISRUPTION_TYPE, disruptionNotes: "Adjusted service plan" }),
    ], new mongoose.Types.ObjectId());

    const updates = operations.filter((operation) => operation.updateOne);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].updateOne.update.$set.disruptionType, OSR_DISRUPTION_TYPE);
    assert.equal(updates[0].updateOne.update.$set.notes, "Adjusted service plan");
  } finally {
    stubs.restore();
  }
});
