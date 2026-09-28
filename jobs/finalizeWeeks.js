import Division from "../models/Division.js";
import RunCutDay from "../models/RunCutDay.js";
import WeeklyDivisionSummary from "../models/WeeklyDivisionSummary.js";
import { addDays, startOfWeek, emptyMetrics, accumulate, coveragePct } from "../utils/weeklyMetrics.js";
import { todayInTimezone } from "../utils/timezone.js";

const computeWeekSummary = async (divisionId, weekStart) => {
  const weekEnd = addDays(weekStart, 6);
  const runCutDays = await RunCutDay.find({
    division: divisionId,
    date: { $gte: weekStart, $lte: weekEnd },
  }).populate("route", "type");

  let standbyAvailable = 0;
  let standbyDeployed = 0;
  const operationalDays = runCutDays.filter((rcd) => {
    if (rcd.route?.type !== "standby") return true;
    if (rcd.status === "active") {
      standbyAvailable += 1;
      if (rcd.deployed) standbyDeployed += 1;
    }
    return false;
  });

  const metrics = operationalDays.reduce(accumulate, emptyMetrics());
  return { ...metrics, standbyAvailable, standbyDeployed, coveragePct: coveragePct(metrics) };
};

export const finalizePastWeeks = async () => {
  const divisions = await Division.find({ active: true });

  for (const division of divisions) {
    // "This week" (and therefore which past weeks are eligible to
    // finalize) is division-local, same as everywhere else "today" gets
    // computed.
    const currentWeekStart = startOfWeek(todayInTimezone(division.timezone));
    const earliest = await RunCutDay.findOne({ division: division._id }).sort({ date: 1 });
    if (!earliest) continue;

    let cursor = startOfWeek(earliest.date);
    while (cursor < currentWeekStart) {
      const alreadyFinalized = await WeeklyDivisionSummary.findOne({
        division: division._id,
        weekStart: cursor,
        finalized: true,
      });

      if (!alreadyFinalized) {
        const summary = await computeWeekSummary(division._id, cursor);
        await WeeklyDivisionSummary.findOneAndUpdate(
          { division: division._id, weekStart: new Date(cursor) },
          { ...summary, finalized: true },
          { upsert: true }
        );
      }

      cursor = addDays(cursor, 7);
    }
  }
};

export const scheduleWeeklyFinalization = () => {
  finalizePastWeeks().catch(() => console.error("Week finalization failed."));
  return setInterval(() => {
    finalizePastWeeks().catch(() => console.error("Week finalization failed."));
  }, 24 * 60 * 60 * 1000);
};
