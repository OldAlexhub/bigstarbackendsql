import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import connectTodb from "../../db/connectTodb.js";
import RunCutDay from "../../models/RunCutDay.js";

dotenv.config({ quiet: true });

// `notes` and `firstPickupOnTime` were removed from the schema (confirmed
// unused anywhere in server/ or client/src) — Mongoose stops reading/writing
// them going forward. This historical migration is retained for pre-relational
// data sources; the Fabric schema does not create columns for these fields.
const run = async () => {
  await connectTodb();

  const result = await RunCutDay.collection.updateMany(
    { $or: [{ notes: { $exists: true } }, { firstPickupOnTime: { $exists: true } }] },
    { $unset: { notes: "", firstPickupOnTime: "" } }
  );
  console.log(`Stripped notes/firstPickupOnTime from ${result.modifiedCount} RunCutDay document(s).`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Migration failed.");
  process.exit(1);
});
