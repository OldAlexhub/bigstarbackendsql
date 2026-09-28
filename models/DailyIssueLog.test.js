import assert from "node:assert/strict";
import test from "node:test";
import DailyIssueLog from "./DailyIssueLog.js";

test("visible issue identity is protected by a unique index across all sources", () => {
  const [keys, options] = DailyIssueLog.schema
    .indexes()
    .find(([, indexOptions]) => indexOptions.name === "uniq_issue_identity");

  assert.deepEqual(keys, {
    division: 1,
    date: 1,
    route: 1,
    operator: 1,
    disruptionType: 1,
  });
  assert.equal(options.unique, true);
  assert.equal(options.partialFilterExpression, undefined);
});
