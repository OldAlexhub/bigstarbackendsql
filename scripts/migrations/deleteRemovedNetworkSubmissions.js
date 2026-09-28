import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import connectTodb from "../../db/connectTodb.js";
import NetworkSubmission from "../../models/NetworkSubmission.js";

dotenv.config({ quiet: true });

// One-time cleanup: removeSubmission used to soft-delete by setting
// status: "removed" and keeping the document (and its full changeAudit
// history) forever. It now hard-deletes instead. This purges the legacy
// soft-deleted documents that accumulated under the old behavior; their
// NetworkKpiEntry records were already deleted at removal time, so only
// the NetworkSubmission shells are left to clean up.
const run = async () => {
  await connectTodb();

  const result = await NetworkSubmission.deleteMany({ status: "removed" });
  console.log(`Deleted ${result.deletedCount} removed NetworkSubmission document(s).`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Migration failed.");
  process.exit(1);
});
