const score = (row) => row.avgFulfillmentPct ?? -1;

export const rankLeaderboardRows = (rows) => {
  const ranked = [...rows].sort((a, b) => score(b) - score(a));
  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
};

export const filterLeaderboardRowsForUser = (ranked, user) => {
  if (user?.role === "ELT") return ranked;
  const accessibleIds = new Set(
    (user?.divisionAccess || []).map((division) => String(division?._id || division))
  );
  return ranked.filter((row) => accessibleIds.has(String(row.divisionId)));
};
