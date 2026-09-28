import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "../db/sqlMongoose.js";
import Operator from "./Operator.js";

test("driver names are normalized to proper case and retain division roster data", () => {
  const division = new mongoose.Types.ObjectId();
  const operator = new Operator({
    division,
    name: "  jAnE   DOE ",
    pulloutAddress: "100 Main Street",
    active: true,
  });

  assert.equal(operator.name, "Jane Doe");
  assert.equal(String(operator.division), String(division));
  assert.equal(operator.pulloutAddress, "100 Main Street");
});
