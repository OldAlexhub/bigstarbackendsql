import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "../db/sqlMongoose.js";
import Division from "../models/Division.js";
import DivisionThresholdChange from "../models/DivisionThresholdChange.js";
import RunCut from "../models/RunCut.js";
import User from "../models/User.js";
import ChangeLog from "../models/ChangeLog.js";
import OperationsKpiSetting from "../models/OperationsKpiSetting.js";
import {
  createDivision,
  deleteDivision,
  DIVISION_OWNED_MODELS,
  listDivisions,
  updateDivision,
} from "./divisionsController.js";

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

test("ordinary division lists hide retired divisions while ELT Settings can include them", async () => {
  const originalFind = Division.find;
  const filters = [];
  Division.find = (filter) => {
    filters.push(filter);
    return {
      sort() { return this; },
      populate() { return Promise.resolve([]); },
    };
  };

  try {
    await listDivisions({ user: { role: "ELT" }, query: {} }, responseRecorder());
    await listDivisions(
      { user: { role: "ELT" }, query: { includeInactive: "1" } },
      responseRecorder()
    );

    assert.deepEqual(filters[0], { active: { $ne: false } });
    assert.deepEqual(filters[1], {});
  } finally {
    Division.find = originalFind;
  }
});

test("division lists expose the threshold version effective today even when the cached value is older", async () => {
  const originalFind = Division.find;
  const originalHistoryFind = DivisionThresholdChange.find;
  const division = {
    _id: "division-1",
    code: "DIV_1",
    timezone: "America/New_York",
    thresholds: { breakMinutes: 30, revenueRatio: 0.9 },
  };
  Division.find = () => ({
    sort() { return this; },
    populate() { return Promise.resolve([division]); },
  });
  DivisionThresholdChange.find = () => ({
    lean: async () => [{
      division: "division-1",
      effectiveDate: new Date("2000-01-01T00:00:00.000Z"),
      breakMinutes: 45,
      revenueRatio: 1,
    }],
  });

  try {
    const response = responseRecorder();
    await listDivisions({ user: { role: "ELT" }, query: {} }, response);
    assert.deepEqual(response.body.divisions[0].thresholds, { breakMinutes: 45, revenueRatio: 1 });
    assert.deepEqual(division.thresholds, { breakMinutes: 30, revenueRatio: 0.9 });
  } finally {
    Division.find = originalFind;
    DivisionThresholdChange.find = originalHistoryFind;
  }
});

test("creating a division immediately seeds its default Operations KPI settings and threshold history", async () => {
  const originalCreate = Division.create;
  const originalBulkWrite = OperationsKpiSetting.bulkWrite;
  const originalThresholdCreate = DivisionThresholdChange.create;
  const division = { _id: "division-new", code: "DIV_20", name: "Division 20", active: true };
  let operations = [];
  let seededThreshold = null;
  Division.create = async () => division;
  OperationsKpiSetting.bulkWrite = async (items) => {
    operations = items;
  };
  DivisionThresholdChange.create = async (payload) => { seededThreshold = payload; };

  try {
    const response = responseRecorder();
    await createDivision(
      {
        body: {
          code: "DIV_20",
          name: "Division 20",
          timezone: "America/New_York",
          thresholds: { breakMinutes: 30, revenueRatio: 0.9 },
        },
        user: { _id: "user-1" },
      },
      response
    );

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.division, division);
    assert.equal(operations.length, 9);
    assert.ok(operations.every((operation) => operation.updateOne.filter.division === "division-new"));
    assert.equal(seededThreshold.division, "division-new");
    assert.equal(seededThreshold.breakMinutes, 30);
    assert.equal(seededThreshold.revenueRatio, 0.9);
  } finally {
    Division.create = originalCreate;
    OperationsKpiSetting.bulkWrite = originalBulkWrite;
    DivisionThresholdChange.create = originalThresholdCreate;
  }
});

test("creating a division without explicit break minutes and revenue ratio is rejected", async () => {
  const originalCreate = Division.create;
  let created = false;
  Division.create = async () => { created = true; };

  try {
    const response = responseRecorder();
    await createDivision(
      { body: { code: "DIV_21", name: "Division 21", timezone: "America/New_York" } },
      response
    );
    assert.equal(response.statusCode, 400);
    assert.equal(created, false);
  } finally {
    Division.create = originalCreate;
  }
});

test("updating a division cannot blank out break minutes or revenue ratio to fall back to a shared default", async () => {
  const originalFindById = Division.findById;
  const originalUpsert = DivisionThresholdChange.findOneAndUpdate;
  const originalHistoryFind = DivisionThresholdChange.find;
  const originalRunCutFind = RunCut.find;
  let saved = 0;
  const division = {
    _id: "division-1",
    timezone: "America/New_York",
    thresholds: { breakMinutes: 30, revenueRatio: 0.9 },
    async save() { saved += 1; },
  };
  let storedEntry = null;
  Division.findById = async () => division;
  DivisionThresholdChange.findOneAndUpdate = async (filter, update) => {
    storedEntry = { effectiveDate: filter.effectiveDate, ...update };
    return storedEntry;
  };
  DivisionThresholdChange.find = () => ({ sort: () => ({ lean: async () => (storedEntry ? [storedEntry] : []) }) });
  RunCut.find = async () => [];

  try {
    const blankBreak = responseRecorder();
    await updateDivision(
      {
        params: { id: "division-1" },
        body: { thresholds: { breakMinutes: null } },
        user: { role: "ELT" },
      },
      blankBreak
    );
    assert.equal(blankBreak.statusCode, 400);
    assert.equal(division.thresholds.breakMinutes, 30);
    assert.equal(saved, 0);

    const updated = responseRecorder();
    await updateDivision(
      {
        params: { id: "division-1", _id: "division-1" },
        body: { thresholds: { breakMinutes: 45, revenueRatio: 1 } },
        user: { role: "ELT", _id: "user-1" },
      },
      updated
    );
    assert.equal(updated.statusCode, 200);
    assert.equal(division.thresholds.breakMinutes, 45);
    assert.equal(division.thresholds.revenueRatio, 1);
    assert.equal(saved, 1);
  } finally {
    Division.findById = originalFindById;
    DivisionThresholdChange.findOneAndUpdate = originalUpsert;
    DivisionThresholdChange.find = originalHistoryFind;
    RunCut.find = originalRunCutFind;
  }
});

test("scheduling a future break minutes / revenue ratio change does not affect what's effective today", async () => {
  const originalFindById = Division.findById;
  const originalUpsert = DivisionThresholdChange.findOneAndUpdate;
  const originalHistoryFind = DivisionThresholdChange.find;
  const originalRunCutFind = RunCut.find;
  const division = {
    _id: "division-1",
    timezone: "America/New_York",
    thresholds: { breakMinutes: 30, revenueRatio: 0.9 },
    async save() {},
  };
  let upsertFilter = null;
  let upsertUpdate = null;
  Division.findById = async () => division;
  DivisionThresholdChange.findOneAndUpdate = async (filter, update) => {
    upsertFilter = filter;
    upsertUpdate = update;
    return null;
  };
  // Nothing effective yet for today except the division's own pre-history
  // value — the future entry just scheduled hasn't started applying.
  DivisionThresholdChange.find = () => ({ sort: () => ({ lean: async () => [] }) });
  let recomputeCalled = false;
  RunCut.find = async () => { recomputeCalled = true; return []; };

  try {
    const response = responseRecorder();
    await updateDivision(
      {
        params: { id: "division-1" },
        body: { thresholds: { breakMinutes: 45, revenueRatio: 1, effectiveDate: "2099-01-01" } },
        user: { role: "ELT", _id: "user-1" },
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(upsertFilter.division, "division-1");
    assert.equal(upsertFilter.effectiveDate.toISOString().slice(0, 10), "2099-01-01");
    assert.equal(upsertUpdate.breakMinutes, 45);
    assert.equal(upsertUpdate.revenueRatio, 1);
    // Today's cached value is unchanged since the scheduled change is future-dated.
    assert.equal(division.thresholds.breakMinutes, 30);
    assert.equal(division.thresholds.revenueRatio, 0.9);
    assert.ok(recomputeCalled, "run cuts are still re-projected so the future date lands once it arrives");
  } finally {
    Division.findById = originalFindById;
    DivisionThresholdChange.findOneAndUpdate = originalUpsert;
    DivisionThresholdChange.find = originalHistoryFind;
    RunCut.find = originalRunCutFind;
  }
});

test("a future threshold can return to today's values after an intermediate scheduled change", async () => {
  const originalFindById = Division.findById;
  const originalUpsert = DivisionThresholdChange.findOneAndUpdate;
  const originalHistoryFind = DivisionThresholdChange.find;
  const originalRunCutFind = RunCut.find;
  const division = {
    _id: "division-1",
    timezone: "America/New_York",
    thresholds: { breakMinutes: 30, revenueRatio: 0.9 },
    async save() {},
  };
  const history = [{
    _id: "scheduled-change",
    division: "division-1",
    effectiveDate: new Date("2099-01-01T00:00:00.000Z"),
    breakMinutes: 45,
    revenueRatio: 1,
  }];
  let savedChange = null;
  Division.findById = async () => division;
  DivisionThresholdChange.find = () => ({
    sort: () => ({ lean: async () => [...history].sort((a, b) => b.effectiveDate - a.effectiveDate) }),
  });
  DivisionThresholdChange.findOneAndUpdate = async (filter, update) => {
    savedChange = { ...filter, ...update };
    history.push({ ...filter, ...update });
  };
  RunCut.find = async () => [];

  try {
    const response = responseRecorder();
    await updateDivision(
      {
        params: { id: "division-1" },
        body: { thresholds: { breakMinutes: 30, revenueRatio: 0.9, effectiveDate: "2099-02-01" } },
        user: { role: "ELT", _id: "user-1" },
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(savedChange.effectiveDate.toISOString().slice(0, 10), "2099-02-01");
    assert.equal(savedChange.breakMinutes, 30);
    assert.equal(savedChange.revenueRatio, 0.9);
    assert.equal(division.thresholds.breakMinutes, 30);
    assert.equal(division.thresholds.revenueRatio, 0.9);
  } finally {
    Division.findById = originalFindById;
    DivisionThresholdChange.findOneAndUpdate = originalUpsert;
    DivisionThresholdChange.find = originalHistoryFind;
    RunCut.find = originalRunCutFind;
  }
});

test("past threshold dates are rejected so historical calculations cannot be rewritten", async () => {
  const originalFindById = Division.findById;
  const originalUpsert = DivisionThresholdChange.findOneAndUpdate;
  const division = {
    _id: "division-1",
    timezone: "America/New_York",
    thresholds: { breakMinutes: 30, revenueRatio: 0.9 },
    async save() {},
  };
  let upsertCalled = false;
  Division.findById = async () => division;
  DivisionThresholdChange.findOneAndUpdate = async () => { upsertCalled = true; };

  try {
    const response = responseRecorder();
    await updateDivision(
      {
        params: { id: "division-1" },
        body: { thresholds: { breakMinutes: 45, revenueRatio: 1, effectiveDate: "2000-01-01" } },
        user: { role: "ELT", _id: "user-1" },
      },
      response
    );

    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /cannot be in the past/i);
    assert.equal(upsertCalled, false);
  } finally {
    Division.findById = originalFindById;
    DivisionThresholdChange.findOneAndUpdate = originalUpsert;
  }
});

test("resaving a division's unchanged break minutes and revenue ratio does not schedule a threshold change or recompute run cuts", async () => {
  const originalFindById = Division.findById;
  const originalUpsert = DivisionThresholdChange.findOneAndUpdate;
  const originalHistoryFind = DivisionThresholdChange.find;
  const originalRunCutFind = RunCut.find;
  const division = {
    _id: "division-1",
    name: "Old Name",
    timezone: "America/New_York",
    thresholds: { breakMinutes: 30, revenueRatio: 0.9 },
    async save() {},
  };
  let upsertCalled = false;
  let runCutFindCalled = false;
  Division.findById = async () => division;
  DivisionThresholdChange.find = () => ({ sort: () => ({ lean: async () => [] }) });
  DivisionThresholdChange.findOneAndUpdate = async () => { upsertCalled = true; return null; };
  RunCut.find = async () => { runCutFindCalled = true; return []; };

  try {
    const response = responseRecorder();
    await updateDivision(
      {
        params: { id: "division-1" },
        body: {
          name: "New Name",
          thresholds: { breakMinutes: 30, revenueRatio: 0.9 },
        },
        user: { role: "ELT", _id: "user-1" },
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(division.name, "New Name");
    assert.equal(upsertCalled, false);
    assert.equal(runCutFindCalled, false);
  } finally {
    Division.findById = originalFindById;
    DivisionThresholdChange.findOneAndUpdate = originalUpsert;
    DivisionThresholdChange.find = originalHistoryFind;
    RunCut.find = originalRunCutFind;
  }
});

test("retiring a division is an ELT-only soft change", async () => {
  const originalFindById = Division.findById;
  let saved = 0;
  const division = {
    _id: "division-1",
    active: true,
    thresholds: {},
    async save() { saved += 1; },
  };
  Division.findById = async () => division;

  try {
    const denied = responseRecorder();
    await updateDivision(
      {
        params: { id: "division-1" },
        body: { active: false },
        user: { role: "Manager", divisionAccess: ["division-1"] },
      },
      denied
    );
    assert.equal(denied.statusCode, 403);
    assert.equal(saved, 0);

    const retired = responseRecorder();
    await updateDivision(
      { params: { id: "division-1" }, body: { active: false }, user: { role: "ELT" } },
      retired
    );
    assert.equal(retired.statusCode, 200);
    assert.equal(division.active, false);
    assert.equal(saved, 1);
  } finally {
    Division.findById = originalFindById;
  }
});

test("only ELT can rename a division", async () => {
  const originalFindById = Division.findById;
  let saved = 0;
  const division = {
    _id: "division-1",
    name: "Old Division Name",
    thresholds: {},
    async save() { saved += 1; },
  };
  Division.findById = async () => division;

  try {
    const denied = responseRecorder();
    await updateDivision({
      params: { id: "division-1" },
      body: { name: "Unauthorized Rename" },
      user: { role: "Manager", divisionAccess: ["division-1"] },
    }, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(division.name, "Old Division Name");
    assert.equal(saved, 0);

    const renamed = responseRecorder();
    await updateDivision({
      params: { id: "division-1" },
      body: { name: "  Central Operations  " },
      user: { role: "ELT" },
    }, renamed);
    assert.equal(renamed.statusCode, 200);
    assert.equal(division.name, "Central Operations");
    assert.equal(saved, 1);
  } finally {
    Division.findById = originalFindById;
  }
});

test("permanently deleting a division removes its owned data and access references", async () => {
  const originalFindById = Division.findById;
  const originalDivisionDeleteOne = Division.deleteOne;
  const originalDivisionUpdateMany = Division.updateMany;
  const originalUserUpdateMany = User.updateMany;
  const originalChangeLogDeleteMany = ChangeLog.deleteMany;
  const originalOwnedDeleteMany = DIVISION_OWNED_MODELS.map((Model) => [Model, Model.deleteMany]);
  const originalTransaction = mongoose.connection.transaction;
  const deletedFilters = [];
  const division = { _id: "division-1", code: "DIV_1", active: true };
  Division.findById = async () => division;
  Division.deleteOne = async (filter) => { deletedFilters.push(["division", filter]); };
  Division.updateMany = async (filter, update) => { deletedFilters.push(["children", filter, update]); };
  User.updateMany = async (filter, update) => { deletedFilters.push(["users", filter, update]); };
  ChangeLog.deleteMany = async (filter) => { deletedFilters.push(["changes", filter]); };
  DIVISION_OWNED_MODELS.forEach((Model) => {
    Model.deleteMany = async (filter) => { deletedFilters.push([Model.modelName, filter]); };
  });
  mongoose.connection.transaction = async (work) => work();

  try {
    const rejected = responseRecorder();
    await deleteDivision({ params: { id: "division-1" }, body: {} }, rejected);
    assert.equal(rejected.statusCode, 400);
    assert.equal(deletedFilters.length, 0);

    const response = responseRecorder();
    await deleteDivision(
      { params: { id: "division-1" }, body: { confirmationCode: "DIV_1" } },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.deletedDivisionId, "division-1");
    assert.match(response.body.message, /permanently deleted/i);
    assert.equal(
      deletedFilters.filter(([kind]) => kind === "division").length,
      1
    );
    assert.equal(
      deletedFilters.filter(([, filter]) => filter?.division === "division-1").length,
      DIVISION_OWNED_MODELS.length
    );
    assert.ok(deletedFilters.some(([kind]) => kind === "users"));
    assert.ok(deletedFilters.some(([kind]) => kind === "children"));
  } finally {
    Division.findById = originalFindById;
    Division.deleteOne = originalDivisionDeleteOne;
    Division.updateMany = originalDivisionUpdateMany;
    User.updateMany = originalUserUpdateMany;
    ChangeLog.deleteMany = originalChangeLogDeleteMany;
    mongoose.connection.transaction = originalTransaction;
    originalOwnedDeleteMany.forEach(([Model, deleteMany]) => { Model.deleteMany = deleteMany; });
  }
});
