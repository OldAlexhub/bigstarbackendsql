import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "../db/sqlMongoose.js";
import { runInTransaction } from "./transaction.js";

test("critical writes execute through the Fabric Warehouse transaction boundary", async () => {
  const original = mongoose.connection.transaction;
  let called = false;
  mongoose.connection.transaction = async (work) => {
    called = true;
    return work();
  };

  try {
    const result = await runInTransaction(async () => "committed");
    assert.equal(result, "committed");
    assert.equal(called, true);
  } finally {
    mongoose.connection.transaction = original;
  }
});
