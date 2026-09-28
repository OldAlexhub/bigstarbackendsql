import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import connectTodb from "../../db/connectTodb.js";
import RunCutDay from "../../models/RunCutDay.js";
import DailyIssueLog from "../../models/DailyIssueLog.js";
import Division from "../../models/Division.js";
import { todayInTimezone } from "../../utils/timezone.js";
import { addDays } from "../../utils/weeklyMetrics.js";
import { PROJECTION_HORIZON_DAYS } from "../../utils/projectAssignment.js";

dotenv.config({ quiet: true });

// One-time cleanup for the PROJECTION_HORIZON_DAYS reduction (14 -> 6):
// projectAssignment's own cleanup only prunes dates it's currently asked to
// consider, so it never retroactively removes documents that were generated
// under the old, wider window and now sit beyond the new one. This deletes
// only untouched pure-projection days out past the new horizon — anything
// with a Deployment-side override, an extra duty, or standby deployment is
// left alone (it's real, deliberately-entered data, not projection waste).
const run = async () => {
  await connectTodb();

  const divisions = await Division.find({});
  let totalRemoved = 0;

  for (const division of divisions) {
    const start = todayInTimezone(division.timezone);
    const cutoff = addDays(start, PROJECTION_HORIZON_DAYS + 1);

    const removable = await RunCutDay.find({
      division: division._id,
      date: { $gte: cutoff },
      isExtra: { $ne: true },
      deployed: { $ne: true },
      coveringRoute: null,
      "overrides.status": { $ne: true },
      "overrides.clientNotes": { $ne: true },
      "overrides.disruption": { $ne: true },
    }).select("_id");

    const removableIds = removable.map((r) => r._id);
    if (!removableIds.length) continue;

    await DailyIssueLog.deleteMany({ runCutDay: { $in: removableIds }, autoSyncTag: { $ne: null } });
    const result = await RunCutDay.deleteMany({ _id: { $in: removableIds } });
    console.log(`${division.code}: removed ${result.deletedCount} document(s) beyond ${cutoff.toISOString().slice(0, 10)}`);
    totalRemoved += result.deletedCount;
  }

  console.log(`Total removed: ${totalRemoved}`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Migration failed.");
  process.exit(1);
});
