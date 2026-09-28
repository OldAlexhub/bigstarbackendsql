import { isCovered } from "./hours.js";

export const addDays = (date, n) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

export const startOfWeek = (date) => {
  const d = date ? new Date(date) : new Date();
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export const emptyMetrics = () => ({
  revenueHoursScheduled: 0,
  revenueHoursCovered: 0,
  dutiesDeployed: 0,
  dutiesScheduled: 0,
  dutiesSuspended: 0,
  dutiesUnassigned: 0,
  volunteerDuties: 0,
  standbyAvailable: 0,
  standbyDeployed: 0,
});

export const accumulate = (bucket, runCutDay) => {
  if (runCutDay.status !== "off") {
    bucket.revenueHoursScheduled += runCutDay.revenueHours;
    bucket.dutiesScheduled += 1;
  }
  if (isCovered(runCutDay.status)) bucket.revenueHoursCovered += runCutDay.revenueHours;
  if (runCutDay.status === "active") bucket.dutiesDeployed += 1;
  if (runCutDay.status === "suspended") bucket.dutiesSuspended += 1;
  if (runCutDay.status === "unassigned") bucket.dutiesUnassigned += 1;
  if (runCutDay.status === "add_rte") bucket.volunteerDuties += 1;
  return bucket;
};

// Revenue Hour Fulfillment — how much of the scheduled revenue-hour total
// actually got covered.
export const coveragePct = (metrics) =>
  metrics.revenueHoursScheduled ? metrics.revenueHoursCovered / metrics.revenueHoursScheduled : 0;

// Run Cut Fulfillment — how many of the scheduled duties actually got
// deployed, independent of the hours each one represents.
export const runCutFulfillmentPct = (metrics) =>
  metrics.dutiesScheduled ? metrics.dutiesDeployed / metrics.dutiesScheduled : 0;
