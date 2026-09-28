import assert from "node:assert/strict";
import test from "node:test";
import DivisionThresholdChange from "../models/DivisionThresholdChange.js";
import { getEffectiveThresholds, resolveThresholdsFromHistory } from "./thresholds.js";

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

test("resolveThresholdsFromHistory picks the latest entry effective on or before the date", () => {
  const history = [
    { effectiveDate: day("2026-11-01"), breakMinutes: 45, revenueRatio: 1 },
    { effectiveDate: day("2026-01-01"), breakMinutes: 30, revenueRatio: 0.9 },
  ];
  assert.deepEqual(resolveThresholdsFromHistory(history, day("2026-06-01"), null), {
    breakMinutes: 30,
    revenueRatio: 0.9,
  });
  assert.deepEqual(resolveThresholdsFromHistory(history, day("2026-11-01"), null), {
    breakMinutes: 45,
    revenueRatio: 1,
  });
  assert.deepEqual(resolveThresholdsFromHistory(history, day("2027-01-01"), null), {
    breakMinutes: 45,
    revenueRatio: 1,
  });
});

test("resolveThresholdsFromHistory never lets a future-dated change affect an earlier date", () => {
  const history = [{ effectiveDate: day("2026-11-01"), breakMinutes: 45, revenueRatio: 1 }];
  assert.deepEqual(resolveThresholdsFromHistory(history, day("2026-10-31"), { breakMinutes: 30, revenueRatio: 0.9 }), {
    breakMinutes: 30,
    revenueRatio: 0.9,
  });
});

test("resolveThresholdsFromHistory uses the given fallback for a date before every recorded change", () => {
  const history = [
    { effectiveDate: day("2026-06-01"), breakMinutes: 45, revenueRatio: 1 },
    { effectiveDate: day("2026-01-01"), breakMinutes: 30, revenueRatio: 0.9 },
  ];
  const fallback = { breakMinutes: 20, revenueRatio: 0.8 };
  assert.deepEqual(resolveThresholdsFromHistory(history, day("2020-01-01"), fallback), fallback);
});

test("resolveThresholdsFromHistory uses the given fallback when there is no history at all", () => {
  const fallback = { breakMinutes: 30, revenueRatio: 0.9 };
  assert.deepEqual(resolveThresholdsFromHistory([], day("2026-06-01"), fallback), fallback);
});

test("getEffectiveThresholds resolves a division's history from the database for a given date", async () => {
  const originalFind = DivisionThresholdChange.find;
  DivisionThresholdChange.find = () => ({
    sort: () => ({
      lean: async () => [
        { effectiveDate: day("2026-11-01"), breakMinutes: 45, revenueRatio: 1 },
        { effectiveDate: day("2026-01-01"), breakMinutes: 30, revenueRatio: 0.9 },
      ],
    }),
  });
  try {
    const division = { _id: "division-1", thresholds: { breakMinutes: 30, revenueRatio: 0.9 } };
    assert.deepEqual(await getEffectiveThresholds(division, day("2026-06-01")), { breakMinutes: 30, revenueRatio: 0.9 });
    assert.deepEqual(await getEffectiveThresholds(division, day("2026-11-15")), { breakMinutes: 45, revenueRatio: 1 });
  } finally {
    DivisionThresholdChange.find = originalFind;
  }
});
