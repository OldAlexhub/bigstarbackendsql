import assert from "node:assert/strict";
import test from "node:test";
import Operator from "../models/Operator.js";
import { diffRunCutEdit, normalizeRunCutEdit, runCutPreview } from "./runCutEdits.js";

test("a Permanent OSR preserves an explicitly entered pullout address", async () => {
  const originalFindOne = Operator.findOne;
  Operator.findOne = async () => ({
    _id: "507f1f77bcf86cd799439012",
    pulloutAddress: "Roster address",
    active: true,
  });
  try {
    const { body } = await normalizeRunCutEdit(
      { division: "507f1f77bcf86cd799439011" },
      {
        operatorId: "507f1f77bcf86cd799439012",
        pulloutAddress: "OSR pullout address",
      }
    );
    assert.equal(body.pulloutAddress, "OSR pullout address");
    assert.equal(String(body.operator), "507f1f77bcf86cd799439012");
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
