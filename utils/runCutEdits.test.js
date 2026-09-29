import assert from "node:assert/strict";
import test from "node:test";
import Operator from "../models/Operator.js";
import ChangeLog from "../models/ChangeLog.js";
import Division from "../models/Division.js";
import DivisionThresholdChange from "../models/DivisionThresholdChange.js";
import RunCutDay from "../models/RunCutDay.js";
import { applyRunCutEdit, diffRunCutEdit, normalizeRunCutEdit, runCutPreview } from "./runCutEdits.js";

test("a Permanent OSR preserves an explicitly entered pullout address", async () => {
  const originalFindOne = Operator.findOne;
  Operator.findOne = async () => ({
    _id: "507f1f77bcf86cd799439012",
    pulloutAddress: "Roster address",
    active: true,
  });
  try {
    const runCut = {
      division: "507f1f77bcf86cd799439011",
      pulloutAddress: "Roster address",
    };
    const { body } = await normalizeRunCutEdit(
      runCut,
      {
        operatorId: "507f1f77bcf86cd799439012",
        pulloutAddress: "  OSR pullout address  ",
      }
    );
    assert.equal(body.pulloutAddress, "OSR pullout address");
    assert.equal(String(body.operator), "507f1f77bcf86cd799439012");
    assert.deepEqual(
      diffRunCutEdit(runCut, body).find((change) => change.field === "pulloutAddress"),
      { field: "pulloutAddress", oldValue: "Roster address", newValue: "OSR pullout address" }
    );
  } finally {
    Operator.findOne = originalFindOne;
  }
});

test("a driver change defaults to the roster pullout address when none is supplied", async () => {
  const originalFindOne = Operator.findOne;
  Operator.findOne = async () => ({
    _id: "507f1f77bcf86cd799439012",
    pulloutAddress: "Roster address",
    active: true,
  });
  try {
    const { body } = await normalizeRunCutEdit(
      { division: "507f1f77bcf86cd799439011" },
      { operatorId: "507f1f77bcf86cd799439012" }
    );
    assert.equal(body.pulloutAddress, "Roster address");
  } finally {
    Operator.findOne = originalFindOne;
  }
});

test("an address-only Permanent OSR saves the new Master Run Cut address and audit change", async () => {
  const originals = {
    findDivision: Division.findById,
    findThresholds: DivisionThresholdChange.find,
    findDays: RunCutDay.find,
    insertChanges: ChangeLog.insertMany,
  };
  let saved = false;
  let inserted = [];
  const division = {
    _id: "division-1",
    active: true,
    timezone: "America/New_York",
    thresholds: { breakMinutes: 45, revenueRatio: 1 },
  };
  const runCut = {
    _id: "run-cut-1",
    division: "division-1",
    route: "route-1",
    daysOfWeek: [],
    operator: null,
    vehicle: null,
    pulloutAddress: "Old address",
    startTime: "06:00",
    endTime: "18:00",
    status: "active",
    clientNotes: "",
    disruptionType: null,
    disruptionNotes: "",
    async save() { saved = true; },
  };
  Division.findById = async () => division;
  DivisionThresholdChange.find = () => ({ sort: () => ({ lean: async () => [] }) });
  RunCutDay.find = () => ({ select: async () => [] });
  ChangeLog.insertMany = async (changes) => { inserted = changes; };

  try {
    const result = await applyRunCutEdit(runCut, { pulloutAddress: "New address" }, "user-1");
    assert.equal(saved, true);
    assert.equal(runCut.pulloutAddress, "New address");
    assert.deepEqual(result.changes.find((change) => change.field === "pulloutAddress"), {
      field: "pulloutAddress",
      oldValue: "Old address",
      newValue: "New address",
    });
    assert.equal(inserted.some((change) => change.field === "pulloutAddress"), true);
  } finally {
    Division.findById = originals.findDivision;
    DivisionThresholdChange.find = originals.findThresholds;
    RunCutDay.find = originals.findDays;
    ChangeLog.insertMany = originals.insertChanges;
  }
});

test("future Permanent OSR previews are diffed without changing the live Master Run Cut", () => {
  const live = {
    _id: "run-cut-1",
    division: "division-1",
    daysOfWeek: ["MON"],
    operator: "operator-1",
    vehicle: "vehicle-1",
    pulloutAddress: "100 Main St",
    startTime: "06:00",
    endTime: "18:00",
    status: "active",
    clientNotes: "",
    disruptionType: null,
    disruptionNotes: "",
  };
  const edit = { startTime: "07:00", daysOfWeek: ["MON", "TUE"] };
  const preview = runCutPreview(live, edit);
  const changes = diffRunCutEdit(live, edit);

  assert.equal(preview.startTime, "07:00");
  assert.deepEqual(preview.daysOfWeek, ["MON", "TUE"]);
  assert.equal(live.startTime, "06:00");
  assert.deepEqual(live.daysOfWeek, ["MON"]);
  assert.deepEqual(changes.map((change) => change.field), ["daysOfWeek", "startTime"]);
});
