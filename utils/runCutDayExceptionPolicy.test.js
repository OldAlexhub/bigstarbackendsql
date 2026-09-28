import assert from "node:assert/strict";
import test from "node:test";
import { OSR_DISRUPTION_TYPE } from "./disruptionTypes.js";
import { exceptionPlanningWindowError, exceptionStatus } from "./runCutDayExceptionPolicy.js";

test("OSR does not suspend a route unless suspended is explicitly requested", () => {
  assert.equal(exceptionStatus({ currentStatus: "active", requestedStatus: undefined }), "active");
  assert.equal(exceptionStatus({ currentStatus: "active", requestedStatus: "suspended" }), "suspended");
});

test("OSR assignment and time changes use the configured advance window", () => {
  assert.equal(exceptionPlanningWindowError({
    offset: 5,
    assignmentWasUpdated: true,
    disruptionType: OSR_DISRUPTION_TYPE,
    osrAdvanceDays: 7,
  }), null);
});

test("ordinary assignment edits remain limited to today and tomorrow", () => {
  assert.match(exceptionPlanningWindowError({
    offset: 5,
    assignmentWasUpdated: true,
    disruptionType: "Vehicle Breakdown",
    osrAdvanceDays: 7,
  }), /today and tomorrow/);
});

test("OSR outside the configured advance window is rejected", () => {
  assert.match(exceptionPlanningWindowError({
    offset: 6,
    assignmentWasUpdated: true,
    disruptionType: OSR_DISRUPTION_TYPE,
    osrAdvanceDays: 5,
  }), /through 5 days ahead/);
});
