import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import connectTodb from "../../db/connectTodb.js";
import RunCut from "../../models/RunCut.js";
import RunCutDay from "../../models/RunCutDay.js";
import Division from "../../models/Division.js";
import { computeHours } from "../../utils/hours.js";
import { getEffectiveThresholds } from "../../utils/thresholds.js";
import { rolloverAssignments } from "../../jobs/rolloverAssignments.js";

dotenv.config({ quiet: true });

const todayUTC = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const comboKey = (r) => `${r.operator || "null"}::${r.vehicle || "null"}::${r.pulloutAddress || ""}::${r.startTime}::${r.endTime}`;

// Picks the combination of operator/vehicle/pullout/times that appears on
// the most days for this route. Ties break toward whichever combo was seen
// first (day order), so the result is deterministic.
const modeCombo = (rows) => {
  const counts = new Map();
  for (const r of rows) {
    const key = comboKey(r);
    if (!counts.has(key)) counts.set(key, { count: 0, row: r });
    counts.get(key).count += 1;
  }
  let best = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return { row: best.row, distinctCombos: counts.size };
};

const run = async () => {
  await connectTodb();

  // Read raw docs (bypassing the already-updated schema) so the old
  // dayOfWeek field is still visible on each row.
  const rawRunCuts = await mongoose.connection.collection("runcuts").find({}).toArray();

  const groups = new Map();
  for (const r of rawRunCuts) {
    const key = `${r.division}|${r.route}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  console.log(`Found ${groups.size} route/division groups across ${rawRunCuts.length} per-day rows.`);

  const today = todayUTC();
  let varyingCount = 0;
  const idsToKeep = new Set();

  for (const rows of groups.values()) {
    const { division, route } = rows[0];
    const daysOfWeek = [...new Set(rows.map((r) => r.dayOfWeek).filter((d) => d))].sort();
    const { row: chosen, distinctCombos } = modeCombo(rows);

    if (distinctCombos > 1) {
      varyingCount += 1;
      console.log(
        `  VARIES route=${route} division=${division}: ${distinctCombos} distinct operator/vehicle/time combos across ${rows.length} days — picked the most common one.`
      );
    }

    const todayRunCutDay = await RunCutDay.findOne({ division, route, date: today }).lean();
    const status = todayRunCutDay?.status || "active";

    const divisionDoc = await Division.findById(division);
    const thresholds = await getEffectiveThresholds(divisionDoc, today);
    const { serviceHours, revenueHours } = computeHours({
      startTime: chosen.startTime,
      endTime: chosen.endTime,
      status,
      ...thresholds,
    });

    // Update the first matching raw row in place (still just a plain
    // collection write at this point — many duplicate rows can share the
    // same division+route since the unique index hasn't taken effect yet)
    // so its _id is the one we keep; every other row for this group gets
    // dropped below.
    const survivorId = rows[0]._id;
    await mongoose.connection.collection("runcuts").updateOne(
      { _id: survivorId },
      {
        $set: {
          daysOfWeek,
          operator: chosen.operator || null,
          vehicle: chosen.vehicle || null,
          pulloutAddress: chosen.pulloutAddress || "",
          startTime: chosen.startTime,
          endTime: chosen.endTime,
          status,
          serviceHours,
          revenueHours,
          clientNotes: todayRunCutDay?.clientNotes || "",
          disruptionType: todayRunCutDay?.disruptionType || null,
          disruptionNotes: todayRunCutDay?.disruptionNotes || "",
        },
        $unset: { dayOfWeek: "" },
      }
    );
    idsToKeep.add(survivorId.toString());
  }

  console.log(`\n${varyingCount} route(s) had day-varying operator/vehicle/time — collapsed to their most common combination.`);

  const deleteResult = await mongoose.connection
    .collection("runcuts")
    .deleteMany({ _id: { $nin: [...idsToKeep].map((id) => new mongoose.Types.ObjectId(id)) } });
  console.log(`Removed ${deleteResult.deletedCount} leftover per-day row(s).`);

  console.log("\nProjecting merged assignments forward into RunCutDay...");
  await rolloverAssignments();

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Migration failed.");
  process.exit(1);
});
