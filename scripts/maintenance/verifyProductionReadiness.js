import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import { validateEnvironment } from "../../config/environment.js";
import connectTodb from "../../db/connectTodb.js";
import { assertTransactionSupport } from "../../db/transactionSupport.js";
import RunCutDay from "../../models/RunCutDay.js";
import { runInTransaction } from "../../utils/transaction.js";

dotenv.config({ quiet: true });

const main = async () => {
  const config = validateEnvironment();
  const database = await connectTodb(config);
  await assertTransactionSupport(database);
  await runInTransaction(() => RunCutDay.findOne().select("_id").lean());

  const duplicateCoverage = await RunCutDay.aggregate([
    { $match: { deployed: true, coveringRoute: { $type: "objectId" } } },
    {
      $group: {
        _id: { date: "$date", coveringRoute: "$coveringRoute" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $count: "groups" },
  ]);
  const duplicateGroups = duplicateCoverage[0]?.groups || 0;
  if (duplicateGroups) {
    throw new Error(
      `${duplicateGroups} duplicate deployed standby coverage group(s) must be resolved before deployment.`
    );
  }

  console.log("Production preflight passed: transaction-capable Fabric Warehouse and no duplicate standby coverage.");
};

main()
  .catch(() => {
    console.error("Production preflight failed.");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
