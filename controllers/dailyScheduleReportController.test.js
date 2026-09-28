import assert from "node:assert/strict";
import test from "node:test";
import Division from "../models/Division.js";
import RunCutDay from "../models/RunCutDay.js";
import RunCut from "../models/RunCut.js";
import {
  exceptionRowsForReport,
  getDailyScheduleReport,
  hasDailyScheduleException,
} from "./dailyScheduleReportController.js";

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("disposition-only changes do not alter today's or tomorrow's client report", async () => {
  const originalFindById = Division.findById;
  const originalDivisionFind = Division.find;
  const originalFind = RunCutDay.find;
  let days = [];
  Division.findById = () => {
    const result = Promise.resolve({ _id: "division-1", code: "D1", name: "Division 1" });
    result.select = () => result;
    return result;
  };
  Division.find = () => ({ distinct: async () => ["division-1"], lean: async () => [] });
  RunCutDay.find = () => {
    const query = {
      populate() {
        return this;
      },
      sort() {
        return Promise.resolve(days);
      },
    };
    return query;
  };

  try {
    for (const date of ["2026-09-09", "2026-09-10"]) {
      const baseDay = {
        _id: `day-${date}`,
        date: new Date(`${date}T00:00:00.000Z`),
        division: "division-1",
        route: { _id: "route-1", code: "R1", type: "scheduled" },
        operator: { _id: "operator-1", name: "Operator" },
        vehicle: { _id: "vehicle-1", code: "V1" },
        pulloutAddress: "Garage",
        startTime: "08:00",
        endTime: "16:00",
        status: "active",
        clientNotes: "Existing client note",
      };

      days = [{ ...baseDay, disposition: null }];
      const openResponse = responseRecorder();
      await getDailyScheduleReport(
        { user: { role: "ELT" }, query: { division: "division-1", date } },
        openResponse
      );

      days = [{ ...baseDay, disposition: "deployed_late" }];
      const closedResponse = responseRecorder();
      await getDailyScheduleReport(
        { user: { role: "ELT" }, query: { division: "division-1", date } },
        closedResponse
      );

      assert.deepEqual(closedResponse.body, openResponse.body);
    }
  } finally {
    Division.findById = originalFindById;
    Division.find = originalDivisionFind;
    RunCutDay.find = originalFind;
  }
});

test("a standby from a sibling branch is used in the selected branch's client report", async () => {
  const originalFindById = Division.findById;
  const originalDivisionFind = Division.find;
  const originalRunCutDayFind = RunCutDay.find;
  const divisionDoc = { _id: "golink", code: "DIV_3_GL", name: "Division 3 - GoLink", parentDivision: "ada" };

  Division.findById = () => {
    const result = Promise.resolve(divisionDoc);
    result.select = () => result;
    return result;
  };
  Division.find = () => ({ distinct: async () => ["ada", "golink"], lean: async () => [] });
  RunCutDay.find = () => ({
    populate() {
      return this;
    },
    sort() {
      return Promise.resolve([
        {
          division: "golink",
          route: { _id: "gl-route", code: "GL-1", type: "standard" },
          operator: null,
          vehicle: null,
          status: "unassigned",
          clientNotes: "",
        },
        {
          division: "ada",
          route: { _id: "standby-route", code: "STBY-1", type: "standby" },
          operator: { name: "Shared Operator" },
          vehicle: { code: "SHARED-BUS" },
          pulloutAddress: "Shared Garage",
          startTime: "08:00",
          endTime: "16:00",
          deployed: true,
          coveringRoute: { _id: "gl-route", code: "GL-1" },
        },
      ]);
    },
  });

  try {
    const response = responseRecorder();
    await getDailyScheduleReport(
      { user: { role: "ELT" }, query: { division: "golink", date: "2026-09-14" } },
      response
    );

    assert.equal(response.body.rows.length, 1);
    assert.equal(response.body.rows[0].operator, "Shared Operator");
    assert.equal(response.body.rows[0].vehicle, "SHARED-BUS");
    assert.match(response.body.rows[0].clientNotes, /Covered by standby STBY-1/);
  } finally {
    Division.findById = originalFindById;
    Division.find = originalDivisionFind;
    RunCutDay.find = originalRunCutDayFind;
  }
});

test("a division that keeps its own pullout address is not overwritten by the covering standby's", async () => {
  const originalFindById = Division.findById;
  const originalDivisionFind = Division.find;
  const originalRunCutDayFind = RunCutDay.find;
  const originalRunCutFind = RunCut.find;
  const divisionDoc = { _id: "golink", code: "DIV_3_GL", name: "Division 3 - GoLink" };

  Division.findById = () => {
    const result = Promise.resolve(divisionDoc);
    result.select = () => result;
    return result;
  };
  Division.find = () => ({
    distinct: async () => ["ada", "golink"],
    lean: async () => [{ _id: "golink", pulloutAddressRules: { standbyKeepsRouteAddress: true } }],
  });
  RunCut.find = () => ({ lean: async () => [] });
  RunCutDay.find = () => ({
    populate() {
      return this;
    },
    sort() {
      return Promise.resolve([
        {
          division: "golink",
          route: { _id: "gl-route", code: "GL-1", type: "standard" },
          operator: null,
          vehicle: null,
          pulloutAddress: "GoLink's own stop",
          status: "unassigned",
          clientNotes: "",
        },
        {
          division: "ada",
          route: { _id: "standby-route", code: "STBY-1", type: "standby" },
          operator: { name: "Shared Operator" },
          vehicle: { code: "SHARED-BUS" },
          pulloutAddress: "Shared Garage",
          startTime: "08:00",
          endTime: "16:00",
          deployed: true,
          coveringRoute: { _id: "gl-route", code: "GL-1" },
        },
      ]);
    },
  });

  try {
    const response = responseRecorder();
    await getDailyScheduleReport(
      { user: { role: "ELT" }, query: { division: "golink", date: "2026-09-14" } },
      response
    );

    assert.equal(response.body.rows[0].operator, "Shared Operator");
    assert.equal(response.body.rows[0].pulloutAddress, "GoLink's own stop");
  } finally {
    Division.findById = originalFindById;
    Division.find = originalDivisionFind;
    RunCutDay.find = originalRunCutDayFind;
    RunCut.find = originalRunCutFind;
  }
});

test("a division that keeps its own pullout address falls back to the route's standing Master Run Cut address when today's day record has none", async () => {
  const originalFindById = Division.findById;
  const originalDivisionFind = Division.find;
  const originalRunCutDayFind = RunCutDay.find;
  const originalRunCutFind = RunCut.find;
  const divisionDoc = { _id: "golink", code: "DIV_3_GL", name: "Division 3 - GoLink" };

  Division.findById = () => {
    const result = Promise.resolve(divisionDoc);
    result.select = () => result;
    return result;
  };
  Division.find = () => ({
    distinct: async () => ["ada", "golink"],
    lean: async () => [{ _id: "golink", pulloutAddressRules: { standbyKeepsRouteAddress: true } }],
  });
  RunCut.find = () => ({
    lean: async () => [{ route: "gl-route", pulloutAddress: "GoLink's standing stop" }],
  });
  RunCutDay.find = () => ({
    populate() {
      return this;
    },
    sort() {
      return Promise.resolve([
        {
          division: "golink",
          route: { _id: "gl-route", code: "GL-1", type: "standard" },
          operator: null,
          vehicle: null,
          pulloutAddress: "",
          status: "unassigned",
          clientNotes: "",
        },
        {
          division: "ada",
          route: { _id: "standby-route", code: "STBY-1", type: "standby" },
          operator: { name: "Shared Operator" },
          vehicle: { code: "SHARED-BUS" },
          pulloutAddress: "Shared Garage",
          startTime: "08:00",
          endTime: "16:00",
          deployed: true,
          coveringRoute: { _id: "gl-route", code: "GL-1" },
        },
      ]);
    },
  });

  try {
    const response = responseRecorder();
    await getDailyScheduleReport(
      { user: { role: "ELT" }, query: { division: "golink", date: "2026-09-14" } },
      response
    );

    assert.equal(response.body.rows[0].pulloutAddress, "GoLink's standing stop");
  } finally {
    Division.findById = originalFindById;
    Division.find = originalDivisionFind;
    RunCutDay.find = originalRunCutDayFind;
    RunCut.find = originalRunCutFind;
  }
});

test("day-specific override flags and extra routes are schedule exceptions", () => {
  assert.equal(hasDailyScheduleException({ status: "active", overrides: {} }), false);
  assert.equal(
    hasDailyScheduleException({ status: "active", overrides: { endTime: true, clientNotes: true } }),
    true
  );
  assert.equal(hasDailyScheduleException({ status: "add_rte", isExtra: true }), true);
});

test("the Updates report contains only exception rows", () => {
  const rows = [
    { routeId: "route-1", route: "R1", status: "active", isException: false },
    { routeId: "route-2", route: "R2", status: "active", isException: true },
    { routeId: "route-3", route: "R3", status: "off", isException: true },
  ];

  assert.deepEqual(exceptionRowsForReport(rows), [
    { routeId: "route-2", route: "R2", status: "active", dailyChanges: "Active" },
    { routeId: "route-3", route: "R3", status: "off", dailyChanges: "Off" },
  ]);
});
