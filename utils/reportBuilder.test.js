import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReportDataset,
  normalizeReportBuilderConfig,
  rawNetworkRowsFromEntries,
} from "./reportBuilder.js";

const report = {
  divisions: [
    {
      divisionId: "division-1",
      code: "D1",
      name: "North Division",
      runCutFulfillmentPct: 0.94,
      actualRevenueHourFulfillmentPct: 0.91,
      revenueHoursAtRisk: 12.5,
      totalClosures: 2,
      totalLateFirst: 1,
      totalLateDeploy: 0,
      unassignedRoutesCount: 3,
      issueCount: 4,
    },
    {
      divisionId: "division-2",
      code: "D2",
      name: "South Division",
      runCutFulfillmentPct: 1,
      actualRevenueHourFulfillmentPct: 0.99,
      revenueHoursAtRisk: 0,
      totalClosures: 0,
      totalLateFirst: 0,
      totalLateDeploy: 0,
      unassignedRoutesCount: 0,
      issueCount: 0,
    },
  ],
  issues: [
    { issueId: "issue-1", divisionId: "division-1", divisionName: "North Division", date: "2026-09-12", routeCode: "R12", disruptionType: "Route Closed", notes: "Bridge closure" },
    { issueId: "issue-2", divisionId: "division-2", divisionName: "South Division", date: "2026-09-14", routeCode: "R8", disruptionType: "Late Deploy", notes: "Traffic" },
  ],
};

test("report builder creates a focused operations preview with only selected fields", () => {
  const dataset = buildReportDataset(report, {
    source: "operations",
    focus: "attention",
    fields: "name,runCutFulfillmentPct,revenueHoursAtRisk",
    sort: "revenueHoursAtRisk",
    direction: "desc",
  });

  assert.equal(dataset.total, 1);
  assert.deepEqual(dataset.columns.map((column) => column.key), ["name", "runCutFulfillmentPct", "revenueHoursAtRisk"]);
  assert.deepEqual(dataset.rows[0], {
    name: "North Division",
    runCutFulfillmentPct: "94%",
    revenueHoursAtRisk: "12.5",
  });
});

test("issue templates use grouped filters, search, division codes, and date sorting", () => {
  const dataset = buildReportDataset(report, {
    source: "issues",
    issueType: "closures",
    search: "bridge",
    fields: "divisionCode,date,routeCode,disruptionType,notes",
    sort: "date",
    direction: "desc",
  });

  assert.equal(dataset.total, 1);
  assert.equal(dataset.rows[0].divisionCode, "D1");
  assert.equal(dataset.rows[0].disruptionType, "Route Closed");
});

test("unknown report fields and settings are normalized to safe defaults", () => {
  const config = normalizeReportBuilderConfig({
    source: "unknown",
    fields: "not-a-field",
    sort: "bad-sort",
    direction: "sideways",
    title: "",
  });

  assert.equal(config.source, "operations");
  assert.deepEqual(config.fields, [
    "name",
    "runCutFulfillmentPct",
    "actualRevenueHourFulfillmentPct",
    "revenueHoursAtRisk",
    "totalClosures",
    "totalLateFirst",
    "totalLateDeploy",
    "unassignedRoutesCount",
  ]);
  assert.equal(config.sort, "name");
  assert.equal(config.direction, "asc");
});

test("raw Network Success reports keep every confirmed upload component as its own unaggregated row", () => {
  const rows = rawNetworkRowsFromEntries([
    {
      division: "division-1",
      source: "ecolane",
      date: "2026-09-15",
      submission: {
        files: [{ name: "Daily Run Productivity.xlsx" }, { name: "Driver Performance.xlsx" }],
        confirmedAt: new Date("2026-09-16T14:30:00.000Z"),
      },
      deployment: {
        canonicalRoute: "10",
        operatorName: "Matched Driver",
        providerName: "Provider One",
      },
      components: [
        { sourceRow: 18, sourceRoute: "BST-10A", sourceOperator: "Driver One", completedTrips: 20, reportedRevenueHours: 7.5, tpsh: 2.1, otpPct: 0.94, zeroTrips: false },
        { sourceRow: 19, sourceRoute: "BST-10B", sourceOperator: "Driver Two", completedTrips: 0, reportedRevenueHours: 0, tpsh: null, otpPct: null, zeroTrips: true },
      ],
    },
  ], [{ _id: "division-1", code: "D1", name: "North Division" }]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].completedTrips, 20);
  assert.equal(rows[1].completedTrips, 0);
  assert.equal(rows[0].sourceOperator, "Driver One");
  assert.equal(rows[0].matchedOperator, "Matched Driver");
  assert.equal(rows[0].matchedProvider, "Provider One");
  assert.match(rows[0].fileName, /Daily Run Productivity/);

  const dataset = buildReportDataset({ networkRows: rows }, {
    source: "network_raw",
    networkSource: "ecolane",
    fields: "divisionName,sourceRow,sourceRoute,matchedOperator,completedTrips,tpsh,otpPct",
    sort: "sourceRow",
  });
  assert.equal(dataset.total, 2);
  assert.deepEqual(dataset.rows[0], {
    divisionName: "North Division",
    sourceRow: "18",
    sourceRoute: "BST-10A",
    matchedOperator: "Matched Driver",
    completedTrips: "20",
    tpsh: "2.1",
    otpPct: "94%",
  });
});
