import assert from "node:assert/strict";
import test from "node:test";
import DailyIssueLog from "../models/DailyIssueLog.js";
import Division from "../models/Division.js";
import { exportDailyIssues, listDailyIssues, listDailyIssuesReport } from "./dailyIssuesController.js";

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  setHeader(name, value) {
    this.headers[name] = value;
  },
  send(body) {
    this.body = body;
    return this;
  },
});

test("report screen and export share exact inclusive date bounds", async () => {
  const originalFindById = Division.findById;
  const originalFind = DailyIssueLog.find;
  const filters = [];
  Division.findById = async () => ({ _id: "division-1", code: "D1" });
  DailyIssueLog.find = (filter) => {
    filters.push(filter);
    const query = {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return Promise.resolve([]);
      },
    };
    return query;
  };

  const baseRequest = {
    user: { role: "ELT" },
    query: { division: "division-1", from: "2026-09-01", to: "2026-09-09" },
  };

  try {
    await listDailyIssuesReport(baseRequest, responseRecorder());
    await exportDailyIssues(
      { ...baseRequest, query: { ...baseRequest.query, format: "csv" } },
      responseRecorder()
    );

    assert.equal(filters.length, 2);
    for (const filter of filters) {
      assert.equal(filter.date.$gte.toISOString(), "2026-09-01T00:00:00.000Z");
      assert.equal(filter.date.$lt.toISOString(), "2026-09-10T00:00:00.000Z");
      assert.equal("$lte" in filter.date, false);
    }

    const reversedResponse = responseRecorder();
    await listDailyIssuesReport(
      {
        user: { role: "ELT" },
        query: { division: "division-1", from: "2026-09-10", to: "2026-09-09" },
      },
      reversedResponse
    );
    assert.equal(reversedResponse.statusCode, 400);
    assert.deepEqual(reversedResponse.body, { message: "from must be on or before to" });
    assert.equal(filters.length, 2);
  } finally {
    Division.findById = originalFindById;
    DailyIssueLog.find = originalFind;
  }
});

test("Issue Log applies the selected inclusive from/to date range", async () => {
  const originalFind = DailyIssueLog.find;
  let receivedFilter;
  DailyIssueLog.find = (filter) => {
    receivedFilter = filter;
    const query = {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return Promise.resolve([]);
      },
    };
    return query;
  };

  try {
    const response = responseRecorder();
    await listDailyIssues(
      {
        user: { role: "ELT" },
        query: { division: "division-1", from: "2026-08-01", to: "2026-08-15" },
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(receivedFilter.date.$gte.toISOString(), "2026-08-01T00:00:00.000Z");
    assert.equal(receivedFilter.date.$lt.toISOString(), "2026-08-16T00:00:00.000Z");

    const incompleteResponse = responseRecorder();
    await listDailyIssues(
      { user: { role: "ELT" }, query: { division: "division-1", from: "2026-08-01" } },
      incompleteResponse
    );
    assert.equal(incompleteResponse.statusCode, 400);
    assert.deepEqual(incompleteResponse.body, { message: "from and to are required together" });
  } finally {
    DailyIssueLog.find = originalFind;
  }
});

test("OSR-only reporting filters the exported issue rows", async () => {
  const originalFindById = Division.findById;
  const originalFind = DailyIssueLog.find;
  let receivedFilter;
  Division.findById = async () => ({ _id: "division-1", code: "D1" });
  DailyIssueLog.find = (filter) => {
    receivedFilter = filter;
    return {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return Promise.resolve([]);
      },
    };
  };

  try {
    const response = responseRecorder();
    await exportDailyIssues(
      {
        user: { role: "ELT" },
        query: {
          division: "division-1",
          from: "2026-09-01",
          to: "2026-09-09",
          format: "csv",
          osr: "1",
        },
      },
      response
    );

    assert.deepEqual(receivedFilter.disruptionType, {
      $in: ["OSR (Orion Service Request)", "OSR (Out of Service Request)"],
    });
    assert.match(response.headers["Content-Disposition"], /D1-osrs-2026-09-01-to-2026-09-09\.csv/);
  } finally {
    Division.findById = originalFindById;
    DailyIssueLog.find = originalFind;
  }
});
