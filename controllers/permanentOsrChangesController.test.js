import assert from "node:assert/strict";
import test from "node:test";
import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
import Division from "../models/Division.js";
import { listPermanentOsrChanges, exportPermanentOsrChanges } from "./permanentOsrChangesController.js";

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
    route: "1029-B",
    reason: "Client requested a permanent driver change",
    name: "Taylor Driver",
    username: "tdriver",
    changes: [
      { field: "operator", from: "Joseph Mayer", to: "Andre Smith Jr." },
      { field: "pullout address", from: "100 Main St", to: "500 Second Ave" },
    ],
  },
  {
    createdAt: new Date("2026-09-10T08:00:00.000Z"),
    route: "204",
    reason: "Permanent time shift",
    name: "Morgan Lead",
    username: "mlead",
    changes: [{ field: "start time", from: "08:00", to: "09:00" }],
  },
];

const withMocks = async (work) => {
  const originalFind = DeploymentActivityLog.find;
  const originalFindDivision = Division.findById;
  let capturedQuery;
  DeploymentActivityLog.find = (query) => {
    capturedQuery = query;
    return { sort: () => ({ limit: () => ({ lean: async () => entries }), lean: async () => entries }) };
  };
  Division.findById = () => ({ select: () => ({ lean: async () => ({ code: "D1", name: "Division One" }) }) });
  try {
    await work(() => capturedQuery);
  } finally {
    DeploymentActivityLog.find = originalFind;
    Division.findById = originalFindDivision;
  }
};

test("listing flattens each submission's changes into one row per field", async () => {
  await withMocks(async (getQuery) => {
    const res = response();
    await listPermanentOsrChanges(
      { user: { role: "ELT", divisionAccess: [] }, query: { division: "division-1", from: "2026-09-10", to: "2026-09-12" } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.entries.length, 3);
    assert.deepEqual(res.body.entries[0], {
      createdAt: entries[0].createdAt,
      route: "1029-B",
      field: "operator",
      from: "Joseph Mayer",
      to: "Andre Smith Jr.",
      reason: "Client requested a permanent driver change",
      name: "Taylor Driver",
      username: "tdriver",
    });
    assert.equal(res.body.entries[1].field, "pullout address");
    assert.equal(res.body.entries[2].route, "204");
    assert.equal(getQuery().action, "runcut.permanent_osr_updated");
  });
});

test("export requires both dates and produces a real XLSX workbook", async () => {
  await withMocks(async () => {
    const res = response();
    await exportPermanentOsrChanges(
      { user: { role: "ELT", divisionAccess: [] }, query: { division: "division-1", format: "xlsx" } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /from and to are required/);
  });

  await withMocks(async () => {
    const res = response();
    await exportPermanentOsrChanges(
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
    assert.match(res.headers["Content-Disposition"], /D1-permanent-osr-changes-2026-09-10-to-2026-09-12\.xlsx"$/);
    assert.equal(Buffer.isBuffer(res.body), true);
    assert.equal(res.body.subarray(0, 2).toString(), "PK");
  });
});

test("CSV export escapes fields and includes every flattened row", async () => {
  await withMocks(async () => {
    const res = response();
    await exportPermanentOsrChanges(
      {
        user: { role: "ELT", divisionAccess: [] },
        query: { division: "division-1", from: "2026-09-10", to: "2026-09-12", format: "csv" },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Andre Smith Jr\./);
    assert.match(res.body, /pullout address/);
    assert.match(res.body, /start time/);
  });
});
