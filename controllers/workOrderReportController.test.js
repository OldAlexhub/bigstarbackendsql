import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import RunCutDay from "../models/RunCutDay.js";
import RunCut from "../models/RunCut.js";
import Division from "../models/Division.js";
import { getWorkOrderReport } from "./workOrderReportController.js";

const response = () => ({
  statusCode: 200,
  headers: {},
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  send(body) { this.body = body; return this; },
});

const chainable = (result) => {
  const node = { populate: () => node, lean: async () => result };
  return node;
};

const divisionId = "division-1";

const withMocks = async (days, work, divisionOverrides = {}, masterRunCuts = []) => {
  const originalFind = RunCutDay.find;
  const originalFindDivision = Division.findById;
  const originalRunCutFind = RunCut.find;
  RunCutDay.find = () => chainable(days);
  RunCut.find = () => ({ lean: async () => masterRunCuts });
  Division.findById = (id) => ({
    select: () => {
      const result = { _id: id, code: "DIV_5", name: "Division Five", active: true, ...divisionOverrides };
      return { lean: async () => result, then: (resolve) => resolve(result) };
    },
  });
  try {
    await work();
  } finally {
    RunCutDay.find = originalFind;
    Division.findById = originalFindDivision;
    RunCut.find = originalRunCutFind;
  }
};

const day = (overrides) => ({
  division: divisionId,
  date: new Date("2026-09-13T00:00:00.000Z"),
  route: { _id: "route-204", code: "204", type: "standard" },
  operator: { name: "Greg Brown" },
  vehicle: { code: "4582" },
  pulloutAddress: "4180 Treat Blvd., Concord, CA",
  startTime: "12:00",
  endTime: "22:30",
  status: "active",
  clientNotes: "",
  deployed: false,
  coveringRoute: null,
  ...overrides,
});

test("a Work Order export includes a regular route and a standby route, sorted with standby last", async () => {
  const days = [
    day({ route: { _id: "route-204", code: "204", type: "standard" } }),
    day({
      route: { _id: "route-stby203", code: "STBY 203", type: "standby" },
      operator: { name: "Antoine Fowler" },
      vehicle: { code: "4585" },
      pulloutAddress: "1586 Sunnyvale Ave.",
      startTime: "06:30",
      endTime: "16:30",
      clientNotes: "Stand by available if needed",
    }),
    day({
      route: { _id: "route-200", code: "200", type: "standard" },
      operator: { name: "Scott Allgood" },
      vehicle: { code: "4600" },
      status: "add_rte",
      clientNotes: "Additional Rev Request",
    }),
  ];

  await withMocks(days, async () => {
    const res = response();
    await getWorkOrderReport(
      {
        user: { role: "ELT", divisionAccess: [] },
        query: { division: divisionId, from: "2026-09-13" },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(
      res.headers["Content-Type"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    assert.match(res.headers["Content-Disposition"], /DIV_5_WO_091326_091926\.xlsx"$/);
    assert.equal(Buffer.isBuffer(res.body), true);
    assert.equal(res.body.subarray(0, 2).toString(), "PK");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
      "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT",
    ]);

    const sunday = workbook.getWorksheet("SUN");
    assert.deepEqual(
      sunday.getRow(1).values.slice(1),
      ["Division", "DAY", "DATE", "ASSIGNMENT / ROUTE", "OPERATOR", "VEH", "PULLOUT ADDRESS", "START TIME", "END TIME", "DAILY CHANGES", "CLIENT NOTES"]
    );

    // Route 200 sorts before 204 (numeric), and the standby route is last
    // regardless of its own code, with "_SB" appended to the division.
    assert.equal(sunday.getRow(2).getCell(1).value, "DIV_5");
    assert.equal(sunday.getRow(2).getCell(4).value, "200");
    assert.equal(sunday.getRow(2).getCell(10).value, "Add Rte");
    assert.equal(sunday.getRow(2).getCell(11).value, "Additional Rev Request");
    assert.equal(sunday.getRow(2).getCell(11).fill.fgColor.argb, "FFFFFF00");

    assert.equal(sunday.getRow(3).getCell(4).value, "204");
    assert.equal(sunday.getRow(3).getCell(11).value, "");

    assert.equal(sunday.getRow(4).getCell(1).value, "DIV_5_SB");
    assert.equal(sunday.getRow(4).getCell(4).value, "STBY 203");

    const monday = workbook.getWorksheet("MON");
    assert.equal(monday.rowCount, 2);
    assert.match(monday.getRow(2).getCell(5).value, /No routes scheduled/);
  });
});

test("a covered route reports the covering standby's assignment and pullout", async () => {
  const days = [
    day({
      route: { _id: "route-204", code: "204", type: "standard" },
      status: "unassigned",
      operator: null,
      vehicle: null,
      clientNotes: "",
    }),
    day({
      route: { _id: "route-stby203", code: "STBY 203", type: "standby" },
      operator: { name: "Antoine Fowler" },
      vehicle: { code: "4585" },
      pulloutAddress: "1586 Sunnyvale Ave.",
      startTime: "06:30",
      endTime: "16:30",
      deployed: true,
      coveringRoute: { _id: "route-204", code: "204" },
    }),
  ];

  await withMocks(days, async () => {
    const res = response();
    await getWorkOrderReport(
      { user: { role: "ELT", divisionAccess: [] }, query: { division: divisionId, from: "2026-09-13" } },
      res
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    const sunday = workbook.getWorksheet("SUN");

    assert.equal(sunday.getRow(2).getCell(4).value, "204");
    assert.equal(sunday.getRow(2).getCell(5).value, "Antoine Fowler");
    assert.equal(sunday.getRow(2).getCell(6).value, "4585");
    assert.equal(sunday.getRow(2).getCell(11).value, "Covered by standby STBY 203");
  });
});

test("a division that keeps its own pullout address prints its route's address even while covered", async () => {
  const days = [
    day({
      route: { _id: "route-204", code: "204", type: "standard" },
      status: "unassigned",
      operator: null,
      vehicle: null,
      pulloutAddress: "GoLink's own stop",
      clientNotes: "",
    }),
    day({
      route: { _id: "route-stby203", code: "STBY 203", type: "standby" },
      operator: { name: "Antoine Fowler" },
      vehicle: { code: "4585" },
      pulloutAddress: "1586 Sunnyvale Ave.",
      startTime: "06:30",
      endTime: "16:30",
      deployed: true,
      coveringRoute: { _id: "route-204", code: "204" },
    }),
  ];

  await withMocks(
    days,
    async () => {
      const res = response();
      await getWorkOrderReport(
        { user: { role: "ELT", divisionAccess: [] }, query: { division: divisionId, from: "2026-09-13" } },
        res
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body);
      const sunday = workbook.getWorksheet("SUN");

      assert.equal(sunday.getRow(2).getCell(5).value, "Antoine Fowler");
      assert.equal(sunday.getRow(2).getCell(7).value, "GoLink's own stop");
    },
    { pulloutAddressRules: { standbyKeepsRouteAddress: true } }
  );
});

test("a division that keeps its own pullout address falls back to the route's standing Master Run Cut address when today's day record has none", async () => {
  const days = [
    day({
      route: { _id: "route-204", code: "204", type: "standard" },
      status: "unassigned",
      operator: null,
      vehicle: null,
      pulloutAddress: "",
      clientNotes: "",
    }),
    day({
      route: { _id: "route-stby203", code: "STBY 203", type: "standby" },
      operator: { name: "Antoine Fowler" },
      vehicle: { code: "4585" },
      pulloutAddress: "1586 Sunnyvale Ave.",
      startTime: "06:30",
      endTime: "16:30",
      deployed: true,
      coveringRoute: { _id: "route-204", code: "204" },
    }),
  ];

  await withMocks(
    days,
    async () => {
      const res = response();
      await getWorkOrderReport(
        { user: { role: "ELT", divisionAccess: [] }, query: { division: divisionId, from: "2026-09-13" } },
        res
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body);
      const sunday = workbook.getWorksheet("SUN");

      assert.equal(sunday.getRow(2).getCell(7).value, "GoLink's standing stop");
    },
    { pulloutAddressRules: { standbyKeepsRouteAddress: true } },
    [{ route: "route-204", pulloutAddress: "GoLink's standing stop" }]
  );
});
