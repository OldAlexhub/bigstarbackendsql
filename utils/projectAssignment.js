import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import Division from "../models/Division.js";
import { DAYS_OF_WEEK, computeHours } from "./hours.js";
import { loadThresholdHistory, resolveThresholdsFromHistory } from "./thresholds.js";
import { syncAutoIssuesBulk } from "./autoIssueSync.js";
import { todayInTimezone } from "./timezone.js";
import { restoreCoverageOwnedByStandbyDays } from "./standbyCoveragePersistence.js";

// Generate through today + 7 so the maximum OSR planning window always has
// a daily schedule. A lower configured limit simply exposes fewer dates.
export const PROJECTION_HORIZON_DAYS = 7;

const dayOfWeekFor = (date) => DAYS_OF_WEEK[new Date(date).getUTCDay()];

// Projects a live RunCut (the single, always-current assignment for a route)
// forward into dated RunCutDay records — the shape Tracker/KPI/Issue Log
// already read. Runs from today through the horizon so a change is visible
// everywhere immediately; past dates are never touched, so real history
// (what actually happened on a day that's already gone by) stays intact.
//
// Status/clientNotes/disruption can be overridden per date by Deployment
// (see runCutDaysController.updateRunCutDayException) — those fields, and
// serviceHours/revenueHours since they depend on status ("off" days have
// none), are left alone on an overridden date instead of being replaced by
// the persistent assignment's value. A date only ever carries its own
// override, so the next scheduled day (a different, never-overridden
// document) naturally reverts to the plan — no explicit "clear" needed.
export const projectAssignment = async (runCut, userId, { horizonDays = PROJECTION_HORIZON_DAYS } = {}) => {
  const divisionDoc = await Division.findById(runCut.division);
  if (!divisionDoc || divisionDoc.active === false) return;
  const thresholdHistory = await loadThresholdHistory(divisionDoc._id);
  const thresholdsForDate = (date) =>
    resolveThresholdsFromHistory(thresholdHistory, date, {
      breakMinutes: divisionDoc.thresholds.breakMinutes,
      revenueRatio: divisionDoc.thresholds.revenueRatio,
    });
  const start = todayInTimezone(divisionDoc?.timezone);

  const dates = [];
  for (let i = 0; i <= horizonDays; i += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + i);
    dates.push(date);
  }

  const keepDates = dates.filter((d) => runCut.daysOfWeek.includes(dayOfWeekFor(d)));
  const dropDates = dates.filter((d) => !runCut.daysOfWeek.includes(dayOfWeekFor(d)));

  if (dropDates.length) {
    const removable = await RunCutDay.find({
      division: runCut.division,
      route: runCut.route,
      date: { $in: dropDates },
      isExtra: { $ne: true },
    }).select("_id");
    const removableIds = removable.map((r) => r._id);
    if (removableIds.length) {
      await DailyIssueLog.deleteMany({ runCutDay: { $in: removableIds }, autoSyncTag: { $ne: null } });
      await restoreCoverageOwnedByStandbyDays(removableIds, userId);
      await RunCutDay.deleteMany({ _id: { $in: removableIds } });
    }
  }

  if (!keepDates.length) return;

  await RunCutDay.bulkWrite(
    keepDates.map((date) => {
      const { serviceHours, revenueHours } = computeHours({
        startTime: runCut.startTime,
        endTime: runCut.endTime,
        status: runCut.status,
        ...thresholdsForDate(date),
      });
      return {
        updateOne: {
          filter: { division: runCut.division, route: runCut.route, date },
          update: [
            {
              $set: {
                division: { $ifNull: ["$division", runCut.division] },
                route: { $ifNull: ["$route", runCut.route] },
                date: { $ifNull: ["$date", date] },
                operator: { $cond: ["$overrides.operator", "$operator", runCut.operator] },
                vehicle: { $cond: ["$overrides.vehicle", "$vehicle", runCut.vehicle] },
                pulloutAddress: {
                  $cond: ["$overrides.pulloutAddress", "$pulloutAddress", runCut.pulloutAddress],
                },
                startTime: { $cond: ["$overrides.startTime", "$startTime", runCut.startTime] },
                endTime: { $cond: ["$overrides.endTime", "$endTime", runCut.endTime] },
                updatedBy: userId,
                status: { $cond: ["$overrides.status", "$status", runCut.status] },
                serviceHours: {
                  $cond: [
                    { $or: ["$overrides.status", "$overrides.startTime", "$overrides.endTime"] },
                    "$serviceHours",
                    serviceHours,
                  ],
                },
                revenueHours: {
                  $cond: [
                    { $or: ["$overrides.status", "$overrides.startTime", "$overrides.endTime"] },
                    "$revenueHours",
                    revenueHours,
                  ],
                },
                clientNotes: { $cond: ["$overrides.clientNotes", "$clientNotes", runCut.clientNotes] },
                disruptionType: { $cond: ["$overrides.disruption", "$disruptionType", runCut.disruptionType] },
                disruptionNotes: { $cond: ["$overrides.disruption", "$disruptionNotes", runCut.disruptionNotes] },
              },
            },
          ],
          upsert: true,
        },
      };
    })
  );

  const runCutDays = await RunCutDay.find({
    division: runCut.division,
    route: runCut.route,
    date: { $in: keepDates },
  });
  await syncAutoIssuesBulk(runCutDays, userId);
};
