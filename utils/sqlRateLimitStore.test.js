import test from "node:test";
import assert from "node:assert/strict";
import { SqlRateLimitStore } from "./sqlRateLimitStore.js";

test("SQL rate-limit store hashes keys and returns the atomic counter", async () => {
  let filter;
  let update;
  let options;
  const model = {
    findOneAndUpdate(nextFilter, nextUpdate, nextOptions) {
      filter = nextFilter;
      update = nextUpdate;
      options = nextOptions;
      return { lean: async () => ({ totalHits: 3, expiresAt: new Date("2026-09-12T12:00:00Z") }) };
    },
  };
  const store = new SqlRateLimitStore({ model });
  store.init({ windowMs: 900_000 });

  const result = await store.increment("203.0.113.10");

  assert.match(filter._id, /^[a-f0-9]{64}$/);
  assert.notEqual(filter._id, "203.0.113.10");
  assert.equal(update[0].$set.totalHits.$cond[2], 1);
  assert.equal(options.updatePipeline, true);
  assert.equal(options.returnDocument, "after");
  assert.equal(options.new, undefined);
  assert.equal(result.totalHits, 3);
  assert.equal(result.resetTime.toISOString(), "2026-09-12T12:00:00.000Z");
});

test("SQL rate-limit store retries a concurrent first-upsert race once", async () => {
  let calls = 0;
  const model = {
    findOneAndUpdate() {
      calls += 1;
      return {
        lean: async () => {
          if (calls === 1) throw Object.assign(new Error("duplicate"), { code: 11000 });
          return { totalHits: 2, expiresAt: new Date("2026-09-12T12:00:00Z") };
        },
      };
    },
  };
  const store = new SqlRateLimitStore({ model });
  store.init({ windowMs: 900_000 });

  const result = await store.increment("203.0.113.10");

  assert.equal(calls, 2);
  assert.equal(result.totalHits, 2);
});
