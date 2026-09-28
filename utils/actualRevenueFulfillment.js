const round2 = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const roundFrac = (value) => (Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null);
const id = (value) => String(value?._id || value || "");

export const actualRevenueFulfillment = (entries, plannedRevenueByRoute = new Map()) => {
  let actualRevenueHours = 0;
  let plannedRevenueHours = 0;
  let actualRevenueDataRouteDays = 0;
  let comparableRouteDays = 0;
  let missingPlanRouteDays = 0;

  for (const entry of entries) {
    const actual = entry.metrics?.reportedRevenueHours;
    if (!Number.isFinite(actual)) continue;
    actualRevenueDataRouteDays += 1;

    const routePlan = plannedRevenueByRoute.get(id(entry.route));
    const snapshotPlan = entry.deployment?.scheduledRevenueHours;
    const planned = Number.isFinite(routePlan)
      ? routePlan
      : Number.isFinite(snapshotPlan)
        ? snapshotPlan
        : null;
    if (!Number.isFinite(planned)) {
      missingPlanRouteDays += 1;
      continue;
    }

    actualRevenueHours += actual;
    plannedRevenueHours += planned;
    comparableRouteDays += 1;
  }

  return {
    actualRevenueHourFulfillmentPct: plannedRevenueHours > 0
      ? roundFrac(actualRevenueHours / plannedRevenueHours)
      : null,
    actualRevenueHours: comparableRouteDays ? round2(actualRevenueHours) : null,
    actualRevenueHoursPlanned: comparableRouteDays ? round2(plannedRevenueHours) : null,
    actualRevenueDataRouteDays,
    actualRevenueComparableRouteDays: comparableRouteDays,
    actualRevenueMissingPlanRouteDays: missingPlanRouteDays,
  };
};

export const combineActualRevenue = (summaries) => {
  const combined = summaries.reduce((total, summary) => ({
    actualRevenueHours: total.actualRevenueHours + (summary.actualRevenueHours || 0),
    actualRevenueHoursPlanned: total.actualRevenueHoursPlanned + (summary.actualRevenueHoursPlanned || 0),
    actualRevenueDataRouteDays: total.actualRevenueDataRouteDays + (summary.actualRevenueDataRouteDays || 0),
    actualRevenueComparableRouteDays: total.actualRevenueComparableRouteDays + (summary.actualRevenueComparableRouteDays || 0),
    actualRevenueMissingPlanRouteDays: total.actualRevenueMissingPlanRouteDays + (summary.actualRevenueMissingPlanRouteDays || 0),
  }), {
    actualRevenueHours: 0,
    actualRevenueHoursPlanned: 0,
    actualRevenueDataRouteDays: 0,
    actualRevenueComparableRouteDays: 0,
    actualRevenueMissingPlanRouteDays: 0,
  });

  return {
    ...combined,
    actualRevenueHours: combined.actualRevenueComparableRouteDays ? round2(combined.actualRevenueHours) : null,
    actualRevenueHoursPlanned: combined.actualRevenueComparableRouteDays ? round2(combined.actualRevenueHoursPlanned) : null,
    actualRevenueHourFulfillmentPct: combined.actualRevenueHoursPlanned > 0
      ? roundFrac(combined.actualRevenueHours / combined.actualRevenueHoursPlanned)
      : null,
  };
};
