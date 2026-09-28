import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "../db/sqlMongoose.js";
import RunCutDay from "./RunCutDay.js";

const requiredFields = () => ({
  division: new mongoose.Types.ObjectId(),
  route: new mongoose.Types.ObjectId(),
  date: new Date("2026-09-08T00:00:00.000Z"),
});

test("RunCutDay accepts each live-day disposition", async () => {
  for (const disposition of [
    "deployed_on_time",
    "deployed_late",
    "deployed_stby",
    "reallocated",
    "closed_suspended",
  ]) {
    const runCutDay = new RunCutDay({ ...requiredFields(), disposition });
    await runCutDay.validate();
  }
});

test("RunCutDay rejects an unknown disposition", async () => {
  const runCutDay = new RunCutDay({ ...requiredFields(), disposition: "unknown" });
  await assert.rejects(runCutDay.validate(), /not a valid enum value/);
});

test("a new RunCutDay starts without a disposition", () => {
  const runCutDay = new RunCutDay(requiredFields());
  assert.equal(runCutDay.disposition, null);
  assert.equal(runCutDay.dispositionSource, null);
  assert.equal(runCutDay.dispositionStandbyDay, null);
  assert.equal(runCutDay.routeStateStandbyDay, null);
  assert.equal(runCutDay.statusBeforeStandby, null);
  assert.equal(runCutDay.statusOverrideBeforeStandby, false);
  assert.equal(runCutDay.serviceHoursBeforeStandby, null);
  assert.equal(runCutDay.revenueHoursBeforeStandby, null);
  assert.equal(runCutDay.dispositionBeforeStandby, null);
  assert.equal(runCutDay.dispositionSourceBeforeStandby, null);
  assert.equal(runCutDay.dispositionStandbyDayBeforeStandby, null);
  assert.equal(runCutDay.overrides.operator, false);
  assert.equal(runCutDay.overrides.vehicle, false);
  assert.equal(runCutDay.overrides.pulloutAddress, false);
  assert.equal(runCutDay.pulloutAddressStandbyDay, null);
  assert.equal(runCutDay.pulloutAddressBeforeStandby, "");
  assert.equal(runCutDay.pulloutAddressOverrideBeforeStandby, false);
  assert.equal(runCutDay.overrides.startTime, false);
  assert.equal(runCutDay.overrides.endTime, false);
});

test("RunCutDay accepts a status-owned disposition", async () => {
  const runCutDay = new RunCutDay({
    ...requiredFields(),
    status: "suspended",
    disposition: "closed_suspended",
    dispositionSource: "status",
  });

  await runCutDay.validate();
});

test("standby coverage has a partial unique concurrency guard", () => {
  const coverageIndex = RunCutDay.schema.indexes().find(([, options]) =>
    options.name === "one_deployed_standby_per_covered_route_global"
  );
  assert.ok(coverageIndex);
  assert.deepEqual(coverageIndex[0], { date: 1, coveringRoute: 1 });
  assert.equal(coverageIndex[1].unique, true);
  assert.equal(coverageIndex[1].name, "one_deployed_standby_per_covered_route_global");
  assert.deepEqual(coverageIndex[1].partialFilterExpression, {
    deployed: true,
    coveringRoute: { $type: "objectId" },
  });
});
