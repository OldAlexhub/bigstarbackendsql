import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "../db/sqlMongoose.js";
import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
import Division from "../models/Division.js";
import PermanentOsrChange from "../models/PermanentOsrChange.js";
import RunCut from "../models/RunCut.js";
import { updateRunCutPermanentOsr } from "./runCutsController.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const queryReturning = (value) => ({
  populate() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

test("a future Permanent OSR is scheduled without changing today's Master Run Cut", async () => {
  const originals = {
    transaction: mongoose.connection.transaction,
    findRunCut: RunCut.findById,
    findRunCuts: RunCut.find,
    findDivision: Division.findById,
    findScheduled: PermanentOsrChange.findOne,
    createScheduled: PermanentOsrChange.create,
    createActivity: DeploymentActivityLog.create,
  };
  let saved = false;
  let scheduled;
  const runCut = {
    _id: "run-cut-1",
    division: "division-1",
    route: { _id: "route-1", code: "1029-B", type: "standard" },
    daysOfWeek: ["MON"],
    operator: null,
    vehicle: null,
    pulloutAddress: "100 Main St",
    startTime: "06:00",
    endTime: "18:00",
    status: "active",
    clientNotes: "",
    disruptionType: null,
    disruptionNotes: "",
    async save() { saved = true; },
  };

  mongoose.connection.transaction = async (work) => work();
  RunCut.findById = () => queryReturning(runCut);
  RunCut.find = async () => [];
  Division.findById = async () => ({ _id: "division-1", timezone: "America/New_York" });
  PermanentOsrChange.findOne = () => ({ select: async () => null });
  PermanentOsrChange.create = async (payload) => { scheduled = payload; return payload; };
  DeploymentActivityLog.create = async () => ({});

  try {
    const res = response();
    await updateRunCutPermanentOsr(
      {
        params: { id: "run-cut-1" },
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        body: {
          effectiveDate: "2099-01-01",
          startTime: "07:00",
          disruptionNotes: "Future client service change",
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.applied, false);
    assert.equal(res.body.effectiveDate.toISOString().slice(0, 10), "2099-01-01");
    assert.equal(scheduled.runCut, "run-cut-1");
    assert.equal(scheduled.startTime, "07:00");
    assert.equal(scheduled.effectiveDate.toISOString().slice(0, 10), "2099-01-01");
    assert.equal(saved, false);
    assert.equal(runCut.startTime, "06:00");
  } finally {
    mongoose.connection.transaction = originals.transaction;
    RunCut.findById = originals.findRunCut;
    RunCut.find = originals.findRunCuts;
    Division.findById = originals.findDivision;
    PermanentOsrChange.findOne = originals.findScheduled;
    PermanentOsrChange.create = originals.createScheduled;
    DeploymentActivityLog.create = originals.createActivity;
  }
});
