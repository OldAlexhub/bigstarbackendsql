import assert from "node:assert/strict";
import test from "node:test";
import { buildSafetyAnalytics } from "./safetyAnalytics.js";

test("safety analytics calculates monthly and range rates per 100,000 miles", () => {
  const result = buildSafetyAnalytics([
    { _id: "entry-1", month: "2026-07", miles: 50000, preventableAccidents: 1, nonPreventableAccidents: 2 },
    { _id: "entry-2", month: "2026-08", miles: 150000, preventableAccidents: 2, nonPreventableAccidents: 1 },
  ]);

  assert.equal(result.monthly[0].preventableRatePer100000, 2);
  assert.equal(result.monthly[0].nonPreventableRatePer100000, 4);
  assert.equal(result.monthly[1].preventableRatePer100000, 1.33);
  assert.equal(result.summary.miles, 200000);
  assert.equal(result.summary.preventableAccidents, 3);
  assert.equal(result.summary.preventableRatePer100000, 1.5);
  assert.equal(result.summary.nonPreventableRatePer100000, 1.5);
});

test("a zero-mile month with zero accidents remains visible with unavailable rates", () => {
  const result = buildSafetyAnalytics([
    { _id: "entry-1", month: "2026-08", miles: 0, preventableAccidents: 0, nonPreventableAccidents: 0 },
  ]);

  assert.equal(result.monthly[0].preventableRatePer100000, null);
  assert.equal(result.monthly[0].nonPreventableRatePer100000, null);
  assert.equal(result.summary.zeroMileMonths, 1);
});
