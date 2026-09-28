import test from "node:test";
import assert from "node:assert/strict";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import Route from "../models/Route.js";
import Operator from "../models/Operator.js";
import Division from "../models/Division.js";
import {
  findOperatorConflict,
  findOperatorConflictOnDate,
  findVehicleConflict,
  findVehicleConflictIds,
  findVehicleConflictOnDate,
  recurringOverlapDays,
  resolveOperatorInBranchGroup,
  resolveRoute,
  timeRangesOverlap,
} from "./resolveAssignment.js";

test("time overlap allows back-to-back duties and detects real collisions", () => {
  assert.equal(timeRangesOverlap("08:00", "12:00", "12:00", "16:00"), false);
  assert.equal(timeRangesOverlap("08:00", "12:01", "12:00", "16:00"), true);
  assert.equal(timeRangesOverlap("22:00", "02:00", "23:00", "01:00"), true);
});

test("recurring overlap detects an overnight duty colliding with the next service day", () => {
  assert.deepEqual(
    recurringOverlapDays(["MON"], "23:00", "02:00", ["TUE"], "01:00", "03:00"),
    ["MON"]
  );
  assert.deepEqual(
    recurringOverlapDays(["MON"], "23:00", "01:00", ["TUE"], "01:00", "03:00"),
    []
  );
});

test("Master Run Cuts rejects an overlapping vehicle assignment", async () => {
  const originalFind = RunCut.find;
  RunCut.find = () => ({
    populate: async () => [{
      route: { code: "R-2" },
      daysOfWeek: ["MON", "TUE"],
      startTime: "09:00",
      endTime: "13:00",
    }],
  });

  try {
    const conflict = await findVehicleConflict({
      vehicle: "vehicle-1",
      daysOfWeek: ["MON"],
      startTime: "08:00",
      endTime: "10:00",
    });
    assert.deepEqual(conflict, {
      routeCode: "R-2",
      days: ["MON"],
      startTime: "09:00",
      endTime: "13:00",
    });
  } finally {
    RunCut.find = originalFind;
  }
});

test("Deployment rejects an overlapping vehicle assignment on the same date", async () => {
  const originalFind = RunCutDay.find;
  RunCutDay.find = () => ({
    populate: async () => [{
      route: { code: "LIVE-2" },
      date: new Date("2026-09-15"),
      startTime: "10:00",
      endTime: "14:00",
    }],
  });

  try {
    const conflict = await findVehicleConflictOnDate({
      vehicle: "vehicle-1",
      date: new Date("2026-09-15"),
      startTime: "12:00",
      endTime: "16:00",
    });
    assert.equal(conflict.routeCode, "LIVE-2");
  } finally {
    RunCutDay.find = originalFind;
  }
});

test("active recurring assignments block both operators and vehicles", async () => {
  const originalFind = RunCut.find;
  RunCut.find = () => ({
    populate: async () => [{
      _id: "other",
      route: { code: "R-2" },
      status: "active",
      daysOfWeek: ["MON"],
      startTime: "09:00",
      endTime: "13:00",
    }],
  });

  try {
    const assignment = { daysOfWeek: ["MON"], startTime: "10:00", endTime: "12:00", status: "active" };
    assert.ok(await findOperatorConflict({ operator: "operator-1", ...assignment }));
    assert.ok(await findVehicleConflict({ vehicle: "vehicle-1", ...assignment }));
  } finally {
    RunCut.find = originalFind;
  }
});

test("suspended, off, and unassigned recurring duties release both operators and vehicles", async () => {
  const originalFind = RunCut.find;
  try {
    for (const status of ["suspended", "off", "unassigned"]) {
      RunCut.find = () => ({
        populate: async () => [{
          _id: `other-${status}`,
          route: { code: "R-2" },
          status,
          daysOfWeek: ["MON"],
          startTime: "09:00",
          endTime: "13:00",
        }],
      });
      const assignment = { daysOfWeek: ["MON"], startTime: "10:00", endTime: "12:00", status: "active" };
      assert.equal(await findOperatorConflict({ operator: "operator-1", ...assignment }), null);
      assert.equal(await findVehicleConflict({ vehicle: "vehicle-1", ...assignment }), null);
    }
  } finally {
    RunCut.find = originalFind;
  }
});

test("non-operating target duties do not claim an operator or vehicle", async () => {
  const originalFind = RunCut.find;
  let queried = false;
  RunCut.find = () => {
    queried = true;
    return { populate: async () => [] };
  };
  try {
    for (const status of ["suspended", "off", "unassigned"]) {
      const assignment = { daysOfWeek: ["MON"], startTime: "10:00", endTime: "12:00", status };
      assert.equal(await findOperatorConflict({ operator: "operator-1", ...assignment }), null);
      assert.equal(await findVehicleConflict({ vehicle: "vehicle-1", ...assignment }), null);
    }
    assert.equal(queried, false);
  } finally {
    RunCut.find = originalFind;
  }
});

test("overnight active recurring assignments still block operators and vehicles", async () => {
  const originalFind = RunCut.find;
  RunCut.find = () => ({
    populate: async () => [{
      _id: "overnight-other",
      route: { code: "NIGHT-2" },
      status: "active",
      daysOfWeek: ["TUE"],
      startTime: "01:00",
      endTime: "03:00",
    }],
  });
  try {
    const assignment = { daysOfWeek: ["MON"], startTime: "23:00", endTime: "02:00", status: "active" };
    assert.ok(await findOperatorConflict({ operator: "operator-1", ...assignment }));
    assert.ok(await findVehicleConflict({ vehicle: "vehicle-1", ...assignment }));
  } finally {
    RunCut.find = originalFind;
  }
});

test("dated Deployment conflicts ignore non-operating duties for operators and vehicles", async () => {
  const originalFind = RunCutDay.find;
  try {
    for (const status of ["suspended", "off", "unassigned"]) {
      RunCutDay.find = () => ({
        populate: async () => [{
          route: { code: "LIVE-2" },
          status,
          date: new Date("2026-09-15"),
          startTime: "10:00",
          endTime: "14:00",
        }],
      });
      const assignment = { date: new Date("2026-09-15"), startTime: "12:00", endTime: "16:00", status: "active" };
      assert.equal(await findOperatorConflictOnDate({ operator: "operator-1", ...assignment }), null);
      assert.equal(await findVehicleConflictOnDate({ vehicle: "vehicle-1", ...assignment }), null);
    }
  } finally {
    RunCutDay.find = originalFind;
  }
});

test("a standby's own duty does not block a different dated assignment for its operator or vehicle", async () => {
  const originalFind = RunCutDay.find;
  RunCutDay.find = () => ({
    populate: async () => [{
      route: { code: "STBY-2", type: "standby" },
      status: "active",
      date: new Date("2026-09-15"),
      startTime: "04:00",
      endTime: "14:00",
    }],
  });

  try {
    const assignment = { date: new Date("2026-09-15"), startTime: "05:00", endTime: "12:00", status: "active" };
    assert.equal(await findOperatorConflictOnDate({ operator: "operator-1", ...assignment }), null);
    assert.equal(await findVehicleConflictOnDate({ vehicle: "vehicle-1", ...assignment }), null);
  } finally {
    RunCutDay.find = originalFind;
  }
});

test("resolveRoute reuses an existing division route by code regardless of active state", async () => {
  const originalFindOne = Route.findOne;
  const originalCreate = Route.create;
  let created = false;
  Route.findOne = async ({ division, code }) => {
    assert.equal(division, "division-1");
    assert.ok(code.test("extra-3"), "matches case-insensitively");
    return { _id: "route-3", division, code: "EXTRA-3", active: false, type: "standard" };
  };
  Route.create = async () => {
    created = true;
    throw new Error("should not create a route that already exists");
  };
  try {
    const route = await resolveRoute("division-1", "extra-3");
    assert.equal(route._id, "route-3");
    assert.equal(created, false);
  } finally {
    Route.findOne = originalFindOne;
    Route.create = originalCreate;
  }
});

test("resolveRoute makes up a new one-off route when no code matches", async () => {
  const originalFindOne = Route.findOne;
  const originalCreate = Route.create;
  Route.findOne = async () => null;
  Route.create = async (payload) => ({ _id: "route-new", ...payload });
  try {
    const route = await resolveRoute("division-1", "  99 x  ");
    assert.equal(route.division, "division-1");
    assert.equal(route.code, "99X");
  } finally {
    Route.findOne = originalFindOne;
    Route.create = originalCreate;
  }
});

test("resolveOperatorInBranchGroup finds a driver who belongs to a sibling division in the shared standby pool", async () => {
  const originalFindById = Division.findById;
  const originalDivisionFind = Division.find;
  const originalOperatorFindOne = Operator.findOne;
  let capturedQuery;

  Division.findById = () => ({
    select: async () => ({ _id: "golink", code: "DIV_3_GL", active: true }),
  });
  Division.find = () => ({ distinct: async () => ["ada", "golink", "standby-pool"] });
  Operator.findOne = async (query) => {
    capturedQuery = query;
    return { _id: "sydney", name: "Sydney Austen", division: "standby-pool", active: true };
  };

  try {
    const operator = await resolveOperatorInBranchGroup("golink", "sydney");
    assert.equal(operator.name, "Sydney Austen");
    assert.deepEqual(capturedQuery.division.$in, ["ada", "golink", "standby-pool"]);
  } finally {
    Division.findById = originalFindById;
    Division.find = originalDivisionFind;
    Operator.findOne = originalOperatorFindOne;
  }
});

test("resolveOperatorInBranchGroup rejects a driver outside the division's branch group", async () => {
  const originalFindById = Division.findById;
  const originalDivisionFind = Division.find;
  const originalOperatorFindOne = Operator.findOne;

  Division.findById = () => ({
    select: async () => ({ _id: "division-1", code: "DIV_9", active: true }),
  });
  Division.find = () => ({ distinct: async () => ["division-1"] });
  Operator.findOne = async () => null;

  try {
    await assert.rejects(
      resolveOperatorInBranchGroup("division-1", "someone-else"),
      /shared standby pool/
    );
  } finally {
    Division.findById = originalFindById;
    Division.find = originalDivisionFind;
    Operator.findOne = originalOperatorFindOne;
  }
});

test("vehicle warning flags exclude non-operating duties", () => {
  const rows = [
    { _id: "active", vehicle: "vehicle-1", status: "active", daysOfWeek: ["MON"], startTime: "08:00", endTime: "12:00" },
    { _id: "suspended", vehicle: "vehicle-1", status: "suspended", daysOfWeek: ["MON"], startTime: "09:00", endTime: "11:00" },
  ];
  assert.equal(findVehicleConflictIds(rows).size, 0);
});
