import test from "node:test";
import assert from "node:assert/strict";
import CorrectiveActionPlan from "../models/CorrectiveActionPlan.js";
import { calculateMetricValues, findCapTriggerMonth, reconcileCapForResult } from "./operationsReporting.js";

test("operations metrics use matching totals and weighted source values", () => {
  const values = calculateMetricValues({
    runCutDays: [
      { route: { type: "standard" }, status: "active" },
      { route: { type: "standard" }, status: "suspended" },
      { route: { type: "standby" }, status: "active", deployed: true },
      { route: { type: "standby" }, status: "active", deployed: false },
    ],
    networkEntries: [
      { route: "r1", metrics: { completedTrips: 20, reportedServiceHours: 10, reportedRevenueHours: 8, otpPct: 0.9, tpsh: 2 }, deployment: { scheduledRevenueHours: 10 } },
      { route: "r2", metrics: { completedTrips: 30, reportedServiceHours: null, reportedRevenueHours: 9, otpPct: 1, tpsh: 3 }, deployment: { scheduledRevenueHours: 10 } },
      { route: "r3", metrics: { completedTrips: 5, reportedServiceHours: null, reportedRevenueHours: null, otpPct: null, tpsh: null }, deployment: { scheduledRevenueHours: 10 } },
    ],
    safety: { miles: 200000, preventableAccidents: 1 },
    safetyScore: { score: 92.5 },
    customer: { complaints: 2 },
  });

  assert.equal(values.run_cut_fulfillment.value, 0.5);
  assert.equal(values.core_revenue_fulfillment.value, 0.85);
  assert.equal(values.otp.value, 0.96);
  assert.equal(values.standby_utilization.value, 0.5);
  assert.equal(values.preventable_accident_ratio.value, 0.5);
  assert.equal(values.complaint_ratio.value, 36.363636);
  assert.equal(values.safety_score.value, 92.5);
  assert.equal(values.tpsh.value, 2.5);
});

test("operations metrics keep unavailable inputs as No Data candidates", () => {
  const values = calculateMetricValues({ runCutDays: [], networkEntries: [], safety: null, safetyScore: null, customer: null });
  Object.values(values).forEach((result) => assert.equal(result.value, null));
});

test("CAP reconciliation no longer auto-creates a new episode for a red month", async (context) => {
  const originalFindOne = CorrectiveActionPlan.findOne;
  CorrectiveActionPlan.findOne = (filter) => {
    if (Object.prototype.hasOwnProperty.call(filter, "activeEpisode")) return Promise.resolve(null);
    return { sort: async () => null };
  };
  context.after(() => {
    CorrectiveActionPlan.findOne = originalFindOne;
  });

  const result = {
    division: "division-1",
    kpiKey: "tpsh",
    month: "2026-09",
    value: 1.1,
    status: "red",
    closed: true,
    setting: { target: 1.25, redCutoff: 1.23, direction: "higher", assignedManager: null },
  };
  const outcome = await reconcileCapForResult(result, "2026-09");
  assert.equal(outcome, null);
});

test("CAP reconciliation keeps updating an already-opened episode through worsening and recovery", async (context) => {
  const originalFindOne = CorrectiveActionPlan.findOne;
  const active = {
    division: "division-1",
    kpiKey: "tpsh",
    triggerMonth: "2026-09",
    status: "open",
    latestMonth: "2026-09",
    recoveryCandidate: {},
    audit: [],
    async save() {},
  };
  CorrectiveActionPlan.findOne = (filter) => {
    if (Object.prototype.hasOwnProperty.call(filter, "activeEpisode")) return Promise.resolve(active);
    return { sort: async () => null };
  };
  context.after(() => {
    CorrectiveActionPlan.findOne = originalFindOne;
  });

  const result = {
    division: "division-1",
    kpiKey: "tpsh",
    month: "2026-10",
    value: 1,
    status: "critical",
    closed: true,
    setting: { target: 1.25, redCutoff: 1.23, direction: "higher", assignedManager: null },
  };
  await reconcileCapForResult(result, "2026-09");
  assert.equal(active.latestMonth, "2026-10");

  await reconcileCapForResult({ ...result, month: "2026-11", value: 1.3, status: "green" }, "2026-09");
  assert.equal(active.status, "recovery_ready");
  assert.equal(active.recoveryCandidate.month, "2026-11");
});

test("findCapTriggerMonth picks the earliest eligible red or critical month", () => {
  const monthlyResults = [
    { month: "2026-06", closed: true, status: "green", value: 1, setting: { target: 1 } },
    { month: "2026-07", closed: true, status: "red", value: 0.8, setting: { target: 1 } },
    { month: "2026-08", closed: true, status: "critical", value: 0.7, setting: { target: 1 } },
  ];
  const candidate = findCapTriggerMonth({ monthlyResults, activationMonth: "2026-01", latestCap: null });
  assert.equal(candidate.month, "2026-07");
});

test("findCapTriggerMonth respects the activation month floor and a prior recovery", () => {
  const monthlyResults = [
    { month: "2026-05", closed: true, status: "red", value: 0.8, setting: { target: 1 } },
    { month: "2026-06", closed: true, status: "red", value: 0.8, setting: { target: 1 } },
  ];
  assert.equal(findCapTriggerMonth({ monthlyResults, activationMonth: "2026-06", latestCap: null }).month, "2026-06");
  assert.equal(findCapTriggerMonth({ monthlyResults, activationMonth: "2026-07", latestCap: null }), null);
  assert.equal(
    findCapTriggerMonth({ monthlyResults, activationMonth: "2026-01", latestCap: { status: "recovered", recoveryCandidate: { month: "2026-06" } } }),
    null
  );
});
