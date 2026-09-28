import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import connectTodb from "../../db/connectTodb.js";
import Operator from "../../models/Operator.js";
import { backfillAssignmentRosters } from "../../utils/backfillAssignmentRosters.js";

dotenv.config({ quiet: true });

try {
  await connectTodb();
  const result = await backfillAssignmentRosters();
  await Operator.createIndexes();
  console.log(
    `Driver roster backfill complete: ${result.updatedOperators} operator records updated, ${result.rewiredAssignments} assignments rewired.`
  );
} finally {
  await mongoose.disconnect();
}
