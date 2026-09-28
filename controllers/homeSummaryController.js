import Division from "../models/Division.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import { divisionFilter } from "../middleware/access.js";
import {
  startOfWeek,
  addDays,
  emptyMetrics,
  accumulate,
  coveragePct,
  runCutFulfillmentPct,
} from "../utils/weeklyMetrics.js";
import { todayInTimezone } from "../utils/timezone.js";

const emptyTotals = () => ({
  routesSuspendedToday: 0,
  openIssuesToday: 0,
  unassignedRoutes: 0,
});

export const getHomeSummary = async (req, res) => {
  const hasOperationsAccess =
    req.user.role === "ELT" ||
    req.user.sections.includes("master_run_cuts") ||
    req.user.sections.includes("deployment") ||
    req.user.sections.includes("network_success");

  if (!hasOperationsAccess) {
    return res.json({ divisions: [], totals: emptyTotals(), hasOperationsAccess });
  }

  const divisions = await Division.find({ ...divisionFilter(req.user), active: true }).sort({ code: 1 });

  const perDivision = await Promise.all(
    divisions.map(async (division) => {
      // Each division's "today"/"this week" is computed in its own
      // timezone — two divisions can legitimately disagree on what day it
      // is right now.
      const today = todayInTimezone(division.timezone);
      const weekStart = startOfWeek(today);
      const weekEnd = addDays(weekStart, 6);

      const metrics = emptyMetrics();

      const [suspendedDays, issues, unassignedRunCuts, weekRunCutDays] = await Promise.all([
        RunCutDay.find({ division: division._id, date: today, status: "suspended" }).populate("route", "code"),
        DailyIssueLog.find({ division: division._id, date: today }).populate("route", "code"),
        // "Unassigned" is a Master Run Cuts (RunCut) concept — the persistent
        // assignment state — not a Deployment day-specific override, so this
        // reads from RunCut rather than today's RunCutDay projection.
        RunCut.find({ division: division._id, status: "unassigned" }).populate("route", "code type"),
        RunCutDay.find({ division: division._id, date: { $gte: weekStart, $lte: weekEnd } }).populate(
          "route",
          "type"
        ),
      ]);

      const suspendedRoutes = suspendedDays
        .filter((d) => d.route)
        .map((d) => ({ routeId: d.route._id, routeCode: d.route.code }));
      const openIssues = issues.map((i) => ({
        issueId: i._id,
        routeCode: i.route?.code || null,
        disruptionType: i.disruptionType,
        notes: i.notes,
      }));
      const unassignedRoutes = unassignedRunCuts
        .filter((rc) => rc.route && rc.route.type !== "standby")
        .map((rc) => ({ routeId: rc.route._id, routeCode: rc.route.code }));

      // This week's fulfillment, same computation the Master Run Cuts
      // Tracker uses — standby duties are excluded there too.
      weekRunCutDays.forEach((runCutDay) => {
        if (runCutDay.route?.type === "standby") return;
        accumulate(metrics, runCutDay);
      });

      return {
        divisionId: division._id,
        code: division.code,
        name: division.name,
        suspendedRoutes,
        openIssues,
        unassignedRoutes,
        metrics,
      };
    })
  );

  const results = perDivision.map(({ metrics, ...rest }) => ({
    ...rest,
    routesSuspendedToday: rest.suspendedRoutes.length,
    openIssuesToday: rest.openIssues.length,
    unassignedRoutesCount: rest.unassignedRoutes.length,
    runCutFulfillmentPct: runCutFulfillmentPct(metrics),
    revenueHourFulfillmentPct: coveragePct(metrics),
  }));

  const combinedMetrics = perDivision.reduce((acc, d) => {
    Object.keys(acc).forEach((key) => {
      acc[key] += d.metrics[key];
    });
    return acc;
  }, emptyMetrics());

  const totals = results.reduce(
    (acc, r) => ({
      routesSuspendedToday: acc.routesSuspendedToday + r.routesSuspendedToday,
      openIssuesToday: acc.openIssuesToday + r.openIssuesToday,
      unassignedRoutes: acc.unassignedRoutes + r.unassignedRoutesCount,
    }),
    emptyTotals()
  );
  totals.runCutFulfillmentPct = runCutFulfillmentPct(combinedMetrics);
  totals.revenueHourFulfillmentPct = coveragePct(combinedMetrics);

  res.json({ divisions: results, totals, hasOperationsAccess });
};
