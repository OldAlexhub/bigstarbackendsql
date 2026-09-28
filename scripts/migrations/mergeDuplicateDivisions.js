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

// A handful of divisions were accidentally split into a base division plus a
// same-service "(PM)" / "Night/Weekend" shift variant, unlike deliberately
// distinct services sharing a number (e.g. Division 3 - ADA vs GoLink). This
// merges each pair back into one division, following the exact dedupe-by-code
// pattern scripts/mergeStandbyDivisions.js already used for the standby merge.
const PAIRS = [
  { parentName: "Division 10 - TriMet", childName: "Division 10 - TriMet (PM)" },
  { parentName: "Division 8 - COTA", childName: "Division 8 - COTA Night/Weekend" },
];

const mergeByCode = async ({ Model, childId, parentId, refUpdaters }) => {
  const docs = await Model.find({ division: childId });
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
      await doc.save();
      moved += 1;
    }
  }

  return { moved, deduped };
};

const run = async () => {
  await connectTodb();

  for (const { parentName, childName } of PAIRS) {
    const parent = await Division.findOne({ name: parentName });
    const child = await Division.findOne({ name: childName });
    if (!parent || !child) {
      console.log(`Skipping ${parentName} / ${childName}: one side not found.`);
      continue;
    }

    console.log(`\nMerging ${child.code} -> ${parent.code}`);
    const parentId = parent._id;
    const childId = child._id;

    const vehicleResult = await mergeByCode({
      Model: Vehicle,
      childId,
      parentId,
      refUpdaters: [
        (fromId, toId) => RunCutDay.updateMany({ vehicle: fromId }, { vehicle: toId }),
        (fromId, toId) => RunCut.updateMany({ vehicle: fromId }, { vehicle: toId }),
      ],
    });
    console.log(`  vehicles: moved ${vehicleResult.moved}, deduped into existing ${vehicleResult.deduped}`);

    const routeResult = await mergeByCode({
      Model: Route,
      childId,
      parentId,
      refUpdaters: [
        (fromId, toId) => RunCutDay.updateMany({ route: fromId }, { route: toId }),
        (fromId, toId) => RunCut.updateMany({ route: fromId }, { route: toId }),
        (fromId, toId) => DailyIssueLog.updateMany({ route: fromId }, { route: toId }),
      ],
    });
    console.log(`  routes: moved ${routeResult.moved}, deduped into existing ${routeResult.deduped}`);

    const [runCutDays, runCuts, dailyIssueLogs] = await Promise.all([
      RunCutDay.updateMany({ division: childId }, { division: parentId }),
      RunCut.updateMany({ division: childId }, { division: parentId }),
      DailyIssueLog.updateMany({ division: childId }, { division: parentId }),
    ]);
    console.log(`  runCutDays: ${runCutDays.modifiedCount}`);
    console.log(`  runCuts (templates): ${runCuts.modifiedCount}`);
    console.log(`  dailyIssueLogs: ${dailyIssueLogs.modifiedCount}`);

    // Unlike the standby merge, the parent's finalized weekly history isn't
    // wiped here — neither side has any WeeklyDivisionSummary rows to
    // reconcile (verified before running), so there's nothing to lose by
    // leaving the parent's existing history untouched.
    const wipedChildSummaries = await WeeklyDivisionSummary.deleteMany({ division: childId });
    console.log(`  wiped child weeklyDivisionSummary rows: ${wipedChildSummaries.deletedCount}`);

    const usersToRemap = await User.countDocuments({ divisionAccess: childId });
    if (usersToRemap > 0) {
      await User.updateMany({ divisionAccess: childId }, { $addToSet: { divisionAccess: parentId } });
      await User.updateMany({ divisionAccess: childId }, { $pull: { divisionAccess: childId } });
    }
    console.log(`  users remapped: ${usersToRemap}`);

    const [remainingRoutes, remainingVehicles, remainingRunCutDays, remainingRunCuts, remainingIssues, remainingSummaries] =
      await Promise.all([
        Route.countDocuments({ division: childId }),
        Vehicle.countDocuments({ division: childId }),
        RunCutDay.countDocuments({ division: childId }),
        RunCut.countDocuments({ division: childId }),
        DailyIssueLog.countDocuments({ division: childId }),
        WeeklyDivisionSummary.countDocuments({ division: childId }),
      ]);
    const remainingTotal =
      remainingRoutes +
      remainingVehicles +
      remainingRunCutDays +
      remainingRunCuts +
      remainingIssues +
      remainingSummaries;

    if (remainingTotal > 0) {
      console.error(
        `  ABORTING delete of ${child.code}: ${remainingTotal} document(s) still reference it ` +
          `(routes=${remainingRoutes}, vehicles=${remainingVehicles}, runCutDays=${remainingRunCutDays}, ` +
          `runCuts=${remainingRunCuts}, issues=${remainingIssues}, summaries=${remainingSummaries}).`
      );
      continue;
    }

    await Division.deleteOne({ _id: childId });
    console.log(`  deleted division ${child.code}`);
  }

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Migration failed.");
  process.exit(1);
});
