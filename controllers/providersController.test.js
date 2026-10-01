import assert from "node:assert/strict";
import test from "node:test";
import Operator from "../models/Operator.js";
import Provider from "../models/Provider.js";
import { listProviders } from "./providersController.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("provider reads are limited to the user's assigned divisions", async () => {
  const originalDistinct = Operator.distinct;
  const originalFind = Provider.find;
  let operatorFilter;
  let providerFilter;
  Operator.distinct = async (field, filter) => {
    assert.equal(field, "provider");
    operatorFilter = filter;
    return ["provider-1"];
  };
  Provider.find = (filter) => {
    providerFilter = filter;
    return { sort: async () => [{ _id: "provider-1", name: "Division Provider" }] };
  };
  try {
    const res = response();
    await listProviders(
      {
        user: { role: "Coordinator", divisionAccess: ["division-1"] },
        query: {},
      },
      res
    );
    assert.deepEqual(operatorFilter, {
      division: { $in: ["division-1"] },
      provider: { $ne: null },
    });
    assert.deepEqual(providerFilter, { _id: { $in: ["provider-1"] } });
    assert.equal(res.body.providers.length, 1);
  } finally {
    Operator.distinct = originalDistinct;
    Provider.find = originalFind;
  }
});

test("provider reads reject an unassigned division", async () => {
  const res = response();
  await listProviders(
    {
      user: { role: "Coordinator", divisionAccess: ["division-1"] },
      query: { division: "division-2" },
    },
    res
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /division/);
});
