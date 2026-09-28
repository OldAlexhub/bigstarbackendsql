import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import XLSX from "xlsx";
import connectTodb from "../../db/connectTodb.js";
import Division from "../../models/Division.js";
import Route from "../../models/Route.js";
import Operator from "../../models/Operator.js";
import Vehicle from "../../models/Vehicle.js";
import RunCut from "../../models/RunCut.js";
import RunCutDay from "../../models/RunCutDay.js";
import { DAYS_OF_WEEK } from "../../utils/hours.js";
import { startOfWeek, addDays } from "../../utils/weeklyMetrics.js";
import { requiredFile } from "../lib/requiredFile.js";

dotenv.config({ quiet: true });

// Friendly names for the divisions found in ClientExpFormat, taken from the
// Tracker tab's block headers (e.g. "DIVISION 3 - ADA").
const DIVISION_NAMES = {
  DIV_3: "Division 3 - ADA",
  DIV_3_SB: "Division 3 - ADA (Standby)",
  DIV_3_GL: "Division 3 - GoLink",
  DIV_5: "Division 5 - CCCTA",
  DIV_5_SB: "Division 5 - CCCTA (Standby)",
  DIV_6: "Division 6 - LYNX",
  DIV_6_SB: "Division 6 - LYNX (Standby)",
  DIV_7: "Division 7 - DDOT",
  DIV_7_SB: "Division 7 - DDOT (Standby)",
  DIV_8: "Division 8 - COTA",
  DIV_8_SB: "Division 8 - COTA (Standby)",
  DIV_8_PM: "Division 8 - COTA Night/Weekend",
  DIV_10: "Division 10 - TriMet",
  DIV_10_SB: "Division 10 - TriMet (Standby)",
  DIV_10_PM: "Division 10 - TriMet (PM)",
  DIV_11: "Division 11 - MARTA",
  DIV_11_SB: "Division 11 - MARTA (Standby)",
};

const excelTimeToHHMM = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number") return null;
  const totalMinutes = Math.round((value % 1) * 24 * 60);
  const h = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
  const m = String(totalMinutes % 60).padStart(2, "0");
  return `${h}:${m}`;
};

const normalizeStatus = (raw) => {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "active") return "active";
  if (s === "unassigned") return "unassigned";
  if (s === "suspended") return "suspended";
  if (s === "off") return "off";
  if (s === "add rte") return "add_rte";
  return null;
};

const round2 = (n) => Math.round(n * 100) / 100;

const run = async () => {
  const dryRun = process.argv.includes("--dry-run");
  const workbookPath = requiredFile({
    envName: "IMPORT_WORKBOOK_PATH",
    description: "ClientExpFormat workbook",
  });

  const workbook = XLSX.readFile(workbookPath, { raw: true });
  const sheet = workbook.Sheets["ClientExpFormat"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  // Row 1-3 are headers; data starts at row 4 (index 3).
  const dataRows = rows.slice(3);

  const divisionCodes = new Map(); // code -> { thresholdSamples: [] }
  const routeKeys = new Map(); // "code|routeCode" -> true
  const operatorNames = new Set();
  const vehicleKeys = new Map(); // "code|vehicleCode" -> true
  const parsedRows = [];

  for (const row of dataRows) {
    const [
      divisionCode,
      dayOfWeek,
      routeRaw,
      operatorRaw,
      vehicleRaw,
      pulloutAddress,
      startRaw,
      endRaw,
      ,
      statusRaw,
      serviceHoursRaw,
      revenueHoursRaw,
    ] = row;

    if (!divisionCode || !dayOfWeek) continue;
    if (!DAYS_OF_WEEK.includes(dayOfWeek)) continue;

    const status = normalizeStatus(statusRaw);
    if (!status || status === "off") continue; // OFF rows carry no real assignment
    if (routeRaw === null || routeRaw === undefined || routeRaw === "") continue;

    const code = String(divisionCode).trim().toUpperCase();
    if (!divisionCodes.has(code)) divisionCodes.set(code, { samples: [] });

    const routeCode = String(routeRaw).trim();
    routeKeys.set(`${code}|${routeCode}`, { code, routeCode });

    const operatorName = String(operatorRaw ?? "").trim().replace(/\s+/g, " ");
    if (operatorName && operatorName.toUpperCase() !== "OFF") operatorNames.add(operatorName);

    const vehicleCode = String(vehicleRaw ?? "").trim();
    if (vehicleCode) vehicleKeys.set(`${code}|${vehicleCode}`, { code, vehicleCode });

    const startTime = excelTimeToHHMM(startRaw);
    const endTime = excelTimeToHHMM(endRaw);
    const serviceHours = typeof serviceHoursRaw === "number" ? round2(serviceHoursRaw) : 0;
    const revenueHours = typeof revenueHoursRaw === "number" ? round2(revenueHoursRaw) : 0;

    if (status === "active" && startTime && endTime && serviceHours > 0) {
      let minutes =
        (parseInt(endTime.slice(0, 2), 10) * 60 + parseInt(endTime.slice(3), 10)) -
        (parseInt(startTime.slice(0, 2), 10) * 60 + parseInt(startTime.slice(3), 10));
      if (minutes <= 0) minutes += 24 * 60;
      const breakMinutes = Math.round(minutes - serviceHours * 60);
      const revenueRatio = serviceHours > 0 ? revenueHours / serviceHours : null;
      divisionCodes.get(code).samples.push({ breakMinutes, revenueRatio });
    }

    parsedRows.push({
      code,
      routeCode,
      dayOfWeek,
      operatorName: operatorName && operatorName.toUpperCase() !== "OFF" ? operatorName : null,
      vehicleCode: vehicleCode || null,
      pulloutAddress: pulloutAddress ? String(pulloutAddress).trim() : "",
      startTime,
      endTime,
      status,
      serviceHours,
      revenueHours,
    });
  }

  console.log(
    `Parsed ${parsedRows.length} scheduled rows across ${divisionCodes.size} divisions, ${routeKeys.size} routes, ${operatorNames.size} operators, ${vehicleKeys.size} vehicles.`
  );

  if (dryRun) {
    console.log("Dry run — no database writes. Sample division thresholds:");
    for (const [code, { samples }] of divisionCodes) {
      if (!samples.length) continue;
      const avgBreak = Math.round(samples.reduce((s, x) => s + x.breakMinutes, 0) / samples.length);
      const avgRatio =
        Math.round((samples.reduce((s, x) => s + (x.revenueRatio ?? 0), 0) / samples.length) * 100) / 100;
      console.log(`  ${code}: breakMinutes≈${avgBreak}, revenueRatio≈${avgRatio}`);
    }
    return;
  }

  await connectTodb();

  // --- Divisions ---
  const divisionDocByCode = new Map();
  for (const [code, { samples }] of divisionCodes) {
    const isStandby = code.endsWith("_SB");
    const thresholds = { breakMinutes: 30, revenueRatio: 0.9 };
    if (samples.length) {
      thresholds.breakMinutes = Math.round(samples.reduce((s, x) => s + x.breakMinutes, 0) / samples.length);
      const ratio = samples.reduce((s, x) => s + (x.revenueRatio ?? 0), 0) / samples.length;
      thresholds.revenueRatio = Math.round(ratio * 100) / 100;
    }

    const doc = await Division.findOneAndUpdate(
      { code },
      {
        code,
        name: DIVISION_NAMES[code] || code,
        type: isStandby ? "standby" : "standard",
        thresholds,
      },
      { upsert: true, returnDocument: "after" }
    );
    divisionDocByCode.set(code, doc);
  }

  // Link standby divisions to their parent.
  for (const [code, doc] of divisionDocByCode) {
    if (code.endsWith("_SB")) {
      const parentCode = code.slice(0, -3);
      const parent = divisionDocByCode.get(parentCode);
      if (parent) {
        doc.parentDivision = parent._id;
        await doc.save();
      }
    }
  }

  // --- Routes ---
  const routeDocByKey = new Map();
  for (const [key, { code, routeCode }] of routeKeys) {
    const division = divisionDocByCode.get(code);
    const doc = await Route.findOneAndUpdate(
      { division: division._id, code: routeCode },
      { division: division._id, code: routeCode },
      { upsert: true, returnDocument: "after" }
    );
    routeDocByKey.set(key, doc);
  }

  // --- Operators ---
  const operatorDocByName = new Map();
  for (const name of operatorNames) {
    const doc = await Operator.findOneAndUpdate(
      { name },
      { name },
      { upsert: true, returnDocument: "after" }
    );
    operatorDocByName.set(name, doc);
  }

  // --- Vehicles ---
  const vehicleDocByKey = new Map();
  for (const [key, { code, vehicleCode }] of vehicleKeys) {
    const division = divisionDocByCode.get(code);
    const doc = await Vehicle.findOneAndUpdate(
      { division: division._id, code: vehicleCode },
      { division: division._id, code: vehicleCode },
      { upsert: true, returnDocument: "after" }
    );
    vehicleDocByKey.set(key, doc);
  }

  // --- RunCut templates + current-week RunCutDay records ---
  const weekStart = startOfWeek(new Date());
  let templateCount = 0;
  let dayCount = 0;

  for (const row of parsedRows) {
    const division = divisionDocByCode.get(row.code);
    const route = routeDocByKey.get(`${row.code}|${row.routeCode}`);
    const operator = row.operatorName ? operatorDocByName.get(row.operatorName) : null;
    const vehicle = row.vehicleCode ? vehicleDocByKey.get(`${row.code}|${row.vehicleCode}`) : null;

    await RunCut.findOneAndUpdate(
      { division: division._id, route: route._id, dayOfWeek: row.dayOfWeek },
      {
        division: division._id,
        route: route._id,
        dayOfWeek: row.dayOfWeek,
        operator: operator?._id ?? null,
        vehicle: vehicle?._id ?? null,
        pulloutAddress: row.pulloutAddress,
        startTime: row.startTime,
        endTime: row.endTime,
      },
      { upsert: true }
    );
    templateCount += 1;

    const dayIndex = DAYS_OF_WEEK.indexOf(row.dayOfWeek);
    const date = addDays(weekStart, dayIndex);

    await RunCutDay.findOneAndUpdate(
      { division: division._id, route: route._id, date },
      {
        division: division._id,
        route: route._id,
        date,
        operator: operator?._id ?? null,
        vehicle: vehicle?._id ?? null,
        pulloutAddress: row.pulloutAddress,
        startTime: row.startTime,
        endTime: row.endTime,
        status: row.status,
        serviceHours: row.serviceHours,
        revenueHours: row.revenueHours,
      },
      { upsert: true }
    );
    dayCount += 1;
  }

  console.log(
    `Imported ${divisionDocByCode.size} divisions, ${routeDocByKey.size} routes, ${operatorDocByName.size} operators, ${vehicleDocByKey.size} vehicles, ${templateCount} run-cut templates, ${dayCount} run-cut days for the week of ${weekStart.toISOString().slice(0, 10)}.`
  );

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Import failed.");
  process.exit(1);
});
