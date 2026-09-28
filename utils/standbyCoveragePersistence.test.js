import assert from "node:assert/strict";
import test from "node:test";
import RunCutDay from "../models/RunCutDay.js";
import { restoreCoverageOwnedByStandbyDays } from "./standbyCoveragePersistence.js";

test("deleting a standby day restores the complete prior state of its covered route", async () => {
  const originalFind = RunCutDay.find;
  let saved = false;
  const coveredDay = {
    status: "active",
    serviceHours: 9,
    revenueHours: 7.2,
    disposition: "deployed_stby",
    dispositionSource: "standby",
    dispositionStandbyDay: "standby-day-1",
    routeStateStandbyDay: "standby-day-1",
    statusBeforeStandby: "suspended",
    statusOverrideBeforeStandby: true,
    serviceHoursBeforeStandby: 4.5,
    revenueHoursBeforeStandby: 3.5,
    dispositionBeforeStandby: "closed_suspended",
    dispositionSourceBeforeStandby: "status",
    dispositionStandbyDayBeforeStandby: null,
    pulloutAddress: "Standby Depot",
    pulloutAddressStandbyDay: "standby-day-1",
    pulloutAddressBeforeStandby: "Route Garage",
    pulloutAddressOverrideBeforeStandby: false,
    overrides: { pulloutAddress: true, status: true },
    async save() { saved = true; },
  };
  RunCutDay.find = async () => [coveredDay];

  try {
    await restoreCoverageOwnedByStandbyDays(["standby-day-1"], "user-1");
    assert.equal(saved, true);
    assert.equal(coveredDay.pulloutAddress, "Route Garage");
    assert.equal(coveredDay.pulloutAddressStandbyDay, null);
    assert.equal(coveredDay.overrides.pulloutAddress, false);
    assert.equal(coveredDay.status, "suspended");
    assert.equal(coveredDay.overrides.status, true);
    assert.equal(coveredDay.serviceHours, 4.5);
    assert.equal(coveredDay.revenueHours, 3.5);
    assert.equal(coveredDay.disposition, "closed_suspended");
    assert.equal(coveredDay.dispositionSource, "status");
    assert.equal(coveredDay.routeStateStandbyDay, null);
    assert.equal(coveredDay.updatedBy, "user-1");
  } finally {
    RunCutDay.find = originalFind;
  }
});
