import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "../db/sqlMongoose.js";
import Route from "../models/Route.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import PermanentOsrChange from "../models/PermanentOsrChange.js";
import { createRoute, deleteRoute } from "./routesController.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("route creation stores an explicit standby type", async () => {
  const originalFindOne = Route.findOne;
  const originalCreate = Route.create;
  let created;
  Route.findOne = async () => null;
  Route.create = async (payload) => { created = payload; return { _id: "route-1", ...payload }; };
  try {
    const res = response();
    await createRoute(
      { user: { role: "ELT", divisionAccess: [] }, body: { division: "division-1", code: "111(STBY)", type: "standby" } },
      res
    );
    assert.equal(res.statusCode, 201);
    assert.equal(created.type, "standby");
    assert.equal(created.code, "111(STBY)");
  } finally {
    Route.findOne = originalFindOne;
    Route.create = originalCreate;
  }
});

test("route removal retires the route while preserving its historical identity", async () => {
  const originals = {
    findById: Route.findById,
    findDays: RunCutDay.find,
    updateDays: RunCutDay.updateMany,
    deleteDays: RunCutDay.deleteMany,
    deleteIssues: DailyIssueLog.deleteMany,
    deleteRunCut: RunCut.deleteOne,
    deletePermanentOsrs: PermanentOsrChange.deleteMany,
    transaction: mongoose.connection.transaction,
  };
  let saved = false;
  let hardDeleted = false;
  const route = {
    _id: "route-1",
    division: "division-1",
    active: true,
    async save() { saved = true; },
    async deleteOne() { hardDeleted = true; },
  };
  Route.findById = async () => route;
  RunCutDay.find = async () => [];
  RunCutDay.updateMany = async () => ({});
  RunCutDay.deleteMany = async () => ({});
  DailyIssueLog.deleteMany = async () => ({});
  RunCut.deleteOne = async () => ({});
  PermanentOsrChange.deleteMany = async () => ({});
  mongoose.connection.transaction = async (work) => work();
  try {
    const res = response();
    await deleteRoute({ user: { role: "ELT", divisionAccess: [] }, params: { id: "route-1" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(route.active, false);
    assert.equal(saved, true);
    assert.equal(hardDeleted, false);
  } finally {
    Route.findById = originals.findById;
    RunCutDay.find = originals.findDays;
    RunCutDay.updateMany = originals.updateDays;
    RunCutDay.deleteMany = originals.deleteDays;
    DailyIssueLog.deleteMany = originals.deleteIssues;
    RunCut.deleteOne = originals.deleteRunCut;
    PermanentOsrChange.deleteMany = originals.deletePermanentOsrs;
    mongoose.connection.transaction = originals.transaction;
  }
});
