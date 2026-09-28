import assert from "node:assert/strict";
import test from "node:test";
import {
  activateRouteWithStandbyCoverage,
  CLOSED_SUSPENDED_DISPOSITION,
  removeStandbyCoverageFromRoute,
  resolveStandbyPulloutAddress,
  syncDispositionWithStatus,
  syncStatusWithDisposition,
} from "./dispositions.js";

test("a suspended status automatically owns the Closed/Suspended disposition", () => {
  const runCutDay = {
    disposition: "deployed_late",
    dispositionSource: "manual",
    dispositionStandbyDay: "standby-day-id",
  };

  assert.equal(syncDispositionWithStatus(runCutDay, "suspended"), true);
  assert.equal(runCutDay.disposition, CLOSED_SUSPENDED_DISPOSITION);
  assert.equal(runCutDay.dispositionSource, "status");
  assert.equal(runCutDay.dispositionStandbyDay, null);
});

test("moving away from suspended clears only a status-owned disposition", () => {
  const runCutDay = {
    disposition: CLOSED_SUSPENDED_DISPOSITION,
    dispositionSource: "status",
    dispositionStandbyDay: null,
  };

  assert.equal(syncDispositionWithStatus(runCutDay, "active"), true);
  assert.equal(runCutDay.disposition, null);
  assert.equal(runCutDay.dispositionSource, null);
  assert.equal(runCutDay.dispositionStandbyDay, null);
});

test("a non-suspended status preserves a manually selected disposition", () => {
  const runCutDay = {
    disposition: "deployed_on_time",
    dispositionSource: "manual",
    dispositionStandbyDay: null,
  };

  assert.equal(syncDispositionWithStatus(runCutDay, "active"), false);
  assert.equal(runCutDay.disposition, "deployed_on_time");
  assert.equal(runCutDay.dispositionSource, "manual");
});

test("selecting Closed/Suspended automatically sets and owns the Suspended status", () => {
  const runCutDay = {
    status: "active",
    disposition: null,
    dispositionSource: null,
    dispositionStandbyDay: null,
  };

  assert.equal(
    syncStatusWithDisposition(runCutDay, CLOSED_SUSPENDED_DISPOSITION),
    true
  );
  assert.equal(runCutDay.status, "suspended");
  assert.equal(runCutDay.disposition, CLOSED_SUSPENDED_DISPOSITION);
  assert.equal(runCutDay.dispositionSource, "status");
});

test("other disposition selections do not change the route status", () => {
  const runCutDay = { status: "active" };

  assert.equal(syncStatusWithDisposition(runCutDay, "deployed_late"), false);
  assert.equal(runCutDay.status, "active");
});

test("standby coverage activates the covered route and owns its disposition", () => {
  const runCutDay = {
    status: "suspended",
    disposition: CLOSED_SUSPENDED_DISPOSITION,
    dispositionSource: "status",
    dispositionStandbyDay: null,
  };

  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id");

  assert.equal(runCutDay.status, "active");
  assert.equal(runCutDay.disposition, "deployed_stby");
  assert.equal(runCutDay.dispositionSource, "standby");
  assert.equal(runCutDay.dispositionStandbyDay, "standby-day-id");
});

test("removing standby restores an unassigned or suspended route's exact prior state", () => {
  const priorStates = [
    {
      label: "unassigned",
      status: "unassigned",
      statusOverride: false,
      serviceHours: 6.75,
      revenueHours: 5.4,
      disposition: null,
      dispositionSource: null,
    },
    {
      label: "suspended",
      status: "suspended",
      statusOverride: true,
      serviceHours: 4.25,
      revenueHours: 3.1,
      disposition: CLOSED_SUSPENDED_DISPOSITION,
      dispositionSource: "status",
    },
  ];

  for (const prior of priorStates) {
    const runCutDay = {
      status: prior.status,
      serviceHours: prior.serviceHours,
      revenueHours: prior.revenueHours,
      disposition: prior.disposition,
      dispositionSource: prior.dispositionSource,
      dispositionStandbyDay: null,
      routeStateStandbyDay: null,
      statusBeforeStandby: null,
      statusOverrideBeforeStandby: false,
      serviceHoursBeforeStandby: null,
      revenueHoursBeforeStandby: null,
      dispositionBeforeStandby: null,
      dispositionSourceBeforeStandby: null,
      dispositionStandbyDayBeforeStandby: null,
      overrides: { status: prior.statusOverride },
    };

    activateRouteWithStandbyCoverage(runCutDay, "standby-day-id");
    runCutDay.overrides.status = true;
    runCutDay.serviceHours = 9;
    runCutDay.revenueHours = 7.2;

    // Re-saving the same deployment must not replace the original snapshot
    // with the temporary active state.
    activateRouteWithStandbyCoverage(runCutDay, "standby-day-id");

    assert.equal(removeStandbyCoverageFromRoute(runCutDay, "standby-day-id"), true, prior.label);
    assert.equal(runCutDay.status, prior.status, prior.label);
    assert.equal(runCutDay.overrides.status, prior.statusOverride, prior.label);
    assert.equal(runCutDay.serviceHours, prior.serviceHours, prior.label);
    assert.equal(runCutDay.revenueHours, prior.revenueHours, prior.label);
    assert.equal(runCutDay.disposition, prior.disposition, prior.label);
    assert.equal(runCutDay.dispositionSource, prior.dispositionSource, prior.label);
    assert.equal(runCutDay.dispositionStandbyDay, null, prior.label);
    assert.equal(runCutDay.routeStateStandbyDay, null, prior.label);
  }
});

test("a disposition manually changed away from standby survives removing that standby's coverage", () => {
  const runCutDay = {
    status: "unassigned",
    serviceHours: 0,
    revenueHours: 0,
    disposition: null,
    dispositionSource: null,
    dispositionStandbyDay: null,
    routeStateStandbyDay: null,
    statusBeforeStandby: null,
    statusOverrideBeforeStandby: false,
    serviceHoursBeforeStandby: null,
    revenueHoursBeforeStandby: null,
    dispositionBeforeStandby: null,
    dispositionSourceBeforeStandby: null,
    dispositionStandbyDayBeforeStandby: null,
    overrides: { status: false },
  };

  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id");
  assert.equal(runCutDay.disposition, "deployed_stby");

  // A dispatcher unlocks and manually overrides the disposition without
  // touching the standby coverage itself (updateRunCutDayException's "else"
  // branch once the standby lock is removed).
  runCutDay.disposition = "deployed_late";
  runCutDay.dispositionSource = "manual";
  runCutDay.dispositionStandbyDay = null;

  assert.equal(removeStandbyCoverageFromRoute(runCutDay, "standby-day-id"), true);
  assert.equal(runCutDay.status, "unassigned");
  assert.equal(runCutDay.disposition, "deployed_late", "the manual override must not be reverted");
  assert.equal(runCutDay.dispositionSource, "manual");
});

test("standby coverage carries its pullout address to the covered route and restores the prior value", () => {
  const runCutDay = {
    status: "active",
    disposition: null,
    dispositionSource: null,
    dispositionStandbyDay: null,
    pulloutAddress: "Original Garage",
    pulloutAddressStandbyDay: null,
    pulloutAddressBeforeStandby: "",
    pulloutAddressOverrideBeforeStandby: false,
    overrides: { pulloutAddress: false },
  };

  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id", { pulloutAddress: "Standby Depot" });

  assert.equal(runCutDay.pulloutAddress, "Standby Depot");
  assert.equal(runCutDay.pulloutAddressStandbyDay, "standby-day-id");
  assert.equal(runCutDay.pulloutAddressBeforeStandby, "Original Garage");
  assert.equal(runCutDay.overrides.pulloutAddress, true);

  assert.equal(removeStandbyCoverageFromRoute(runCutDay, "standby-day-id"), true);
  assert.equal(runCutDay.pulloutAddress, "Original Garage");
  assert.equal(runCutDay.pulloutAddressStandbyDay, null);
  assert.equal(runCutDay.overrides.pulloutAddress, false);
});

test("an undefined standby pullout address leaves the covered route's own address untouched (a division that keeps its route's address)", () => {
  const runCutDay = {
    status: "active",
    disposition: null,
    dispositionSource: null,
    dispositionStandbyDay: null,
    pulloutAddress: "GoLink's own stop",
    pulloutAddressStandbyDay: null,
    pulloutAddressBeforeStandby: "",
    pulloutAddressOverrideBeforeStandby: false,
    overrides: { pulloutAddress: false },
  };

  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id", { pulloutAddress: undefined });

  assert.equal(runCutDay.pulloutAddress, "GoLink's own stop");
  assert.equal(runCutDay.pulloutAddressStandbyDay, null);
  assert.equal(runCutDay.overrides.pulloutAddress, false);

  // Removing that same coverage is then a no-op for pullout address, since
  // the standby never took ownership of it.
  assert.equal(removeStandbyCoverageFromRoute(runCutDay, "standby-day-id"), true);
  assert.equal(runCutDay.pulloutAddress, "GoLink's own stop");
});

test("refreshing the same standby coverage does not replace the original pullout snapshot", () => {
  const runCutDay = {
    pulloutAddress: "Original Garage",
    pulloutAddressStandbyDay: null,
    pulloutAddressBeforeStandby: "",
    pulloutAddressOverrideBeforeStandby: true,
    overrides: { pulloutAddress: true },
  };

  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id", { pulloutAddress: "First Standby Depot" });
  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id", { pulloutAddress: "Updated Standby Depot" });

  assert.equal(runCutDay.pulloutAddress, "Updated Standby Depot");
  assert.equal(runCutDay.pulloutAddressBeforeStandby, "Original Garage");
  removeStandbyCoverageFromRoute(runCutDay, "standby-day-id");
  assert.equal(runCutDay.pulloutAddress, "Original Garage");
  assert.equal(runCutDay.overrides.pulloutAddress, true);
});

test("standby coverage substitutes the operator and vehicle onto the covered route, restoring the prior ones", () => {
  const runCutDay = {
    status: "unassigned",
    disposition: null,
    dispositionSource: null,
    dispositionStandbyDay: null,
    operator: null,
    operatorStandbyDay: null,
    operatorBeforeStandby: null,
    operatorOverrideBeforeStandby: false,
    vehicle: "vehicle-original",
    vehicleStandbyDay: null,
    vehicleBeforeStandby: null,
    vehicleOverrideBeforeStandby: false,
    overrides: { operator: false, vehicle: true },
  };

  activateRouteWithStandbyCoverage(runCutDay, "standby-day-id", {
    operator: "standby-operator",
    vehicle: "standby-vehicle",
  });

  assert.equal(runCutDay.operator, "standby-operator");
  assert.equal(runCutDay.operatorStandbyDay, "standby-day-id");
  assert.equal(runCutDay.operatorBeforeStandby, null);
  assert.equal(runCutDay.overrides.operator, true);

  assert.equal(runCutDay.vehicle, "standby-vehicle");
  assert.equal(runCutDay.vehicleStandbyDay, "standby-day-id");
  assert.equal(runCutDay.vehicleBeforeStandby, "vehicle-original");
  assert.equal(runCutDay.overrides.vehicle, true);

  assert.equal(removeStandbyCoverageFromRoute(runCutDay, "standby-day-id"), true);
  assert.equal(runCutDay.operator, null);
  assert.equal(runCutDay.operatorStandbyDay, null);
  assert.equal(runCutDay.overrides.operator, false);
  assert.equal(runCutDay.vehicle, "vehicle-original");
  assert.equal(runCutDay.overrides.vehicle, true);
});

test("resolveStandbyPulloutAddress uses the standby's own address when a division has not opted in", () => {
  assert.equal(
    resolveStandbyPulloutAddress({
      divisionKeepsRouteAddress: false,
      standbyPulloutAddress: "Standby Depot",
      coveredPulloutAddress: "",
      masterPulloutAddress: "GoLink's standing stop",
    }),
    "Standby Depot"
  );
});

test("resolveStandbyPulloutAddress leaves the covered day's own address alone when it already has one", () => {
  assert.equal(
    resolveStandbyPulloutAddress({
      divisionKeepsRouteAddress: true,
      standbyPulloutAddress: "Standby Depot",
      coveredPulloutAddress: "GoLink's own stop",
      masterPulloutAddress: "GoLink's standing stop",
    }),
    undefined
  );
});

test("resolveStandbyPulloutAddress falls back to the route's standing Master Run Cut address when the covered day has none — this is the fix for a division whose Unassigned days show a blank pullout instead of the route's real one", () => {
  assert.equal(
    resolveStandbyPulloutAddress({
      divisionKeepsRouteAddress: true,
      standbyPulloutAddress: "Standby Depot",
      coveredPulloutAddress: "",
      masterPulloutAddress: "GoLink's standing stop",
    }),
    "GoLink's standing stop"
  );
});

test("resolveStandbyPulloutAddress leaves the address untouched when neither the day nor the master run cut has one", () => {
  assert.equal(
    resolveStandbyPulloutAddress({
      divisionKeepsRouteAddress: true,
      standbyPulloutAddress: "Standby Depot",
      coveredPulloutAddress: "",
      masterPulloutAddress: "",
    }),
    undefined
  );
});
