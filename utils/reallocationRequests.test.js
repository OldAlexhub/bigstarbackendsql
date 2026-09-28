import assert from "node:assert/strict";
import test from "node:test";
import { applyReallocationAssignment, assignmentMatchesSnapshot, buildReallocationPlan, normalizeReallocationAssignment, statusAfterReallocation } from "./reallocationRequests.js";

test("a blank operator unassigns the current route when there is no destination", () => {
  const plan = buildReallocationPlan({
    originalOperatorName: "Alex Driver",
    requestedOperatorName: "",
    requestedVehicleCode: "V-12",
    requestedPulloutAddress: "100 Main St",
    destinationRunCut: null,
  });

  assert.equal(plan.movingRoutes, false);
  assert.equal(plan.operatorName, "");
  assert.equal(plan.sourceAssignment, null);
  assert.deepEqual(plan.targetAssignment, { vehicleCode: "", pulloutAddress: "" });
});

test("an entered operator replaces the current route assignment", () => {
  const plan = buildReallocationPlan({
    originalOperatorName: "Alex Driver",
    requestedOperatorName: "Taylor Driver",
    requestedVehicleCode: "V-12",
    requestedPulloutAddress: "100 Main St",
    destinationRunCut: null,
  });

  assert.equal(plan.movingRoutes, false);
  assert.equal(plan.operatorName, "Taylor Driver");
});

test("a destination route moves the current operator when no replacement name is entered", () => {
  const plan = buildReallocationPlan({
    originalOperatorName: "Alex Driver",
    requestedOperatorName: "",
    requestedVehicleCode: "V-12",
    requestedPulloutAddress: "100 Main St",
    destinationRunCut: "destination-run-cut",
  });

  assert.equal(plan.movingRoutes, true);
  assert.equal(plan.operatorName, "Alex Driver");
  assert.deepEqual(plan.sourceAssignment, { operator: null, vehicle: null, pulloutAddress: "" });
  assert.deepEqual(plan.targetAssignment, { vehicleCode: "V-12", pulloutAddress: "100 Main St" });
});

test("approval detects assignment changes made after submission", () => {
  const request = {
    originalOperatorName: "Alex Driver",
    originalVehicleCode: "V-12",
    originalPulloutAddress: "100 Main St",
  };
  const unchanged = {
    operator: { name: "Alex Driver" },
    vehicle: { code: "V-12" },
    pulloutAddress: "100 Main St",
  };
  const changed = { ...unchanged, operator: { name: "Taylor Driver" } };

  assert.equal(assignmentMatchesSnapshot(unchanged, request), true);
  assert.equal(assignmentMatchesSnapshot(changed, request), false);
});

test("reallocation status follows the resulting operator assignment", () => {
  assert.equal(statusAfterReallocation("active", null), "unassigned");
  assert.equal(statusAfterReallocation("unassigned", { _id: "operator-1" }), "active");
  assert.equal(statusAfterReallocation("suspended", { _id: "operator-1" }), "suspended");
});

test("only a true unassignment clears vehicle and pullout details", () => {
  assert.deepEqual(
    normalizeReallocationAssignment({
      movingRoutes: false,
      operatorName: "",
      vehicleCode: "V-12",
      pulloutAddress: "100 Main St",
    }),
    { operatorName: "", vehicleCode: "", pulloutAddress: "" }
  );
  assert.deepEqual(
    normalizeReallocationAssignment({
      movingRoutes: false,
      operatorName: "Taylor Driver",
      vehicleCode: "V-12",
      pulloutAddress: "100 Main St",
    }),
    { operatorName: "Taylor Driver", vehicleCode: "V-12", pulloutAddress: "100 Main St" }
  );
});

test("applying an unassignment clears assignment fields and preserves schedule times", () => {
  const runCut = {
    operator: "operator-1",
    vehicle: "vehicle-1",
    pulloutAddress: "100 Main St",
    startTime: "08:00",
    endTime: "18:00",
    status: "active",
  };

  applyReallocationAssignment(runCut, { operator: null, vehicle: null, pulloutAddress: "" });

  assert.deepEqual(runCut, {
    operator: null,
    vehicle: null,
    pulloutAddress: "",
    startTime: "08:00",
    endTime: "18:00",
    status: "unassigned",
  });
});

test("applying a new operator activates an Unassigned route with requested details", () => {
  const runCut = {
    operator: null,
    vehicle: null,
    pulloutAddress: "",
    startTime: "08:00",
    endTime: "18:00",
    status: "unassigned",
  };

  applyReallocationAssignment(runCut, {
    operator: "operator-2",
    vehicle: "vehicle-2",
    pulloutAddress: "200 Main St",
  });

  assert.equal(runCut.operator, "operator-2");
  assert.equal(runCut.vehicle, "vehicle-2");
  assert.equal(runCut.pulloutAddress, "200 Main St");
  assert.equal(runCut.status, "active");
  assert.equal(runCut.startTime, "08:00");
  assert.equal(runCut.endTime, "18:00");
});
