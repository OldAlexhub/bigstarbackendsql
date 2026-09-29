import assert from "node:assert/strict";
import test from "node:test";
import Division from "../models/Division.js";
import DivisionThresholdChange from "../models/DivisionThresholdChange.js";
import RunCutDay from "../models/RunCutDay.js";
import { projectAssignment } from "./projectAssignment.js";

test("a Permanent OSR replaces only its matching Live Schedule overrides", async () => {
  const originals = {
    findDivision: Division.findById,
    findThresholds: DivisionThresholdChange.find,
    updateDays: RunCutDay.updateMany,
    bulkWriteDays: RunCutDay.bulkWrite,
    findDays: RunCutDay.find,
  };
  let overrideUpdate;
  let projectedOperations;

  Division.findById = async () => ({
    _id: "division-1",
    active: true,
    timezone: "America/New_York",
    thresholds: { breakMinutes: 45, revenueRatio: 1 },
  });
  DivisionThresholdChange.find = () => ({ sort: () => ({ lean: async () => [] }) });
  RunCutDay.updateMany = async (_filter, update) => { overrideUpdate = update; };
  RunCutDay.bulkWrite = async (operations) => { projectedOperations = operations; };
  RunCutDay.find = async () => [];

  try {
    await projectAssignment(
      {
        division: "division-1",
        route: "route-1",
        daysOfWeek: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
        operator: null,
        vehicle: null,
        pulloutAddress: "New address",
        startTime: "06:00",
        endTime: "18:00",
        status: "active",
        clientNotes: "",
        disruptionType: "Orion Service Request",
        disruptionNotes: "Permanent address change",
      },
      "user-1",
      { horizonDays: 0, replaceOverrides: ["pulloutAddress"] }
    );

    assert.deepEqual(overrideUpdate.$set, { "overrides.pulloutAddress": false });
    assert.equal(overrideUpdate.$set["overrides.status"], undefined);
    assert.deepEqual(
      projectedOperations[0].updateOne.update[0].$set.pulloutAddress,
      { $cond: ["$overrides.pulloutAddress", "$pulloutAddress", "New address"] }
    );
  } finally {
    Division.findById = originals.findDivision;
    DivisionThresholdChange.find = originals.findThresholds;
    RunCutDay.updateMany = originals.updateDays;
    RunCutDay.bulkWrite = originals.bulkWriteDays;
    RunCutDay.find = originals.findDays;
  }
});
