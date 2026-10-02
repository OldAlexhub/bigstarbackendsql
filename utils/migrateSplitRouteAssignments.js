import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";

const dropIndexIfPresent = async (model, name, { unique } = {}) => {
  const indexes = await model.collection.indexes();
  const index = indexes.find((candidate) => candidate.name === name);
  if (!index || (unique !== undefined && Boolean(index.unique) !== unique)) return false;
  await model.collection.dropIndex(name);
  return true;
};

export const migrateSplitRouteAssignments = async () => {
  let backfilledDays = 0;
  let backfilledCoverage = 0;
  const runCuts = await RunCut.find({}).select("_id division route").lean();
  for (const runCut of runCuts) {
    const result = await RunCutDay.updateMany(
      {
        division: runCut.division,
        route: runCut.route,
        isExtra: { $ne: true },
        $or: [{ runCut: null }, { runCut: { $exists: false } }],
      },
      { $set: { runCut: runCut._id } }
    );
    backfilledDays += result.modifiedCount || 0;
  }
  const legacyCoverage = await RunCutDay.find({
    deployed: true,
    coveringRoute: { $ne: null },
    $or: [{ coveringRunCutDay: null }, { coveringRunCutDay: { $exists: false } }],
  }).select("_id date coveringRoute").lean();
  for (const standbyDay of legacyCoverage) {
    const candidates = await RunCutDay.find({
      route: standbyDay.coveringRoute,
      date: standbyDay.date,
      isExtra: { $ne: true },
    }).select("_id").lean();
    if (candidates.length !== 1) continue;
    const result = await RunCutDay.updateOne(
      { _id: standbyDay._id },
      { $set: { coveringRunCutDay: candidates[0]._id } }
    );
    backfilledCoverage += result.modifiedCount || 0;
  }
  const droppedIndexes = [];
  if (await dropIndexIfPresent(RunCut, "division_1_route_1", { unique: true })) droppedIndexes.push("run_cuts.division_1_route_1");
  if (await dropIndexIfPresent(RunCutDay, "division_1_route_1_date_1", { unique: true })) droppedIndexes.push("run_cut_days.division_1_route_1_date_1");
  if (await dropIndexIfPresent(RunCutDay, "one_deployed_standby_per_covered_route_global")) droppedIndexes.push("run_cut_days.one_deployed_standby_per_covered_route_global");
  return { backfilledDays, backfilledCoverage, droppedIndexes };
};

