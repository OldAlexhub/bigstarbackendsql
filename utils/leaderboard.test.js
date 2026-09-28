import assert from "node:assert/strict";
import test from "node:test";
import { filterLeaderboardRowsForUser, rankLeaderboardRows } from "./leaderboard.js";

test("a division keeps its company-wide rank after rows are limited by division access", () => {
  const ranked = rankLeaderboardRows([
    { divisionId: "division-1", avgFulfillmentPct: 0.98 },
    { divisionId: "division-6", avgFulfillmentPct: 0.91 },
    { divisionId: "division-3", avgFulfillmentPct: 0.95 },
  ]);
  const visible = filterLeaderboardRowsForUser(ranked, {
    role: "Manager",
    divisionAccess: ["division-6"],
  });

  assert.equal(visible.length, 1);
  assert.equal(visible[0].divisionId, "division-6");
  assert.equal(visible[0].rank, 3);
});

test("ELT can see the complete company ranking", () => {
  const ranked = rankLeaderboardRows([
    { divisionId: "division-6", avgFulfillmentPct: 0.91 },
    { divisionId: "division-1", avgFulfillmentPct: 0.98 },
  ]);
  assert.deepEqual(filterLeaderboardRowsForUser(ranked, { role: "ELT", divisionAccess: [] }), ranked);
});
