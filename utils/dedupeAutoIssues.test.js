import assert from "node:assert/strict";
import test from "node:test";
import {
  ISSUE_IDENTITY_INDEX_KEY,
  ISSUE_IDENTITY_INDEX_NAME,
  migrateIssueIdentity,
} from "./dedupeAutoIssues.js";

test("migration keeps the priority survivor and installs logical uniqueness", async () => {
  let normalizeFilter;
  let normalizeUpdate;
  let pipeline;
  let deleteFilter;
  const dropped = [];
  let created;
  const collection = {
    async updateMany(filter, update) {
      normalizeFilter = filter;
      normalizeUpdate = update;
      return { modifiedCount: 4 };
    },
    aggregate(received) {
      pipeline = received;
      return {
        toArray: async () => [
          {
            _id: {
              division: "division-1",
              date: "2026-09-08",
              route: "route-1",
              operator: "operator-1",
              disruptionType: "Unperformed Duty",
            },
            // The aggregation sorts manual rows first, then newest records.
            ids: ["manual-new", "auto-new", "manual-old"],
            count: 3,
          },
        ],
      };
    },
    async deleteMany(filter) {
      deleteFilter = filter;
      return { deletedCount: 2 };
    },
    async indexes() {
      return [
        { name: "_id_", key: { _id: 1 } },
        { name: "uniq_auto_issue_source", key: { runCutDay: 1, autoSyncTag: 1 }, unique: true },
      ];
    },
    async dropIndex(name) {
      dropped.push(name);
    },
    async createIndex(keys, options) {
      created = { keys, options };
    },
  };

  const result = await migrateIssueIdentity(collection);

  assert.deepEqual(normalizeFilter, { date: { $type: "date" } });
  assert.equal(Array.isArray(normalizeUpdate), true);
  assert.equal(pipeline[0].$set.__manualPriority.$cond[2], 0);
  assert.deepEqual(deleteFilter, { _id: { $in: ["auto-new", "manual-old"] } });
  assert.deepEqual(dropped, ["uniq_auto_issue_source"]);
  assert.deepEqual(created, {
    keys: ISSUE_IDENTITY_INDEX_KEY,
    options: { name: ISSUE_IDENTITY_INDEX_NAME, unique: true },
  });
  assert.deepEqual(result, {
    normalizedDates: 4,
    duplicateGroups: 1,
    deletedRecords: 2,
    droppedIndexes: ["uniq_auto_issue_source"],
    createdIndex: true,
  });
});

test("migration is idempotent when data and the logical index are current", async () => {
  let structuralMutations = 0;
  const collection = {
    async updateMany() {
      return { modifiedCount: 0 };
    },
    aggregate() {
      return { toArray: async () => [] };
    },
    async indexes() {
      return [
        { name: "_id_", key: { _id: 1 } },
        { name: ISSUE_IDENTITY_INDEX_NAME, key: ISSUE_IDENTITY_INDEX_KEY, unique: true },
      ];
    },
    async deleteMany() {
      structuralMutations += 1;
    },
    async dropIndex() {
      structuralMutations += 1;
    },
    async createIndex() {
      structuralMutations += 1;
    },
  };

  const result = await migrateIssueIdentity(collection);

  assert.equal(structuralMutations, 0);
  assert.deepEqual(result, {
    normalizedDates: 0,
    duplicateGroups: 0,
    deletedRecords: 0,
    droppedIndexes: [],
    createdIndex: false,
  });
});
