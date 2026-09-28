import XLSX from "xlsx";
import PDFDocument from "pdfkit";
import Division from "../models/Division.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import { divisionFilter } from "../middleware/access.js";
import { addDays, emptyMetrics, accumulate, coveragePct, runCutFulfillmentPct } from "../utils/weeklyMetrics.js";
import { actualRevenueFulfillment, combineActualRevenue } from "../utils/actualRevenueFulfillment.js";
import { pdfPageLeft, drawPdfTable } from "../utils/pdfTable.js";

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const round2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
// Percentages stay raw fractions (0-1) in the API response, matching every
// other controller in the app (homeSummaryController, trackerController) —
// the frontend formats them for display. Only the file exports below turn
// these into human-readable "84.6%" strings.
const roundFrac = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10000) / 10000);

// runCutFulfillmentPct/coveragePct default to 0 when nothing was scheduled
// at all (see weeklyMetrics.js) — fine for a live dashboard, but a "0%"
// caused by an empty period reads as a real (and misleading) prior-period
// comparison point here, so treat "nothing scheduled" as no data instead.
const fulfillmentOrNull = (metrics) => ({
  runCutFulfillmentPct: metrics.dutiesScheduled ? roundFrac(runCutFulfillmentPct(metrics)) : null,
  revenueHourFulfillmentPct: metrics.revenueHoursScheduled ? roundFrac(coveragePct(metrics)) : null,
});

const parseDivisionIds = (raw) => (raw ? String(raw).split(",").filter(Boolean) : null);

// A route closure is either an explicit RunCutDay suspension or a matching
// DailyIssueLog entry (Unperformed Duty/Route Closed) — the same two
// signals Deployment already tracks. Counted once per (route, date), not
// twice if both are present for the same day.
const CLOSURE_DISRUPTION_TYPES = ["Unperformed Duty", "Route Closed"];
const countClosures = (runCutDays, issues) => {
  const closedKeys = new Set();
  runCutDays.forEach((rcd) => {
    if (rcd.status === "suspended" && rcd.route) closedKeys.add(`${rcd.route._id}|${iso(rcd.date)}`);
  });
  issues.forEach((i) => {
    if (i.route && CLOSURE_DISRUPTION_TYPES.includes(i.disruptionType)) {
      closedKeys.add(`${i.route._id}|${iso(i.date)}`);
    }
  });
  return closedKeys.size;
};

// Groups the flat, cross-division RunCutDay list into per-bucket
// fulfillment numbers for the trend chart. Daily buckets stay readable up
// to 6 weeks; beyond that the chart would be too dense, so it switches to
// weekly buckets instead.
const buildTrend = (from, to, allRunCutDays) => {
  const spanDays = Math.round((to - from) / 86400000) + 1;
  const byWeek = spanDays > 42;

  const bucketKey = (date) => {
    if (!byWeek) return iso(date);
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return iso(d);
  };

  const buckets = new Map();
  const getBucket = (key) => {
    if (!buckets.has(key)) buckets.set(key, emptyMetrics());
    return buckets.get(key);
  };

  allRunCutDays.forEach((rcd) => {
    if (rcd.route?.type === "standby") return;
    accumulate(getBucket(bucketKey(rcd.date)), rcd);
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bucketStart, metrics]) => ({
      bucketStart,
      ...fulfillmentOrNull(metrics),
    }));
};

// The full cross-division, cross-section rollup for one date window —
// shared by the on-screen report and every export format.
export const computeEltOperationsReport = async (req, from, to, divisionIds) => {
  const filter = { ...divisionFilter(req.user), active: true };
  if (divisionIds?.length) {
    // Keep a requested subset inside the caller's division boundary. This
    // matters for explicitly assigned reporting users; a query string must
    // never be able to replace the access filter with an arbitrary ID list.
    const accessibleIds = req.user.role === "ELT"
      ? divisionIds
      : divisionIds.filter((divisionId) =>
        req.user.divisionAccess.some((allowedId) => String(allowedId) === String(divisionId))
      );
    filter._id = { $in: accessibleIds };
  }
  const divisions = await Division.find(filter).sort({ code: 1 });

  const allRunCutDays = [];
  const allIssues = [];

  const perDivision = await Promise.all(
    divisions.map(async (division) => {
      const [runCutDays, issues, runCuts, networkEntries] = await Promise.all([
        RunCutDay.find({ division: division._id, date: { $gte: from, $lte: to } }).populate("route", "type"),
        DailyIssueLog.find({ division: division._id, date: { $gte: from, $lte: to } }).populate("route", "code"),
        RunCut.find({ division: division._id }).populate("route", "code type"),
        NetworkKpiEntry.find({
          division: division._id,
          date: { $gte: iso(from), $lte: iso(to) },
          "metrics.reportedRevenueHours": { $ne: null },
        }).select("route metrics.reportedRevenueHours deployment.scheduledRevenueHours"),
      ]);

      allRunCutDays.push(...runCutDays);

      const metrics = emptyMetrics();
      runCutDays.forEach((rcd) => {
        if (rcd.route?.type === "standby") return;
        accumulate(metrics, rcd);
      });

      const unassignedRoutes = runCuts
        .filter((rc) => rc.status === "unassigned")
        .filter((rc) => rc.route && rc.route.type !== "standby")
        .map((rc) => ({ routeId: rc.route._id, routeCode: rc.route.code }));
      const plannedRevenueByRoute = new Map(
        runCuts
          .filter((rc) => rc.route && rc.route.type !== "standby" && Number.isFinite(rc.revenueHours))
          .map((rc) => [String(rc.route._id), rc.revenueHours])
      );
      const actualRevenue = actualRevenueFulfillment(networkEntries, plannedRevenueByRoute);
      const plannedFulfillment = fulfillmentOrNull(metrics);

      const divIssues = issues.map((i) => ({
        issueId: i._id,
        divisionId: division._id,
        divisionName: division.name,
        date: iso(i.date),
        routeCode: i.route?.code || null,
        disruptionType: i.disruptionType,
        notes: i.notes,
      }));

      const lateToFirst = issues.filter((i) => i.disruptionType === "Late to First").length;
      const lateDeploy = issues.filter((i) => i.disruptionType === "Late Deploy").length;

      allIssues.push(...divIssues);

      return {
        divisionId: division._id,
        code: division.code,
        name: division.name,
        ...plannedFulfillment,
        plannedRevenueHourFulfillmentPct: plannedFulfillment.revenueHourFulfillmentPct,
        ...actualRevenue,
        revenueHoursScheduled: round2(metrics.revenueHoursScheduled),
        revenueHoursCovered: round2(metrics.revenueHoursCovered),
        revenueHoursAtRisk: round2(metrics.revenueHoursScheduled - metrics.revenueHoursCovered),
        totalClosures: countClosures(runCutDays, issues),
        totalLateFirst: lateToFirst,
        totalLateDeploy: lateDeploy,
        unassignedRoutesCount: unassignedRoutes.length,
        unassignedRoutes,
        issueCount: divIssues.length,
      };
    })
  );

  const combinedMetrics = perDivision.reduce((acc, d) => {
    acc.revenueHoursScheduled += d.revenueHoursScheduled || 0;
    acc.revenueHoursCovered += d.revenueHoursCovered || 0;
    return acc;
  }, { revenueHoursScheduled: 0, revenueHoursCovered: 0 });

  const netMetrics = emptyMetrics();
  allRunCutDays.forEach((rcd) => {
    if (rcd.route?.type === "standby") return;
    accumulate(netMetrics, rcd);
  });

  const networkFulfillment = fulfillmentOrNull(netMetrics);
  const networkSummary = {
    ...networkFulfillment,
    plannedRevenueHourFulfillmentPct: networkFulfillment.revenueHourFulfillmentPct,
    ...combineActualRevenue(perDivision),
    revenueHoursAtRisk: round2(combinedMetrics.revenueHoursScheduled - combinedMetrics.revenueHoursCovered),
    totalClosures: perDivision.reduce((s, d) => s + d.totalClosures, 0),
    totalLateFirst: perDivision.reduce((s, d) => s + d.totalLateFirst, 0),
    totalLateDeploy: perDivision.reduce((s, d) => s + d.totalLateDeploy, 0),
    unassignedRoutesCount: perDivision.reduce((s, d) => s + d.unassignedRoutesCount, 0),
  };

  return {
    from: iso(from),
    to: iso(to),
    networkSummary,
    divisions: perDivision,
    trend: buildTrend(from, to, allRunCutDays),
    issues: allIssues.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
};

const resolveRange = (query) => {
  const { from, to, divisions: divisionsParam } = query;
  if (!from || !to) return { error: "from and to are required" };
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const spanDays = Math.round((toDate - fromDate) / 86400000) + 1;
  const priorTo = addDays(fromDate, -1);
  const priorFrom = addDays(priorTo, -(spanDays - 1));
  return { fromDate, toDate, priorFrom, priorTo, divisionIds: parseDivisionIds(divisionsParam) };
};

export const getEltReport = async (req, res) => {
  const { error, fromDate, toDate, priorFrom, priorTo, divisionIds } = resolveRange(req.query);
  if (error) return res.status(400).json({ message: error });

  const comparePrior = req.query.comparePrior !== "0";

  const [current, prior] = await Promise.all([
    computeEltOperationsReport(req, fromDate, toDate, divisionIds),
    comparePrior ? computeEltOperationsReport(req, priorFrom, priorTo, divisionIds) : Promise.resolve(null),
  ]);

  res.json({
    ...current,
    priorFrom: prior ? iso(priorFrom) : null,
    priorTo: prior ? iso(priorTo) : null,
    priorNetworkSummary: prior?.networkSummary || null,
  });
};

const REPORT_HEADERS = {
  summary: ["Metric", "Value"],
  divisions: [
    "Division",
    "Run Cut Fulfillment %",
    "Planned Revenue Hour Fulfillment %",
    "Actual Revenue Hour Fulfillment %",
    "Revenue Hours At Risk",
    "Closures",
    "Late to First",
    "Late Deploy",
    "Unassigned Routes",
  ],
  issues: ["Division", "Date", "Route", "Disruption", "Notes"],
};

const escapeCsv = (value) => {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

// Exports are the one place these fractions become human-readable "84.6%"
// strings — the JSON API keeps raw 0-1 fractions for the frontend to format.
const fmtPct = (n) => (n == null ? "" : `${Math.round(n * 1000) / 10}%`);

const toRows = (report) => ({
  summary: [
    ["Date range", `${report.from} to ${report.to}`],
    ["Run Cut Fulfillment %", fmtPct(report.networkSummary.runCutFulfillmentPct)],
    ["Planned Revenue Hour Fulfillment %", fmtPct(report.networkSummary.plannedRevenueHourFulfillmentPct)],
    ["Actual Revenue Hour Fulfillment %", fmtPct(report.networkSummary.actualRevenueHourFulfillmentPct)],
    ["Actual Revenue Hours", report.networkSummary.actualRevenueHours],
    ["Comparable Planned Revenue Hours", report.networkSummary.actualRevenueHoursPlanned],
    ["Revenue Hours At Risk", report.networkSummary.revenueHoursAtRisk],
    ["Total Closures", report.networkSummary.totalClosures],
    ["Total Late to First", report.networkSummary.totalLateFirst],
    ["Total Late Deploy", report.networkSummary.totalLateDeploy],
    ["Unassigned Routes", report.networkSummary.unassignedRoutesCount],
  ],
  divisions: report.divisions.map((d) => [
    d.name,
    fmtPct(d.runCutFulfillmentPct),
    fmtPct(d.plannedRevenueHourFulfillmentPct),
    fmtPct(d.actualRevenueHourFulfillmentPct),
    d.revenueHoursAtRisk,
    d.totalClosures,
    d.totalLateFirst,
    d.totalLateDeploy,
    d.unassignedRoutesCount,
  ]),
  issues: report.issues.map((i) => [i.divisionName, i.date, i.routeCode || "", i.disruptionType, i.notes || ""]),
});

export const exportEltReport = async (req, res) => {
  const { error, fromDate, toDate, divisionIds } = resolveRange(req.query);
  if (error) return res.status(400).json({ message: error });

  const report = await computeEltOperationsReport(req, fromDate, toDate, divisionIds);
  const rows = toRows(report);
  const format = ["xlsx", "csv", "pdf"].includes(req.query.format) ? req.query.format : "xlsx";
  const filenameBase = `ELT-Report-${report.from}-to-${report.to}`;

  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([REPORT_HEADERS.summary, ...rows.summary]), "Summary");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([REPORT_HEADERS.divisions, ...rows.divisions]),
      "Per-Division"
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([REPORT_HEADERS.issues, ...rows.issues]), "Issues");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buffer);
  }

  if (format === "csv") {
    const sections = [
      ["SUMMARY"],
      REPORT_HEADERS.summary,
      ...rows.summary,
      [],
      ["PER-DIVISION"],
      REPORT_HEADERS.divisions,
      ...rows.divisions,
      [],
      ["ISSUES"],
      REPORT_HEADERS.issues,
      ...rows.issues,
    ];
    const csv = sections.map((r) => r.map(escapeCsv).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
    return res.send(csv);
  }

  // pdf — a condensed version of the same data (the full column set is in
  // the xlsx/csv exports); columns are sized to fit letter-width with a
  // 40pt margin (532pt usable) and row height is measured per-row so
  // wrapped header/cell text never overlaps the next row.
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
  const doc = new PDFDocument({ margin: 40, size: "letter" });
  doc.pipe(res);

  doc.fontSize(18).text("ELT Operations Report", { align: "left" });
  doc.fontSize(11).fillColor("#666").text(`${report.from} to ${report.to}`);
  doc.moveDown();

  const pageLeft = pdfPageLeft(doc);
  const drawTable = (title, headers, tableRows, colWidths) => drawPdfTable(doc, pageLeft, title, headers, tableRows, colWidths);

  drawTable("Executive Summary", REPORT_HEADERS.summary, rows.summary, [200, 200]);

  const pdfDivisionHeaders = ["Division", "Run Cut", "Planned Rev.", "Actual Rev.", "Hrs At Risk", "Closures", "Late 1st", "Late Dep", "Unassigned"];
  const pdfDivisionRows = report.divisions.map((d) => [
    d.name,
    fmtPct(d.runCutFulfillmentPct),
    fmtPct(d.plannedRevenueHourFulfillmentPct),
    fmtPct(d.actualRevenueHourFulfillmentPct),
    d.revenueHoursAtRisk,
    d.totalClosures,
    d.totalLateFirst,
    d.totalLateDeploy,
    d.unassignedRoutesCount,
  ]);
  drawTable("Per-Division", pdfDivisionHeaders, pdfDivisionRows, [112, 56, 58, 58, 55, 45, 48, 48, 52]);

  doc.addPage();
  drawTable("Issues", REPORT_HEADERS.issues, rows.issues, [110, 60, 60, 100, 190]);

  doc.end();
};
