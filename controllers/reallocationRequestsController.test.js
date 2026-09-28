import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "../db/sqlMongoose.js";
import RunCut from "../models/RunCut.js";
import Operator from "../models/Operator.js";
import Vehicle from "../models/Vehicle.js";
import ReallocationRequest from "../models/ReallocationRequest.js";
import { createReallocationRequest } from "./reallocationRequestsController.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const queryFor = (value) => {
  const query = {
    populate() { return query; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return query;
};

test("a destination route must still be unassigned when the request is submitted", async () => {
  const originalFindById = RunCut.findById;
  const division = new mongoose.Types.ObjectId();
  const currentId = new mongoose.Types.ObjectId();
  const destinationId = new mongoose.Types.ObjectId();
  const values = [
    {
      _id: currentId,
      division,
      route: { _id: new mongoose.Types.ObjectId(), code: "101" },
      operator: { _id: new mongoose.Types.ObjectId(), name: "Alex Driver" },
      vehicle: null,
      pulloutAddress: "",
    },
    {
      _id: destinationId,
      division,
      route: { _id: new mongoose.Types.ObjectId(), code: "202" },
      operator: { _id: new mongoose.Types.ObjectId(), name: "Already Assigned" },
      vehicle: null,
      pulloutAddress: "",
    },
  ];
  RunCut.findById = () => queryFor(values.shift());

  try {
    const res = response();
    await createReallocationRequest({
      user: { _id: new mongoose.Types.ObjectId(), role: "ELT", name: "Admin", username: "admin" },
      body: {
        division: String(division),
        runCut: String(currentId),
        destinationRunCut: String(destinationId),
        effectiveDate: "2026-09-14",
        operatorName: "",
        vehicleCode: "",
        pulloutAddress: "",
      },
    }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /already assigned/i);
  } finally {
    RunCut.findById = originalFindById;
  }
});

test("a blank-operator destination must also have Unassigned Master Run Cut status", async () => {
  const originalFindById = RunCut.findById;
  const division = new mongoose.Types.ObjectId();
  const currentId = new mongoose.Types.ObjectId();
  const destinationId = new mongoose.Types.ObjectId();
  const values = [
    {
      _id: currentId,
      division,
      status: "active",
      route: { _id: new mongoose.Types.ObjectId(), code: "101" },
      operator: { _id: new mongoose.Types.ObjectId(), name: "Alex Driver" },
      vehicle: null,
      pulloutAddress: "",
    },
    {
      _id: destinationId,
      division,
      status: "active",
      route: { _id: new mongoose.Types.ObjectId(), code: "202" },
      operator: null,
      vehicle: null,
      pulloutAddress: "",
    },
  ];
  RunCut.findById = () => queryFor(values.shift());

  try {
    const res = response();
    await createReallocationRequest({
      user: { _id: new mongoose.Types.ObjectId(), role: "ELT", name: "Admin", username: "admin" },
      body: {
        division: String(division),
        runCut: String(currentId),
        destinationRunCut: String(destinationId),
        effectiveDate: "2026-09-14",
        operatorName: "",
        vehicleCode: "",
        pulloutAddress: "",
      },
    }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /marked Unassigned in Master Run Cuts/i);
  } finally {
    RunCut.findById = originalFindById;
  }
});

test("a replacement assignment is canonicalized from the division's active driver and vehicle rosters", async () => {
  const originals = {
    findRunCut: RunCut.findById,
    findOperator: Operator.findOne,
    findVehicle: Vehicle.findOne,
    findDuplicate: ReallocationRequest.findOne,
    create: ReallocationRequest.create,
    findRequest: ReallocationRequest.findById,
  };
  const division = new mongoose.Types.ObjectId();
  const currentId = new mongoose.Types.ObjectId();
  const createdId = new mongoose.Types.ObjectId();
  let createdPayload;
  RunCut.findById = () => queryFor({
    _id: currentId,
    division,
    status: "active",
    route: { _id: new mongoose.Types.ObjectId(), code: "101" },
    operator: { _id: new mongoose.Types.ObjectId(), name: "Original Driver" },
    vehicle: { _id: new mongoose.Types.ObjectId(), code: "OLD-1" },
    pulloutAddress: "Original Garage",
  });
  Operator.findOne = async () => ({
    _id: new mongoose.Types.ObjectId(),
    name: "Roster Driver",
    pulloutAddress: "Roster Depot",
    active: true,
  });
  Vehicle.findOne = async () => ({ _id: new mongoose.Types.ObjectId(), code: "BUS-7", active: true });
  ReallocationRequest.findOne = () => ({ select: async () => null });
  ReallocationRequest.create = async (payload) => {
    createdPayload = payload;
    return { _id: createdId };
  };
  ReallocationRequest.findById = () => queryFor({ _id: createdId, status: "pending" });

  try {
    const res = response();
    await createReallocationRequest({
      user: { _id: new mongoose.Types.ObjectId(), role: "ELT", name: "Admin", username: "admin" },
      body: {
        division: String(division),
        runCut: String(currentId),
        effectiveDate: "2026-09-14",
        operatorName: " roster driver ",
        vehicleCode: "bus-7",
        pulloutAddress: "Uncontrolled Address",
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(createdPayload.requestedOperatorName, "Roster Driver");
    assert.equal(createdPayload.requestedVehicleCode, "BUS-7");
    assert.equal(createdPayload.requestedPulloutAddress, "Roster Depot");
  } finally {
    RunCut.findById = originals.findRunCut;
    Operator.findOne = originals.findOperator;
    Vehicle.findOne = originals.findVehicle;
    ReallocationRequest.findOne = originals.findDuplicate;
    ReallocationRequest.create = originals.create;
    ReallocationRequest.findById = originals.findRequest;
  }
});

test("a replacement operator outside the division roster is rejected at submission", async () => {
  const originalFindRunCut = RunCut.findById;
  const originalFindOperator = Operator.findOne;
  const division = new mongoose.Types.ObjectId();
  const currentId = new mongoose.Types.ObjectId();
  RunCut.findById = () => queryFor({
    _id: currentId,
    division,
    status: "active",
    route: { _id: new mongoose.Types.ObjectId(), code: "101" },
    operator: null,
    vehicle: null,
    pulloutAddress: "",
  });
  Operator.findOne = async () => null;

  try {
    const res = response();
    await createReallocationRequest({
      user: { _id: new mongoose.Types.ObjectId(), role: "ELT", name: "Admin", username: "admin" },
      body: {
        division: String(division),
        runCut: String(currentId),
        effectiveDate: "2026-09-14",
        operatorName: "Unknown Driver",
        vehicleCode: "",
        pulloutAddress: "Typed Address",
      },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Drivers roster/i);
  } finally {
    RunCut.findById = originalFindRunCut;
    Operator.findOne = originalFindOperator;
  }
});
