import assert from "node:assert/strict";
import test from "node:test";
import Division from "../models/Division.js";
import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import { getLeaderboard } from "./leaderboardController.js";

const response = () => ({
  body: null,
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("leaderboard ranks all active divisions before limiting visible rows", async () => {
  const originalDivisionFind = Division.find;
  const originalRunCutDayFind = RunCutDay.find;
  const originalIssueCount = DailyIssueLog.countDocuments;
  const divisions = [
    { _id: "division-1", code: "D1", name: "Division 1" },
    { _id: "division-6", code: "D6", name: "Division 6" },
  ];
  let divisionFilter;
  const queriedDivisions = [];

  Division.find = (filter) => {
    divisionFilter = filter;
    return { sort: async () => divisions };
  };
  RunCutDay.find = (filter) => {
    queriedDivisions.push(String(filter.division));
    const rows = String(filter.division) === "division-1"
      ? [{ status: "active", revenueHours: 10, route: { type: "standard" } }]
      : [{ status: "unassigned", revenueHours: 10, route: { type: "standard" } }];
    return { populate: async () => rows };
  };
  DailyIssueLog.countDocuments = async () => 0;

  try {
    const res = response();
    await getLeaderboard({
      user: { role: "Manager", divisionAccess: ["division-6"] },
      query: { from: "2026-09-01", to: "2026-09-16" },
    }, res);

    assert.deepEqual(divisionFilter, { active: true });
    assert.deepEqual(queriedDivisions.sort(), ["division-1", "division-6"]);
    assert.equal(res.body.totalDivisions, 2);
    assert.equal(res.body.isCompanyWide, false);
    assert.equal(res.body.divisions.length, 1);
    assert.equal(res.body.divisions[0].divisionId, "division-6");
    assert.equal(res.body.divisions[0].rank, 2);
  } finally {
    Division.find = originalDivisionFind;
    RunCutDay.find = originalRunCutDayFind;
    DailyIssueLog.countDocuments = originalIssueCount;
  }
});
