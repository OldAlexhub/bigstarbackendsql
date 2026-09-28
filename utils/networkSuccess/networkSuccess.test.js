import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { parseVisionReport } from "./parseVisionReport.js";
import { parseEcolaneReports } from "./parseEcolaneReports.js";
import { parseSpareReport } from "./parseSpareReport.js";
import { parseRideCoReports } from "./parseRideCoReports.js";
import { aggregateResolvedRows } from "./aggregateRows.js";
import { normalizeRouteCode, resolveRoute } from "./routeMatching.js";
import { enrichGroup, resolvePerformanceRunCut, withPerformanceAssignment } from "../../controllers/networkSuccessSubmissionsController.js";
import { planReplacement } from "./replacementPlan.js";
import { buildPerformanceAnalysis } from "./performanceAnalysis.js";

const workbook = (rows, name = "Report") => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};

const workbookWithSheets = (sheets) => {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};

test("Vision parser reads source metrics, percentages, dates, and zero-trip rows", () => {
  const header = Array(48).fill(null);
  header[1] = "Date";
  header[3] = "Run/Route";
  header[6] = "Total Prov";
  header[16] = "Trips/ SvcHr";
  header[30] = "OTP %";
  header[33] = "Service";
  header[41] = "Service";
  header[42] = "Reven";
  const positive = Array(48).fill(null);
  positive[1] = "09/08/2026";
  positive[3] = "1029B";
  positive[6] = 12;
  positive[16] = 1.2;
  positive[30] = "91.7%";
  positive[41] = 10;
  positive[42] = 9.5;
  const zero = Array(48).fill(null);
  zero[3] = "1037A";
  zero[6] = 0;
  zero[16] = 0;
  zero[41] = 0;
  zero[42] = 0;
  const parsed = parseVisionReport(workbook([["Cost Center: LYNX Id: 661"], header, positive, zero]));

  assert.equal(parsed.costCenter, "LYNX");
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].date, "2026-09-08");
  assert.equal(parsed.rows[0].otpPct, 0.917);
  assert.equal(parsed.rows[0].reportedServiceHours, 10);
  assert.equal(parsed.rows[0].reportedRevenueHours, 9.5);
  assert.equal(parsed.rows[0].sourceFields.reportedRevenueHours, "Vision Revenue Hours");
  assert.equal(parsed.rows[1].zeroTrips, true);
  assert.equal(parsed.rows[1].reportedRevenueHours, 0);
  assert.equal(parsed.rows[1].otpPct, null);
});

test("Vision parser keeps older reports usable when Revenue Hours is absent", () => {
  const header = Array(48).fill(null);
  header[1] = "Date";
  header[3] = "Run/Route";
  header[6] = "Total Prov";
  header[16] = "Trips/ SvcHr";
  header[30] = "OTP %";
  header[41] = "Service";
  const row = Array(48).fill(null);
  row[1] = "09/08/2026";
  row[3] = "1021";
  row[6] = 13;
  row[16] = 1.26;
  row[30] = "100%";
  row[41] = 10.3;

  const parsed = parseVisionReport(workbook([header, row]));

  assert.equal(parsed.rows[0].reportedRevenueHours, null);
  assert.match(parsed.warnings.join(" "), /Actual Revenue Hour Fulfillment will be unavailable/);
});

test("Spare parser reads duty performance metrics, dates, and zero-trip rows from a workbook grid", () => {
  const header = [
    "duty_report__duty_identifier",
    "duty_report__start_requested_time_day",
    "request__completed_count",
    "duty_report__total_revenue_hours_sum",
    "duty_report__total_scheduled_hours_sum",
    "request__relevant_otp_rate",
  ];
  const positive = ["500B", "2026-08-01 00:00:00", 11, 8.418611111111112, 9, 100];
  const zero = ["504", "2026-08-03 00:00:00", 0, 0, 0, 0];
  const parsed = parseSpareReport(workbook([header, positive, zero]));

  assert.equal(parsed.costCenter, null);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].date, "2026-08-01");
  assert.equal(parsed.rows[0].sourceRoute, "500B");
  assert.equal(parsed.rows[0].completedTrips, 11);
  assert.equal(parsed.rows[0].reportedRevenueHours, 8.418611111111112);
  assert.equal(parsed.rows[0].reportedServiceHours, 9);
  assert.equal(parsed.rows[0].otpPct, 1);
  assert.equal(parsed.rows[0].tpsh, 1.22);
  assert.equal(parsed.rows[1].zeroTrips, true);
  assert.equal(parsed.rows[1].otpPct, 0);
  assert.equal(parsed.rows[1].tpsh, null);
});

test("Spare parser reads a real CSV buffer directly, not just a converted workbook", () => {
  const csv = [
    "duty_report__duty_identifier,duty_report__start_requested_time_day,request__completed_count,duty_report__total_revenue_hours_sum,duty_report__total_scheduled_hours_sum,request__relevant_otp_rate",
    "510B,2026-08-02 00:00:00,8,8.363611111111112,10,100",
    "511A,2026-08-03 00:00:00,11,7.437222222222222,9,90.9090909090909",
  ].join("\n");

  const parsed = parseSpareReport(Buffer.from(csv, "utf8"));

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].sourceRoute, "510B");
  assert.equal(parsed.rows[0].date, "2026-08-02");
  assert.equal(parsed.rows[0].completedTrips, 8);
  assert.equal(parsed.rows[0].tpsh, 0.8);
  assert.equal(parsed.rows[1].tpsh, 1.22);
  assert.ok(Math.abs(parsed.rows[1].otpPct - 0.909090909090909) < 1e-9);
});

test("RideCo parser joins shift/operator rows and derives TPSH from completed rides and Total Online Hours", () => {
  const hours = workbook([
    ["Program", "Date", "Driver", "Full Name", "Shift", "Total Online Hours", "Vehicle Revenue Hours"],
    ["MARTA Mobility", "2026-08-01", "Operator One", "Operator One", "3500", 10, 8.5],
    ["", "", "Operator Two", "Operator Two", "3501", 5, 4.25],
  ], "9.0 Shift Hours Mileage Report");
  const otp = workbookWithSheets({
    Summary: [["Summary"]],
    "By Shifts": [
      ["Provider", "Agenda Day", "Shift Label", "Pickup OTP (%)", "Dropoff OTP (%)", "PVH", "Completed Rides", "Driver Name"],
      ["MARTA Mobility - Big Star", "2026-08-01", "3500", 0.75, 1, 99, 8, "Operator One"],
      ["", "", "9999", 1, 1, 99, 7, ""],
    ],
  });

  const parsed = parseRideCoReports(hours, otp);

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].date, "2026-08-01");
  assert.equal(parsed.rows[0].sourceRoute, "3500");
  assert.equal(parsed.rows[0].sourceOperator, "Operator One");
  assert.equal(parsed.rows[0].completedTrips, 8);
  assert.equal(parsed.rows[0].reportedServiceHours, 10);
  assert.equal(parsed.rows[0].reportedRevenueHours, 8.5);
  assert.equal(parsed.rows[0].tpsh, 0.8);
  assert.equal(parsed.rows[0].pickupOtpPct, 0.75);
  assert.equal(parsed.rows[0].dropoffOtpPct, 1);
  assert.equal(parsed.rows[0].otpPct, 0.875);
  assert.match(parsed.rows[0].sourceFields.tpsh, /Total Online Hours/);
  assert.equal(parsed.rows[1].tpsh, null);
  assert.match(parsed.warnings.join(" "), /did not match a Shift Hours Mileage row/);
  assert.match(parsed.warnings.join(" "), /TPSH is unavailable/);
});

test("Ecolane parser handles repeated headers and blocks an incomplete whole date", () => {
  const header = [null, "Run", "Trips", null, null, null, null, "Source", null, null, "Service", null, null, null, null, "Revenue"];
  const child = [null, null, "Comp"];
  const daily = workbook([
    [null, "Date range: 09/01/2026 - 09/02/2026"],
    header,
    child,
    [null, "09/01/2026"],
    [null, "BST1101, Operator One", 4, null, null, null, null, "Est", null, null, null, null, null, null, null, 2],
    header,
    child,
    [null, "09/02/2026"],
    [null, "BST1102-B, Missing Driver", 0, null, null, null, null, "Est", null, null, null, null, null, null, null, 0],
  ]);
  const performance = workbook([
    [null, "Date range: 09/01/2026 - 09/02/2026"],
    [null, "Driver", null, null, "Rides per Hour\nEst / Act", null, null, "OTP (Trips)"],
    [null, "Operator One", null, null, 1.8, "/", 2, "95 %"],
  ]);
  const parsed = parseEcolaneReports(daily, performance);

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].tpsh, 2);
  assert.equal(parsed.rows[0].otpPct, 0.95);
  assert.equal(parsed.rows[1].driverPerformanceMatched, false);
  assert.deepEqual(parsed.blockedDates.map((item) => item.date), ["2026-09-02"]);
  assert.match(parsed.warnings.join(" "), /repeated/i);
});

test("route matching uses exact, alias, and only safe unique letter differences", () => {
  const routes = [
    { _id: "1", code: "1029-B", type: "standard" },
    { _id: "2", code: "1037", type: "standard" },
    { _id: "3", code: "1101", type: "standard" },
  ];
  assert.equal(normalizeRouteCode(" bst 1029-b "), "1029B");
  assert.equal(normalizeRouteCode("3021(STBY)"), "3021");
  assert.equal(normalizeRouteCode("STBY-1"), "STBY1", "a standby prefix remains part of the route identity");
  assert.equal(resolveRoute("1029B", routes).method, "normalized_exact");
  assert.equal(
    resolveRoute("3021", [{ _id: "standby-3021", code: "3021(STBY)", type: "standby" }]).method,
    "normalized_exact",
    "a source shift matches its roster route when only the standby suffix differs"
  );
  assert.equal(
    resolveRoute("3021", [
      { _id: "standard-3021", code: "3021", type: "standard" },
      { _id: "standby-3021", code: "3021(STBY)", type: "standby" },
    ]).method,
    "ambiguous",
    "two roster routes with the same base code still require review"
  );
  assert.equal(resolveRoute("1037A", routes).method, "safe_letter_difference");
  assert.equal(resolveRoute("1038A", routes).route, null, "digit changes never auto-match");
  assert.equal(resolveRoute("1037B", [{ _id: "x", code: "1037A", type: "standard" }]).route, null, "letter substitutions never auto-match");
  assert.equal(
    resolveRoute("legacy", routes, [{ normalizedSourceRoute: "LEGACY", route: "3" }]).method,
    "confirmed_alias"
  );
  const ambiguous = resolveRoute("1101AB", [...routes, { _id: "4", code: "1101A", type: "standard" }]);
  assert.equal(ambiguous.method, "ambiguous");
});

test("component aggregation excludes zero-trip components from weighted metrics", () => {
  const rows = aggregateResolvedRows([
    { date: "2026-09-01", routeId: "r1", routeCode: "R1", sourceRoute: "R1", completedTrips: 10, reportedServiceHours: 5, reportedRevenueHours: null, otpPct: 0.8, tpsh: 2, zeroTrips: false },
    { date: "2026-09-01", routeId: "r1", routeCode: "R1", sourceRoute: "R1-A", completedTrips: 30, reportedServiceHours: 10, reportedRevenueHours: null, otpPct: 1, tpsh: 3, zeroTrips: false },
    { date: "2026-09-01", routeId: "r1", routeCode: "R1", sourceRoute: "R1-B", completedTrips: 0, reportedServiceHours: 0, reportedRevenueHours: null, otpPct: 0, tpsh: 99, zeroTrips: true },
  ])[0];
  assert.equal(rows.metrics.completedTrips, 40);
  assert.equal(rows.metrics.reportedServiceHours, 15);
  assert.equal(rows.metrics.otpPct, 0.95);
  assert.equal(rows.metrics.tpsh, 2.75);
  assert.equal(rows.zeroTrip.classification, "partially_closed");
  assert.equal(rows.components.length, 3);
});

test("enrichment keeps unknown late values null and reports active zero-trip conflicts", () => {
  const base = {
    date: "2026-09-01",
    routeId: "r1",
    routeCode: "R1",
    routeType: "standard",
    components: [{ sourceOperator: "Operator One" }],
    zeroTrip: { classification: "closed_cancelled", zeroComponentCount: 1 },
  };
  const missing = enrichGroup(base, { runDays: new Map(), issues: new Map(), operators: [] });
  assert.equal(missing.deployment.lateToFirst, null);
  assert.equal(missing.deployment.lateDeploy, null);
  assert.equal(missing.operationalOutcome, "Closed/cancelled — unverified");

  const key = "2026-09-01|r1";
  const conflict = enrichGroup(base, {
    runDays: new Map([[key, { _id: "day", status: "active", serviceHours: 8, revenueHours: 7, operator: null }]]),
    issues: new Map([[key, []]]),
    operators: [],
  });
  assert.equal(conflict.deployment.lateToFirst, 0);
  assert.equal(conflict.zeroTrip.deploymentConflict, true);
});

test("enrichment falls back to Master Run Cuts' standing service/revenue hours when there is no dated Deployment record", () => {
  const base = {
    date: "2026-09-01",
    routeId: "r1",
    routeCode: "R1",
    routeType: "standard",
    components: [{ sourceOperator: null }],
    zeroTrip: { classification: "operated", zeroComponentCount: 0 },
  };
  const withMasterRunCut = enrichGroup(base, {
    runDays: new Map(),
    issues: new Map(),
    operators: [],
    runCuts: new Map([["r1", { serviceHours: 12, revenueHours: 10, operator: null }]]),
  });
  assert.equal(withMasterRunCut.deployment.scheduledServiceHours, 12);
  assert.equal(withMasterRunCut.deployment.scheduledRevenueHours, 10);
  assert.equal(withMasterRunCut.deployment.provenance.scheduledHours, "master_run_cuts");
  assert.match(withMasterRunCut.deployment.warning, /Master Run Cuts standing value/);

  const withoutEither = enrichGroup(base, { runDays: new Map(), issues: new Map(), operators: [] });
  assert.equal(withoutEither.deployment.scheduledServiceHours, null);
  assert.equal(withoutEither.deployment.provenance.scheduledHours, "unavailable");
});

test("replacement planning is idempotent and identifies removed active records", () => {
  const first = planReplacement(["2026-09-01|r1"], ["2026-09-01|r1", "2026-09-01|r2"]);
  assert.deepEqual(first, {
    created: ["2026-09-01|r2"],
    updated: ["2026-09-01|r1"],
    removed: [],
  });
  const repeat = planReplacement(
    ["2026-09-01|r1", "2026-09-01|r2"],
    ["2026-09-01|r1", "2026-09-01|r2"]
  );
  assert.equal(repeat.created.length, 0);
  assert.equal(repeat.updated.length, 2);
  assert.equal(repeat.removed.length, 0);
  assert.deepEqual(planReplacement(["2026-09-01|r1", "2026-09-01|r2"], ["2026-09-01|r2"]).removed, ["2026-09-01|r1"]);
});

test("performance analysis weights KPIs by trips and keeps missing enrichment out of late totals", () => {
  const entries = [
    {
      _id: "1", date: "2026-09-01", source: "vision", route: { code: "R1" },
      metrics: { completedTrips: 10, reportedServiceHours: 5, reportedRevenueHours: null, otpPct: 0.8, tpsh: 2 },
      zeroTrip: { classification: "operated", deploymentConflict: false }, operationalOutcome: "Operated",
      deployment: { operatorName: "Operator One", providerName: "Provider A", lateToFirst: 1, lateDeploy: 0, warning: null, canonicalRoute: "R1" },
    },
    {
      _id: "2", date: "2026-09-02", source: "vision", route: { code: "R2" },
      metrics: { completedTrips: 30, reportedServiceHours: 10, reportedRevenueHours: null, otpPct: 1, tpsh: 3 },
      zeroTrip: { classification: "operated", deploymentConflict: false }, operationalOutcome: "Operated",
      deployment: { operatorName: "Operator Two", providerName: null, lateToFirst: null, lateDeploy: null, warning: "No dated Deployment record", canonicalRoute: "R2" },
    },
  ];
  const analysis = buildPerformanceAnalysis(entries);
  assert.equal(analysis.summary.otpPct, 0.95);
  assert.equal(analysis.summary.tpsh, 2.75);
  assert.equal(analysis.summary.lateToFirst, 1);
  assert.equal(analysis.summary.lateEventCoverage, 1);
  assert.equal(analysis.summary.missingOperator, 0);
  assert.equal(analysis.providers.length, 1);
  assert.equal(analysis.providers[0].provider, "Provider A");
  assert.match(analysis.insights.join(" "), /coverage is available for 1 of 2/i);
});

test("Performance prefers Master Run Cut assignments and preserves explicit NS overrides", () => {
  const entry = {
    _id: "entry-1",
    deployment: { operator: "old-op", operatorName: "Old Operator", provider: null, providerName: null },
  };
  const fromMaster = withPerformanceAssignment(entry, {
    operator: { _id: "master-op", name: "Master Operator", provider: { _id: "provider-1", name: "Provider One" } },
  });
  assert.deepEqual(fromMaster.performanceAssignment, {
    operator: "master-op",
    operatorName: "Master Operator",
    provider: "provider-1",
    providerName: "Provider One",
    source: "master_run_cuts",
  });

  const overridden = withPerformanceAssignment({
    ...entry,
    assignmentOverride: {
      operator: "override-op",
      operatorName: "Corrected Operator",
      provider: "provider-2",
      providerName: "Provider Two",
    },
  }, null);
  assert.equal(overridden.performanceAssignment.source, "manual_override");
  assert.equal(overridden.performanceAssignment.providerName, "Provider Two");
});

test("Performance safely recovers a Master Run Cut match from normalized route codes", () => {
  const runCuts = [
    { route: { _id: "current-route", code: "1029-B" }, operator: { name: "Matched Operator" } },
    { route: { _id: "other-route", code: "1037" }, operator: { name: "Other Operator" } },
  ];
  const entry = {
    route: { _id: "retired-route", code: "1029B" },
    deployment: { canonicalRoute: "1029-B" },
    sourceRouteCodes: ["BST 1029B"],
  };
  assert.equal(resolvePerformanceRunCut(entry, runCuts), runCuts[0]);
  assert.equal(resolvePerformanceRunCut({
    ...entry,
    route: { _id: "retired-route", code: "1038" },
    deployment: { canonicalRoute: "1038" },
    sourceRouteCodes: ["1038A"],
  }, runCuts), null);
});

test("missing providers are optional and do not create setup or attention work", () => {
  const base = {
    source: "vision",
    route: { _id: "route-1", code: "R1" },
    metrics: { completedTrips: 10, otpPct: 0.95, tpsh: 2 },
    zeroTrip: { classification: "operated", deploymentConflict: false },
    operationalOutcome: "Operated",
    deployment: { runCutDay: "day-1", lateToFirst: 0, lateDeploy: 0, canonicalRoute: "R1" },
    performanceAssignment: { operator: "operator-1", operatorName: "Operator One", provider: null, providerName: null, source: "master_run_cuts" },
  };
  const analysis = buildPerformanceAnalysis([
    { ...base, _id: "entry-1", date: "2026-09-01" },
    { ...base, _id: "entry-2", date: "2026-09-02" },
  ]);
  assert.equal(analysis.assignmentGaps.length, 0);
  assert.equal(analysis.attention.length, 0);
  assert.equal(analysis.providers.length, 0);
  assert.equal(analysis.hasProviderData, false);
});
