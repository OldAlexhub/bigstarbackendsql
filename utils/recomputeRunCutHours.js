import RunCut from "../models/RunCut.js";
import { computeHours } from "./hours.js";
import { getEffectiveThresholds } from "./thresholds.js";
import { todayInTimezone } from "./timezone.js";
import { projectAssignment } from "./projectAssignment.js";
import { runInTransaction } from "./transaction.js";

// Re-snapshots a single RunCut's own service/revenue hours against
// whatever threshold is effective today, then re-projects it onto the
// rolling RunCutDay window so both the standing plan and the day-by-day
// schedule pick up a division's break minutes / revenue ratio the moment
// it takes effect — without touching any day that's already passed.
export const recomputeRunCutHours = async (runCut, divisionDoc, userId) => {
  const thresholds = await getEffectiveThresholds(divisionDoc, todayInTimezone(divisionDoc.timezone));
  const { serviceHours, revenueHours } = computeHours({
    startTime: runCut.startTime,
    endTime: runCut.endTime,
    status: runCut.status,
    ...thresholds,
  });
  if (runCut.serviceHours !== serviceHours || runCut.revenueHours !== revenueHours) {
    runCut.serviceHours = serviceHours;
    runCut.revenueHours = revenueHours;
    runCut.updatedBy = userId;
    await runCut.save();
  }
  await projectAssignment(runCut, userId);
};

// Used right after a division's break minutes / revenue ratio changes, so
// every one of its run cuts (and their projected days) reflects the new
// value immediately instead of waiting for the next daily rollover.
export const recomputeDivisionRunCutHours = async (divisionDoc, userId) => {
  const runCuts = await RunCut.find({ division: divisionDoc._id });
  for (const runCut of runCuts) {
    await runInTransaction(() => recomputeRunCutHours(runCut, divisionDoc, userId));
  }
};
