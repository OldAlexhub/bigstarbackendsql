import test from "node:test";
import assert from "node:assert/strict";
import { assertTransactionSupport } from "./transactionSupport.js";

test("Fabric Warehouse readiness includes a real transaction boundary", async () => {
  let transactionCalls = 0;
  const connection = {
    query: async (statement) => ({
      rows: [{ [statement.includes("transaction_ready") ? "transaction_ready" : "warehouse_ready"]: 1 }],
    }),
    transaction: async (work) => {
      transactionCalls += 1;
      return work();
    },
  };

  await assert.doesNotReject(() => assertTransactionSupport(connection));
  assert.equal(transactionCalls, 1);
});

test("an invalid Fabric Warehouse readiness response is rejected before startup", async () => {
  const connection = {
    query: async () => ({ rows: [] }),
    transaction: async (work) => work(),
  };

  await assert.rejects(
    () => assertTransactionSupport(connection),
    /Microsoft Fabric Warehouse connectivity check failed/
  );
});
