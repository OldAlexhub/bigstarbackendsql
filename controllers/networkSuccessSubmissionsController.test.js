import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "../db/sqlMongoose.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import NetworkRouteAlias from "../models/NetworkRouteAlias.js";
import NetworkSubmission from "../models/NetworkSubmission.js";
import Operator from "../models/Operator.js";
import Provider from "../models/Provider.js";
import Route from "../models/Route.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import {
  previewSubmission,
  removeSubmission,
  reopenSubmission,
  updatePerformanceAssignment,
} from "./networkSuccessSubmissionsController.js";

const transaction = mongoose.connection.transaction;
test.beforeEach(() => {
  mongoose.connection.transaction = async (work) => work();
});
test.afterEach(() => {
  mongoose.connection.transaction = transaction;
});

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("reusable Network Success corrections update Master Run Cuts and the operator directory", async () => {
  const originals = {
    findEntry: NetworkKpiEntry.findById,
    findOperator: Operator.findById,
    findProvider: Provider.findById,
    findRunCut: RunCut.findOne,
  };
  const entry = {
    _id: "entry-1",
    division: "division-1",
    route: "route-1",
    assignmentOverride: null,
    assignmentAudit: [],
    async save() {},
  };
  const operator = {
    _id: "operator-1",
    name: "Correct Operator",
    division: "division-1",
    pulloutAddress: "100 Depot Way",
    provider: null,
    active: true,
    async save() {},
  };
  const runCut = { operator: null, async save() {} };
  NetworkKpiEntry.findById = async () => entry;
  Operator.findById = () => ({ populate: async () => operator });
  Provider.findById = async () => ({ _id: "provider-1", name: "Correct Provider" });
  RunCut.findOne = async () => runCut;
  try {
    const res = response();
    await updatePerformanceAssignment(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "entry-1" },
        body: { operatorId: "operator-1", providerId: "provider-1", reuseAssignment: true },
      },
      res
    );
    assert.equal(String(runCut.operator), "operator-1");
    assert.equal(runCut.pulloutAddress, "100 Depot Way");
    assert.equal(String(operator.provider), "provider-1");
    assert.equal(entry.assignmentOverride, null);
    assert.equal(entry.assignmentAudit[0].scope, "master_run_cuts");
    assert.equal(res.body.reused, true);
  } finally {
    NetworkKpiEntry.findById = originals.findEntry;
    Operator.findById = originals.findOperator;
    Provider.findById = originals.findProvider;
    RunCut.findOne = originals.findRunCut;
  }
});

test("Network Success assignment corrections are stored separately and audited", async () => {
  const originals = {
    findEntry: NetworkKpiEntry.findById,
    findOperator: Operator.findById,
    findProvider: Provider.findById,
  };
  const entry = {
    _id: "entry-1",
    division: "division-1",
    assignmentOverride: null,
    assignmentAudit: [],
    async save() {},
  };
  NetworkKpiEntry.findById = async () => entry;
  Operator.findById = () => ({ populate: async () => ({
    _id: "operator-1",
    name: "Correct Operator",
    division: "division-1",
    provider: null,
    active: true,
  }) });
  Provider.findById = async () => ({ _id: "provider-1", name: "Correct Provider" });
  try {
    const res = response();
    await updatePerformanceAssignment(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "entry-1" },
        body: { operatorId: "operator-1", providerId: "provider-1" },
      },
      res
    );
    assert.equal(entry.assignmentOverride.operatorName, "Correct Operator");
    assert.equal(entry.assignmentOverride.providerName, "Correct Provider");
    assert.equal(entry.assignmentAudit.length, 1);
    assert.equal(entry.assignmentAudit[0].before, null);

    await updatePerformanceAssignment(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "entry-1" },
        body: { useMasterRunCut: true },
      },
      response()
    );
    assert.equal(entry.assignmentOverride, null);
    assert.equal(entry.assignmentAudit.length, 2);
  } finally {
    NetworkKpiEntry.findById = originals.findEntry;
    Operator.findById = originals.findOperator;
    Provider.findById = originals.findProvider;
  }
});

test("removing a confirmed submission permanently deletes its active entries and the submission record", async () => {
  const originals = {
    findSubmission: NetworkSubmission.findById,
    findEntries: NetworkKpiEntry.find,
    deleteEntries: NetworkKpiEntry.deleteMany,
    deleteSubmission: NetworkSubmission.deleteOne,
  };
  const submission = {
    _id: "submission-1",
    status: "confirmed",
    division: "division-1",
    createdBy: "user-1",
    parsedRows: [{ id: "raw" }],
    previewRows: [{ id: "preview" }],
    changeAudit: [],
  };
  const entries = [{ _id: "entry-1", submission: "submission-1", date: "2026-09-08" }];
  let deleteEntriesFilter = null;
  let deleteSubmissionFilter = null;
  NetworkSubmission.findById = async () => submission;
  NetworkKpiEntry.find = () => ({ lean: async () => entries });
  NetworkKpiEntry.deleteMany = async (filter) => { deleteEntriesFilter = filter; return { deletedCount: 1 }; };
  NetworkSubmission.deleteOne = async (filter) => { deleteSubmissionFilter = filter; return { deletedCount: 1 }; };
  try {
    const res = response();
    await removeSubmission(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "submission-1" },
      },
      res
    );
    assert.deepEqual(deleteEntriesFilter, { submission: "submission-1" });
    assert.deepEqual(deleteSubmissionFilter, { _id: "submission-1" });
    assert.equal(res.body.removedEntries, 1);
    assert.match(res.body.message, /permanently deleted/);
  } finally {
    NetworkSubmission.findById = originals.findSubmission;
    NetworkKpiEntry.find = originals.findEntries;
    NetworkKpiEntry.deleteMany = originals.deleteEntries;
    NetworkSubmission.deleteOne = originals.deleteSubmission;
  }
});

test("submission ownership does not bypass the assigned division boundary", async () => {
  const originalFindSubmission = NetworkSubmission.findById;
  const originalDeleteSubmission = NetworkSubmission.deleteOne;
  const submission = {
    _id: "submission-1",
    status: "confirmed",
    division: "division-2",
    createdBy: "user-1",
  };
  let deleteCalled = false;
  NetworkSubmission.findById = async () => submission;
  NetworkSubmission.deleteOne = async () => { deleteCalled = true; };
  try {
    const res = response();
    await removeSubmission(
      {
        user: { _id: "user-1", role: "Coordinator", divisionAccess: ["division-1"] },
        params: { id: "submission-1" },
      },
      res
    );
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /division/);
    assert.equal(deleteCalled, false);
  } finally {
    NetworkSubmission.findById = originalFindSubmission;
    NetworkSubmission.deleteOne = originalDeleteSubmission;
  }
});

test("opening a confirmed submission creates one editable revision and preserves the original", async () => {
  const originals = {
    findSubmission: NetworkSubmission.findById,
    findRevision: NetworkSubmission.findOne,
    createSubmission: NetworkSubmission.create,
  };
  const original = {
    _id: "submission-1",
    source: "vision",
    status: "confirmed",
    division: "division-1",
    createdBy: "user-1",
    files: [{ kind: "vision", name: "report.xlsx", size: 100, sha256: "hash" }],
    divisionCandidates: [{ division: "division-1" }],
    parsedRows: [{ id: "row-1", sourceRoute: "1001" }],
    blockedDates: [],
    reportDates: ["2026-09-08"],
    warnings: [],
    counts: { sourceRows: 1, zeroTripRows: 0 },
    changeAudit: [],
    async save() {},
  };
  let createdPayload = null;
  NetworkSubmission.findById = async () => original;
  NetworkSubmission.findOne = async () => null;
  NetworkSubmission.create = async (payload) => {
    createdPayload = payload;
    return { _id: "revision-1", ...payload };
  };
  try {
    const res = response();
    await reopenSubmission(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "submission-1" },
      },
      res
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.submission.id, "revision-1");
    assert.equal(createdPayload.status, "pending");
    assert.equal(createdPayload.reopenedFrom, "submission-1");
    assert.deepEqual(createdPayload.parsedRows, original.parsedRows);
    assert.equal(original.status, "confirmed");
    assert.equal(original.changeAudit[0].action, "reopened_as_revision");
  } finally {
    NetworkSubmission.findById = originals.findSubmission;
    NetworkSubmission.findOne = originals.findRevision;
    NetworkSubmission.create = originals.createSubmission;
  }
});

const emptyLeanChain = () => ({ lean: async () => [] });

test("Spare submissions auto-create unmatched routes as extra revenue routes instead of blocking", async () => {
  const originals = {
    findSubmission: NetworkSubmission.findById,
    findRoutes: Route.find,
    findOneRoute: Route.findOne,
    createRoute: Route.create,
    findAliases: NetworkRouteAlias.find,
    findRunCutDays: RunCutDay.find,
    findIssues: DailyIssueLog.find,
    findOperators: Operator.find,
    findRunCuts: RunCut.find,
    findKpiEntries: NetworkKpiEntry.find,
  };
  const submission = {
    _id: "submission-1",
    source: "spare",
    status: "pending",
    division: null,
    createdBy: "user-1",
    parsedRows: [
      {
        id: "spare-2",
        sourceRow: 2,
        date: "2026-09-10",
        sourceRoute: "555",
        sourceOperator: null,
        completedTrips: 5,
        reportedServiceHours: 4,
        reportedRevenueHours: 3.5,
        tpsh: null,
        otpPct: 92,
        zeroTrips: false,
        sourceFields: {},
      },
    ],
    blockedDates: [],
    reportDates: ["2026-09-10"],
    warnings: [],
    counts: { sourceRows: 1, zeroTripRows: 0 },
    async save() {},
  };
  let createdRoutePayload = null;
  NetworkSubmission.findById = async () => submission;
  Route.find = () => ({ sort: () => emptyLeanChain() });
  Route.findOne = async () => null;
  Route.create = async (payload) => {
    createdRoutePayload = payload;
    return { _id: "route-new-1", division: payload.division, code: payload.code, type: "revenue" };
  };
  NetworkRouteAlias.find = () => emptyLeanChain();
  RunCutDay.find = () => ({ populate: () => emptyLeanChain() });
  DailyIssueLog.find = () => emptyLeanChain();
  Operator.find = () => ({ populate: () => emptyLeanChain() });
  RunCut.find = () => ({ populate: () => emptyLeanChain() });
  NetworkKpiEntry.find = () => ({ select: () => emptyLeanChain() });
  try {
    const res = response();
    await previewSubmission(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "submission-1" },
        body: { division: "division-1" },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(createdRoutePayload.division, "division-1");
    assert.equal(createdRoutePayload.code, "555");
    assert.equal(res.body.rows.length, 1);
    const [row] = res.body.rows;
    assert.equal(row.matchMethod, "extra_revenue_route");
    assert.equal(row.severity, "extra");
    assert.equal(row.matchedRouteId, "route-new-1");
    assert.equal(row.matchedRoute, "555");
    assert.match(row.matchReason, /added as a one-off extra revenue route/);
    assert.equal(submission.status, "matched");
  } finally {
    NetworkSubmission.findById = originals.findSubmission;
    Route.find = originals.findRoutes;
    Route.findOne = originals.findOneRoute;
    Route.create = originals.createRoute;
    NetworkRouteAlias.find = originals.findAliases;
    RunCutDay.find = originals.findRunCutDays;
    DailyIssueLog.find = originals.findIssues;
    Operator.find = originals.findOperators;
    RunCut.find = originals.findRunCuts;
    NetworkKpiEntry.find = originals.findKpiEntries;
  }
});

test("Vision submissions still require manual review for unmatched routes instead of auto-creating them", async () => {
  const originals = {
    findSubmission: NetworkSubmission.findById,
    findRoutes: Route.find,
    createRoute: Route.create,
    findAliases: NetworkRouteAlias.find,
    findKpiEntries: NetworkKpiEntry.find,
  };
  const submission = {
    _id: "submission-2",
    source: "vision",
    status: "pending",
    division: null,
    createdBy: "user-1",
    parsedRows: [
      {
        id: "vision-2",
        sourceRow: 2,
        date: "2026-09-10",
        sourceRoute: "999",
        sourceOperator: "Some Operator",
        completedTrips: 5,
        reportedServiceHours: 4,
        reportedRevenueHours: 3.5,
        tpsh: 1.25,
        otpPct: 92,
        zeroTrips: false,
        sourceFields: {},
      },
    ],
    blockedDates: [],
    reportDates: ["2026-09-10"],
    warnings: [],
    counts: { sourceRows: 1, zeroTripRows: 0 },
    async save() {},
  };
  let routeCreated = false;
  NetworkSubmission.findById = async () => submission;
  Route.find = () => ({ sort: () => emptyLeanChain() });
  Route.create = async (payload) => {
    routeCreated = true;
    return { _id: "route-new-2", ...payload };
  };
  NetworkRouteAlias.find = () => emptyLeanChain();
  NetworkKpiEntry.find = () => ({ select: () => emptyLeanChain() });
  try {
    const res = response();
    await previewSubmission(
      {
        user: { _id: "user-1", role: "ELT", divisionAccess: [] },
        params: { id: "submission-2" },
        body: { division: "division-1" },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(routeCreated, false);
    const [row] = res.body.rows;
    assert.equal(row.matchedRouteId, null);
    assert.equal(row.matchMethod, "unmatched");
    assert.equal(row.severity, "blocker");
  } finally {
    NetworkSubmission.findById = originals.findSubmission;
    Route.find = originals.findRoutes;
    Route.create = originals.createRoute;
    NetworkRouteAlias.find = originals.findAliases;
    NetworkKpiEntry.find = originals.findKpiEntries;
  }
});
