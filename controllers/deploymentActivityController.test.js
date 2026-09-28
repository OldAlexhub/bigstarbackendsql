import assert from "node:assert/strict";
import test from "node:test";
import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
import Division from "../models/Division.js";
import { exportDeploymentActivity } from "./deploymentActivityController.js";

const response = () => ({
  statusCode: 200,
  headers: {},
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  send(body) { this.body = body; return this; },
});

const entries = [
  {
    createdAt: new Date("2026-09-12T14:30:00.000Z"),
    name: "Taylor Driver",
    username: "tdriver",
    action: "runcutday.deployed_set",
    summary: 'Assigned standby, route "42"',
  },
  {
    createdAt: new Date("2026-09-10T08:00:00.000Z"),
    name: "Morgan Lead",
    username: "mlead",
    action: "issue.created",
    summary: "Created an issue",
  },
];

const withExportMocks = async (work) => {
  const originalFind = DeploymentActivityLog.find;
  const originalFindDivision = Division.findById;
  let capturedQuery;
  DeploymentActivityLog.find = (query) => {
    capturedQuery = query;
    return {
      sort: () => ({ lean: async () => entries }),
    };
  };
  Division.findById = () => ({
    select: () => ({ lean: async () => ({ code: "D1", name: "Division One" }) }),
  });
  try {
    await work(() => capturedQuery);
  } finally {
    DeploymentActivityLog.find = originalFind;
    Division.findById = originalFindDivision;
  }
};

test("Tracker Log CSV exports the complete selected inclusive date range", async () => {
  await withExportMocks(async (getQuery) => {
    const res = response();
    await exportDeploymentActivity(
      {
        user: { role: "ELT", divisionAccess: [] },
        query: { division: "division-1", from: "2026-09-10", to: "2026-09-12", format: "csv" },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "text/csv; charset=utf-8");
    assert.match(res.headers["Content-Disposition"], /D1-deployment-tracker-log-2026-09-10-to-2026-09-12\.csv/);
    assert.match(res.body, /Taylor Driver/);
    assert.match(res.body, /"Assigned standby, route ""42"""/);
    assert.match(res.body, /Morgan Lead/);
    assert.equal(getQuery().createdAt.$gte.toISOString(), "2026-09-10T00:00:00.000Z");
    assert.equal(getQuery().createdAt.$lt.toISOString(), "2026-09-13T00:00:00.000Z");
  });
});

test("Tracker Log Excel export returns a real XLSX workbook", async () => {
  await withExportMocks(async () => {
    const res = response();
    await exportDeploymentActivity(
      {
        user: { role: "ELT", divisionAccess: [] },
        query: { division: "division-1", from: "2026-09-10", to: "2026-09-12", format: "xlsx" },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(
      res.headers["Content-Type"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    assert.match(res.headers["Content-Disposition"], /\.xlsx"$/);
    assert.equal(Buffer.isBuffer(res.body), true);
    assert.equal(res.body.subarray(0, 2).toString(), "PK");
  });
});
