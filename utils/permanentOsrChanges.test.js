import assert from "node:assert/strict";
import test from "node:test";
import PermanentOsrChange from "../models/PermanentOsrChange.js";
import { isPermanentOsrDue, scheduledPermanentOsrBody } from "./permanentOsrChanges.js";
import { todayInTimezone } from "./timezone.js";

test("a scheduled Permanent OSR maps stored Master Run Cut fields back to an edit request", () => {
  const body = scheduledPermanentOsrBody({
    editableFields: ["operator", "vehicle", "startTime", "status", "daysOfWeek"],
    operator: null,
    vehicle: "vehicle-2",
    startTime: "07:30",
    runCutStatus: "unassigned",
    daysOfWeek: ["MON", "TUE"],
  });

  assert.deepEqual(body, {
    operatorId: null,
    vehicleId: "vehicle-2",
    startTime: "07:30",
    status: "unassigned",
    daysOfWeek: ["MON", "TUE"],
  });
});

test("Permanent OSRs become due on their division-local effective date", () => {
  const timezone = "America/New_York";
  const today = todayInTimezone(timezone);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  assert.equal(isPermanentOsrDue({ effectiveDate: today, division: { timezone } }), true);
  assert.equal(isPermanentOsrDue({ effectiveDate: tomorrow, division: { timezone } }), false);
});

test("only one scheduled Permanent OSR is allowed per Master Run Cut", () => {
  const index = PermanentOsrChange.schema.indexes().find(([, options]) =>
    options.name === "one_scheduled_permanent_osr_per_run_cut"
  );
  assert.deepEqual(index?.[0], { runCut: 1 });
  assert.equal(index?.[1].unique, true);
  assert.deepEqual(index?.[1].partialFilterExpression, { applicationStatus: "scheduled" });
});
