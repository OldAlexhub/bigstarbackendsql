import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import XLSX from "xlsx";
import connectTodb from "../../db/connectTodb.js";
import Division from "../../models/Division.js";
import Route from "../../models/Route.js";
import RunCut from "../../models/RunCut.js";
import { projectAssignment } from "../../utils/projectAssignment.js";
import { requiredFile } from "../lib/requiredFile.js";

dotenv.config({ quiet: true });

const STATUS_MAP = { Active: "active", Unassigned: "unassigned" };

// Fixes a bug in collapseRunCuts.js: it seeded each route's persistent
// status from *today's* RunCutDay only, which is null for any route not
// scheduled today — silently defaulting those to "active" and then
// overwriting real "Unassigned" history when the rollover projected it
// forward. The source workbook's DDS sheet still has the real per-day
// status for every route, so re-derive the correct current status from
// there (the most common non-OFF status across each route's actual
// scheduled days) and re-project it into RunCutDay.
const run = async () => {
  const sourcePath = requiredFile({
    envName: "SOURCE_WORKBOOK_PATH",
    description: "source workbook",
  });
  await connectTodb();

  const workbook = XLSX.readFile(sourcePath);
  const sheet = workbook.Sheets["DDS xx.xx - xx.xx"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });

  const groups = new Map();
  for (const row of rows) {
    const divisionCode = row[0];
    const routeCode = row[2] != null ? String(row[2]).trim() : "";
    const status = STATUS_MAP[row[9]];
    if (!divisionCode || !routeCode || routeCode === "0" || !status) continue;

    const normalizedDivisionCode = divisionCode.replace(/_SB$/, "");
    const key = `${normalizedDivisionCode}|${routeCode}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(status);
  }

  console.log(`Read ${groups.size} route groups with real status data from the source workbook.`);

  let checked = 0;
  let corrected = 0;
  let notFound = 0;

  for (const [key, statuses] of groups.entries()) {
    const [divisionCode, routeCode] = key.split("|");
    const counts = {};
    for (const s of statuses) counts[s] = (counts[s] || 0) + 1;
    const modeStatus = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

    const divisionDoc = await Division.findOne({ code: divisionCode });
    if (!divisionDoc) {
      notFound += 1;
      continue;
    }
    const routeDoc = await Route.findOne({ division: divisionDoc._id, code: routeCode });
    if (!routeDoc) {
      notFound += 1;
      continue;
    }
    const runCut = await RunCut.findOne({ division: divisionDoc._id, route: routeDoc._id });
    if (!runCut) {
      notFound += 1;
      continue;
    }

    checked += 1;
    if (runCut.status !== modeStatus) {
      console.log(
        `  ${divisionCode} route ${routeCode}: ${runCut.status} -> ${modeStatus} (source: ${JSON.stringify(counts)})`
      );
      runCut.status = modeStatus;
      await runCut.save();
      await projectAssignment(runCut, null);
      corrected += 1;
    }
  }

  console.log(`\nChecked ${checked} routes against the source; corrected ${corrected}; ${notFound} route(s) in the source had no matching Division/Route/RunCut in the DB.`);
  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Fix failed.");
  process.exit(1);
});
