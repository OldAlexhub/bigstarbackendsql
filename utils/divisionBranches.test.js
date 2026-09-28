import assert from "node:assert/strict";
import test from "node:test";
import Division from "../models/Division.js";
import { getBranchGroupDivisionIds } from "./divisionBranches.js";

test("a division outside Division 3 keeps its own standby pool", async () => {
  const originalFindById = Division.findById;
  const originalFind = Division.find;
  let findCalled = false;

  Division.findById = () => {
    const result = Promise.resolve({ _id: "division-5", code: "DIV_5" });
    result.select = () => result;
    return result;
  };
  Division.find = () => {
    findCalled = true;
    return { distinct: async () => [] };
  };

  try {
    assert.deepEqual(await getBranchGroupDivisionIds("division-5"), ["division-5"]);
    assert.equal(findCalled, false);
  } finally {
    Division.findById = originalFindById;
    Division.find = originalFind;
  }
});

test("Division 3 ADA, GoLink, and the existing standby store resolve as one pool", async () => {
  const originalFindById = Division.findById;
  const originalFind = Division.find;
  let groupFilter;

  Division.findById = () => {
    const result = Promise.resolve({ _id: "golink", code: "DIV_3_GL" });
    result.select = () => result;
    return result;
  };
  Division.find = (filter) => {
    groupFilter = filter;
    return { distinct: async () => ["ada", "golink", "standby"] };
  };

  try {
    assert.deepEqual(await getBranchGroupDivisionIds("golink"), ["ada", "golink", "standby"]);
    assert.deepEqual(groupFilter, {
      active: { $ne: false },
      code: { $in: ["DIV_3", "DIV_3_GL", "DIV_3_SB"] },
    });
  } finally {
    Division.findById = originalFindById;
    Division.find = originalFind;
  }
});
