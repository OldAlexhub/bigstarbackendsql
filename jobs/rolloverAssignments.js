import RunCut from "../models/RunCut.js";
import Division from "../models/Division.js";
import { recomputeRunCutHours } from "../utils/recomputeRunCutHours.js";
import { projectAssignment } from "../utils/projectAssignment.js";
import { runInTransaction } from "../utils/transaction.js";

// Keeps RunCutDay coverage rolling forward automatically from each route's
// live RunCut assignment, so a route someone set up last month keeps
// generating today's/tomorrow's schedule without anyone touching it. Also
// re-snapshots each RunCut's own service/revenue hours against whatever
// threshold is effective today, so a division's scheduled future break
// minutes/revenue ratio change (server/utils/thresholds.js) goes live on
// its start date automatically, without anyone re-saving every run cut by
// hand once that date arrives.
export const rolloverAssignments = async () => {
  const runCuts = await RunCut.find({});
  for (const runCut of runCuts) {
    await runInTransaction(async () => {
      const divisionDoc = await Division.findById(runCut.division);
      if (divisionDoc && divisionDoc.active !== false) {
        await recomputeRunCutHours(runCut, divisionDoc, null);
      } else {
        await projectAssignment(runCut, null);
      }
    });
  }
};

export const scheduleAssignmentRollover = () => {
  rolloverAssignments().catch(() => console.error("Assignment rollover failed."));
  return setInterval(() => {
    rolloverAssignments().catch(() => console.error("Assignment rollover failed."));
  }, 24 * 60 * 60 * 1000);
};
