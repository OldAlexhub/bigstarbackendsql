import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import connectTodb from "../../db/connectTodb.js";
import DailyIssueLog from "../../models/DailyIssueLog.js";
import { migrateIssueIdentity } from "../../utils/dedupeAutoIssues.js";

dotenv.config({ quiet: true });

// The migration owns the index transition. Disable Mongoose's automatic
// index build so it cannot race the cleanup of existing duplicate rows.
mongoose.set("autoIndex", false);

const run = async () => {
  await connectTodb();
  const result = await migrateIssueIdentity(DailyIssueLog.collection);

  console.log(`Issue dates normalized: ${result.normalizedDates}`);
  console.log(`Duplicate issue groups found: ${result.duplicateGroups}`);
  console.log(`Duplicate issue records removed: ${result.deletedRecords}`);
  console.log(`Obsolete indexes removed: ${result.droppedIndexes.join(", ") || "none"}`);
  console.log(result.createdIndex ? "Created unique issue identity index." : "Unique issue identity index already current.");

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Daily issue identity migration failed.");
  process.exit(1);
});
