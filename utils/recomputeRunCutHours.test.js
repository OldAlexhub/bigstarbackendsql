import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "../db/sqlMongoose.js";
import Division from "../models/Division.js";
import DivisionThresholdChange from "../models/DivisionThresholdChange.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import { recomputeDivisionRunCutHours, recomputeRunCutHours } from "./recomputeRunCutHours.js";

const transaction = mongoose.connection.transaction;
test.beforeEach(() => {
  mongoose.connection.transaction = async (work) => work();
});
test.afterEach(() => {
  mongoose.connection.transaction = transaction;
});

test("recomputeRunCutHours re-snapshots a run cut against today's effective threshold and re-projects it", async () => {
  const originals = {
    findDivision: Division.findById,
    findHistory: DivisionThresholdChange.find,
    findRunCutDay: RunCutDay.find,
    bulkWrite: RunCutDay.bulkWrite,
  };
  const division = { _id: "division-1", timezone: "America/New_York", active: true, thresholds: { breakMinutes: 30, revenueRatio: 0.9 } };
  Division.findById = async () => division;
  DivisionThresholdChange.find = () => ({
    sort: () => ({
      lean: async () => [{ effectiveDate: new Date("2020-01-01T00:00:00.000Z"), breakMinutes: 45, revenueRatio: 1 }],
    }),
  });
  let bulkWritten = null;
  RunCutDay.bulkWrite = async (ops) => { bulkWritten = ops; };
  RunCutDay.find = () => ({ select: async () => [] });
  const runCut = {
    _id: "run-cut-1",
    division: "division-1",
    route: "route-1",
    daysOfWeek: [],
    startTime: "08:00",
    endTime: "16:00",
    status: "active",
    serviceHours: 5.5,
    revenueHours: 4.95,
    operator: null,
    vehicle: null,
    pulloutAddress: "",
    clientNotes: "",
    disruptionType: null,
    disruptionNotes: "",
    async save() {},
  };

  try {
    await recomputeRunCutHours(runCut, division, "user-1");
    // 8 hours - 45 minute break = 7.25 service hours, revenue ratio 1 -> 7.25 revenue hours
    assert.equal(runCut.serviceHours, 7.25);
    assert.equal(runCut.revenueHours, 7.25);
    assert.equal(runCut.updatedBy, "user-1");
    assert.equal(bulkWritten, null, "no days of week means nothing gets projected");
  } finally {
    Division.findById = originals.findDivision;
    DivisionThresholdChange.find = originals.findHistory;
    RunCutDay.find = originals.findRunCutDay;
    RunCutDay.bulkWrite = originals.bulkWrite;
  }
});

test("recomputeDivisionRunCutHours recomputes every run cut in the division", async () => {
  const originals = {
    findRunCuts: RunCut.find,
    findDivision: Division.findById,
    findHistory: DivisionThresholdChange.find,
    findRunCutDay: RunCutDay.find,
  };
  const division = { _id: "division-1", timezone: "America/New_York", active: true, thresholds: { breakMinutes: 30, revenueRatio: 0.9 } };
  Division.findById = async () => division;
  DivisionThresholdChange.find = () => ({ sort: () => ({ lean: async () => [] }) });
  RunCutDay.find = () => ({ select: async () => [] });
  const runCuts = [
    { _id: "rc-1", division: "division-1", daysOfWeek: [], startTime: "08:00", endTime: "16:00", status: "active", serviceHours: 0, revenueHours: 0, async save() { this.saved = true; } },
    { _id: "rc-2", division: "division-1", daysOfWeek: [], startTime: "09:00", endTime: "17:00", status: "active", serviceHours: 0, revenueHours: 0, async save() { this.saved = true; } },
  ];
  RunCut.find = async () => runCuts;

  try {
    await recomputeDivisionRunCutHours(division, "user-1");
    assert.ok(runCuts[0].saved);
    assert.ok(runCuts[1].saved);
    assert.ok(runCuts[0].serviceHours > 0);
    assert.ok(runCuts[1].serviceHours > 0);
  } finally {
    RunCut.find = originals.findRunCuts;
    Division.findById = originals.findDivision;
    DivisionThresholdChange.find = originals.findHistory;
    RunCutDay.find = originals.findRunCutDay;
  }
});
