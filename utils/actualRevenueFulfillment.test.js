import assert from "node:assert/strict";
import test from "node:test";
import { actualRevenueFulfillment, combineActualRevenue } from "./actualRevenueFulfillment.js";

test("actual revenue fulfillment compares uploaded revenue with the matching Master Run Cut plan", () => {
  const entries = [
    { route: "route-1", metrics: { reportedRevenueHours: 7 }, deployment: { scheduledRevenueHours: 6 } },
    { route: "route-2", metrics: { reportedRevenueHours: 4 }, deployment: { scheduledRevenueHours: 5 } },
    { route: "route-3", metrics: { reportedRevenueHours: null }, deployment: { scheduledRevenueHours: 10 } },
  ];
  const result = actualRevenueFulfillment(entries, new Map([
    ["route-1", 8],
    ["route-2", 4],
  ]));

  assert.equal(result.actualRevenueHours, 11);
  assert.equal(result.actualRevenueHoursPlanned, 12);
  assert.equal(result.actualRevenueHourFulfillmentPct, 0.9167);
  assert.equal(result.actualRevenueComparableRouteDays, 2);
  assert.equal(result.actualRevenueDataRouteDays, 2);
});

test("actual revenue fulfillment stays unavailable instead of reporting a false zero", () => {
  const noActual = actualRevenueFulfillment([
    { route: "route-1", metrics: { reportedRevenueHours: null }, deployment: { scheduledRevenueHours: 8 } },
  ]);
  assert.equal(noActual.actualRevenueHourFulfillmentPct, null);
  assert.equal(noActual.actualRevenueHours, null);

  const combined = combineActualRevenue([
    { actualRevenueHours: 7, actualRevenueHoursPlanned: 8, actualRevenueDataRouteDays: 1, actualRevenueComparableRouteDays: 1 },
    { actualRevenueHours: 9, actualRevenueHoursPlanned: 10, actualRevenueDataRouteDays: 1, actualRevenueComparableRouteDays: 1 },
  ]);
  assert.equal(combined.actualRevenueHourFulfillmentPct, 0.8889);
});
