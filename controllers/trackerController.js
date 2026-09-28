import RunCutDay from "../models/RunCutDay.js";
import Division from "../models/Division.js";
import WeeklyDivisionSummary from "../models/WeeklyDivisionSummary.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { DAYS_OF_WEEK } from "../utils/hours.js";
import {
  addDays,
  startOfWeek,
  emptyMetrics,
  accumulate,
  coveragePct,
  runCutFulfillmentPct,
} from "../utils/weeklyMetrics.js";

// One card per division, for Master Run Cuts' "All Divisions" view — same
// fulfillment formulas as getTracker, looped across every division the user
// can access instead of requiring one division param.
export const getTrackerAllDivisions = async (req, res) => {
  const { weekStart: weekStartParam } = req.query;
  const weekStart = startOfWeek(weekStartParam);
  const weekEnd = addDays(weekStart, 6);

  const divisions = await Division.find({ ...divisionFilter(req.user), active: true }).sort({ code: 1 });

  const results = await Promise.all(
    divisions.map(async (division) => {
      const runCutDays = await RunCutDay.find({
        division: division._id,
        date: { $gte: weekStart, $lte: weekEnd },
      }).populate("route", "type");

      const total = emptyMetrics();
      runCutDays.forEach((runCutDay) => {
        if (runCutDay.route?.type === "standby") return;
        accumulate(total, runCutDay);
      });

      return {
        divisionId: division._id,
        code: division.code,
        name: division.name,
        runCutFulfillmentPct: runCutFulfillmentPct(total),
        revenueHourFulfillmentPct: coveragePct(total),
      };
    })
  );

  res.json({ weekStart, weekEnd, divisions: results });
};

export const getTracker = async (req, res) => {
  const { division, weekStart: weekStartParam } = req.query;
  if (!division) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const divisionDoc = await Division.findById(division);
  if (!divisionDoc) return res.status(404).json({ message: "Division not found" });

  const weekStart = startOfWeek(weekStartParam);
  const weekEnd = addDays(weekStart, 6);
  const isPastWeek = weekEnd < startOfWeek(new Date());

  if (isPastWeek) {
    const summary = await WeeklyDivisionSummary.findOne({ division, weekStart, finalized: true });
    if (summary) {
      return res.json({ weekStart, weekEnd, source: "summary", summary });
    }
  }

  const runCutDays = await RunCutDay.find({
    division,
    date: { $gte: weekStart, $lte: weekEnd },
  }).populate("route", "type");

  const byDay = {};
  DAYS_OF_WEEK.forEach((label, i) => {
    byDay[label] = { ...emptyMetrics(), date: addDays(weekStart, i) };
  });

  for (const runCutDay of runCutDays) {
    const label = DAYS_OF_WEEK[new Date(runCutDay.date).getUTCDay()];
    if (runCutDay.route?.type === "standby") {
      if (runCutDay.status === "active") {
        byDay[label].standbyAvailable += 1;
        if (runCutDay.deployed) byDay[label].standbyDeployed += 1;
      }
      continue;
    }
    accumulate(byDay[label], runCutDay);
  }

  const total = Object.values(byDay).reduce((acc, bucket) => {
    Object.keys(acc).forEach((key) => {
      acc[key] += bucket[key];
    });
    return acc;
  }, emptyMetrics());

  res.json({
    weekStart,
    weekEnd,
    source: "live",
    days: byDay,
    total,
    coveragePct: coveragePct(total),
    runCutFulfillmentPct: runCutFulfillmentPct(total),
  });
};
