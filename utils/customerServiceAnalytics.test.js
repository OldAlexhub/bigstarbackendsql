import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerServiceAnalytics } from "./customerServiceAnalytics.js";

test("customer service analytics rolls daily Network Success trips into monthly rates", () => {
  const result = buildCustomerServiceAnalytics(
    [
      { _id: "entry-1", month: "2026-08", complaints: 5, compliments: 10 },
      { _id: "entry-2", month: "2026-09", complaints: 3, compliments: 2 },
    ],
    [
      { date: "2026-08-01", metrics: { completedTrips: 400 } },
      { date: "2026-08-02", metrics: { completedTrips: 600 } },
      { date: "2026-09-01", metrics: { completedTrips: 500 } },
    ]
  );

  assert.deepEqual(result.monthly[0], {
    id: "entry-1",
    month: "2026-08",
    complaints: 5,
    compliments: 10,
    trips: 1000,
    complaintRatePer1000: 5,
    complimentRatePer1000: 10,
    hasTripData: true,
  });
  assert.equal(result.summary.trips, 1500);
  assert.equal(result.summary.complaintRatePer1000, 5.33);
  assert.equal(result.summary.complimentRatePer1000, 8);
  assert.equal(result.summary.matchedMonths, 2);
});

test("months without Network Success trips remain visible and are excluded from aggregate rates", () => {
  const result = buildCustomerServiceAnalytics(
    [
      { _id: "entry-1", month: "2026-08", complaints: 2, compliments: 1 },
      { _id: "entry-2", month: "2026-09", complaints: 20, compliments: 10 },
    ],
    [{ date: "2026-08-15", metrics: { completedTrips: 1000 } }]
  );

  assert.equal(result.summary.complaints, 22);
  assert.equal(result.summary.complaintRatePer1000, 2);
  assert.equal(result.summary.complimentRatePer1000, 1);
  assert.equal(result.summary.missingTripMonths, 1);
  assert.equal(result.monthly[1].hasTripData, false);
  assert.equal(result.monthly[1].complaintRatePer1000, null);
});
