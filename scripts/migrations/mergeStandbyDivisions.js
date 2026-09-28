import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import connectTodb from "../../db/connectTodb.js";
import Division from "../../models/Division.js";
import Route from "../../models/Route.js";
import Vehicle from "../../models/Vehicle.js";
import RunCutDay from "../../models/RunCutDay.js";
import RunCut from "../../models/RunCut.js";
import DailyIssueLog from "../../models/DailyIssueLog.js";
import WeeklyDivisionSummary from "../../models/WeeklyDivisionSummary.js";
import User from "../../models/User.js";

dotenv.config({ quiet: true });

// Moves every standby-division doc onto the parent by code. If the parent
// already has a doc with the same code (e.g. the same physical vehicle is
// used both on standby and on regular routes), repoint every reference to
// the duplicate onto the existing parent doc instead of creating a clash,
// then drop the duplicate.
const mergeByCode = async ({ Model, standbyId, parentId, extraFieldsOnMove, refUpdaters }) => {
  const docs = await Model.find({ division: standbyId });
  let moved = 0;
  let deduped = 0;

  for (const doc of docs) {
    const existing = await Model.findOne({ division: parentId, code: doc.code });
    if (existing) {
      for (const updater of refUpdaters) {
        await updater(doc._id, existing._id);
      }
      await Model.deleteOne({ _id: doc._id });
      deduped += 1;
    } else {
      doc.division = parentId;
      Object.assign(doc, extraFieldsOnMove || {});
      await doc.save();
      moved += 1;
    }
  }

  return { moved, deduped };
};

const run = async () => {
  await connectTodb();

  const standbyDivisions = await Division.find({ type: "standby", parentDivision: { $ne: null } });
  console.log(`Found ${standbyDivisions.length} standby division(s) to merge.`);

  for (const standby of standbyDivisions) {
    const parentId = standby.parentDivision;
    const parent = await Division.findById(parentId);
    if (!parent) {
      console.log(`Skipping ${standby.code}: parent division not found.`);
      continue;
    }

    console.log(`\nMerging ${standby.code} -> ${parent.code}`);

    const vehicleResult = await mergeByCode({
      Model: Vehicle,
      standbyId: standby._id,
      parentId,
      refUpdaters: [
        (fromId, toId) => RunCutDay.updateMany({ vehicle: fromId }, { vehicle: toId }),
        (fromId, toId) => RunCut.updateMany({ vehicle: fromId }, { vehicle: toId }),
      ],
    });
    console.log(`  vehicles: moved ${vehicleResult.moved}, deduped into existing ${vehicleResult.deduped}`);

    const routeResult = await mergeByCode({
      Model: Route,
      standbyId: standby._id,
      parentId,
      extraFieldsOnMove: { type: "standby" },
      refUpdaters: [
        (fromId, toId) => RunCutDay.updateMany({ route: fromId }, { route: toId }),
        (fromId, toId) => RunCut.updateMany({ route: fromId }, { route: toId }),
        (fromId, toId) => DailyIssueLog.updateMany({ route: fromId }, { route: toId }),
      ],
    });
    console.log(`  routes: moved ${routeResult.moved}, deduped into existing ${routeResult.deduped}`);

    const [runCutDays, runCuts, dailyIssueLogs] = await Promise.all([
      RunCutDay.updateMany({ division: standby._id }, { division: parentId }),
      RunCut.updateMany({ division: standby._id }, { division: parentId }),
      DailyIssueLog.updateMany({ division: standby._id }, { division: parentId }),
    ]);

    console.log(`  runCutDays: ${runCutDays.modifiedCount}`);
    console.log(`  runCuts (templates): ${runCuts.modifiedCount}`);
    console.log(`  dailyIssueLogs: ${dailyIssueLogs.modifiedCount}`);

    const wipedSummaries = await WeeklyDivisionSummary.deleteMany({
      division: { $in: [standby._id, parentId] },
    });
    console.log(`  wiped weeklyDivisionSummary rows (both sides, to regenerate): ${wipedSummaries.deletedCount}`);

    const usersToRemap = await User.countDocuments({ divisionAccess: standby._id });
    if (usersToRemap > 0) {
      await User.updateMany({ divisionAccess: standby._id }, { $addToSet: { divisionAccess: parentId } });
      await User.updateMany({ divisionAccess: standby._id }, { $pull: { divisionAccess: standby._id } });
    }
    console.log(`  users remapped: ${usersToRemap}`);

    const [remainingRoutes, remainingVehicles, remainingRunCutDays, remainingRunCuts, remainingIssues] =
      await Promise.all([
        Route.countDocuments({ division: standby._id }),
        Vehicle.countDocuments({ division: standby._id }),
        RunCutDay.countDocuments({ division: standby._id }),
        RunCut.countDocuments({ division: standby._id }),
        DailyIssueLog.countDocuments({ division: standby._id }),
      ]);
    const remainingTotal =
      remainingRoutes + remainingVehicles + remainingRunCutDays + remainingRunCuts + remainingIssues;

    if (remainingTotal > 0) {
      console.error(
        `  ABORTING delete of ${standby.code}: ${remainingTotal} document(s) still reference it ` +
          `(routes=${remainingRoutes}, vehicles=${remainingVehicles}, runCutDays=${remainingRunCutDays}, ` +
          `runCuts=${remainingRunCuts}, issues=${remainingIssues}).`
      );
      continue;
    }

    await Division.deleteOne({ _id: standby._id });
    console.log(`  deleted division ${standby.code}`);
  }

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Migration failed.");
  process.exit(1);
});
