import ExcelJS from "exceljs";
import RunCutDay from "../models/RunCutDay.js";
import RunCut from "../models/RunCut.js";
import Division from "../models/Division.js";
import { canAccessDivision } from "../middleware/access.js";
import { DAYS_OF_WEEK, RUN_CUT_STATUSES } from "../utils/hours.js";
import { getBranchGroupDivisionIds } from "../utils/divisionBranches.js";
import { parseDateOnly } from "../utils/dateRange.js";

const WORK_ORDER_SPAN_DAYS = 7;

const STATUS_LABELS = {
  active: "Active",
  unassigned: "Unassigned",
  suspended: "Suspended",
  off: "Off",
  add_rte: "Add Rte",
};

// Confirms every RunCutDay status this app can produce has a Work Order
// label, so a future status addition fails loudly here instead of printing
// a blank cell on the exported document.
RUN_CUT_STATUSES.forEach((status) => {
  if (!STATUS_LABELS[status]) throw new Error(`Missing Work Order status label for "${status}"`);
});

const HEADERS = [
  "Division",
  "DAY",
  "DATE",
  "ASSIGNMENT / ROUTE",
  "OPERATOR",
  "VEH",
  "PULLOUT ADDRESS",
  "START TIME",
  "END TIME",
  "DAILY CHANGES",
  "CLIENT NOTES",
];
const COLUMN_WIDTHS = [10, 12, 11, 18, 20, 16, 38, 12, 12, 12, 38];
// 1-indexed column numbers that print bold on every data row, matching the
// reference Work Order template (Division, Day, Date, Route, Pullout).
const BOLD_COLUMNS = new Set([1, 2, 3, 4, 7]);
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B0F0" } };
const NOTE_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
const THIN = { style: "thin" };
const ALL_BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const FONT_NAME = "Calibri";

// exceljs serializes a Date cell from its absolute getTime() (UTC), not its
// local wall-clock fields — building this with the local Date constructor
// would silently shift every time by the server's UTC offset once written.
const timeToDate = (hhmm) => {
  if (!hhmm) return null;
  const [hours, minutes] = hhmm.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return new Date(Date.UTC(1970, 0, 1, hours, minutes));
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

// One RunCutDay projection per route per date, the same live data Live
// Schedule and the daily Client Report read — so a day-specific OSR
// processed in Live Schedule (a status change, a reassignment, a note) is
// already baked into these rows, while the persistent Master Run Cut stays
// untouched unless that OSR was a Permanent OSR.
const loadWorkOrderDays = async ({ divisionDoc, dates }) => {
  const branchDivisionIds = await getBranchGroupDivisionIds(divisionDoc._id);
  const from = dates[0];
  const to = addDays(dates[dates.length - 1], 1);

  const allDays = await RunCutDay.find({
    division: { $in: branchDivisionIds },
    date: { $gte: from, $lt: to },
  })
    .populate("route", "code type")
    .populate("operator", "name")
    .populate("vehicle", "code")
    .populate("coveringRoute", "code")
    .lean();

  const scoped = allDays.filter(
    (day) => String(day.division) === String(divisionDoc._id) || day.route?.type === "standby"
  );

  const byDate = new Map();
  for (const day of scoped) {
    const key = day.date.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(day);
  }

  // A route's own address is its standing Master Run Cut pullout, used as a
  // fallback when a covered day's own record has none (e.g. that day is
  // Unassigned) — only fetched when this division actually keeps its own.
  const keepsOwnPulloutAddress = Boolean(divisionDoc.pulloutAddressRules?.standbyKeepsRouteAddress);
  let masterPulloutByRouteId = new Map();
  if (keepsOwnPulloutAddress) {
    const masterRunCuts = await RunCut.find({ division: divisionDoc._id }, "route pulloutAddress").lean();
    masterPulloutByRouteId = new Map(masterRunCuts.map((rc) => [rc.route.toString(), rc.pulloutAddress]));
  }

  return dates.map((date) => {
    const key = date.toISOString().slice(0, 10);
    const dayDocs = byDate.get(key) || [];

    const coverageByRouteId = new Map();
    dayDocs
      .filter((day) => day.route?.type === "standby" && day.deployed && day.coveringRoute)
      .forEach((standbyDay) => coverageByRouteId.set(standbyDay.coveringRoute._id.toString(), standbyDay));

    // Every non-standby row here belongs to the requested division itself
    // (standby-type rows are the only ones pulled in from a shared branch
    // pool), so its own pulloutAddressRules toggle applies to all of them.
    const rows = dayDocs.map((day) => {
      const isStandby = day.route?.type === "standby";
      const coveringStandby = !isStandby ? coverageByRouteId.get(day.route?._id?.toString()) : null;
      const pulloutAddress = coveringStandby
        ? (keepsOwnPulloutAddress
            ? day.pulloutAddress || masterPulloutByRouteId.get(day.route?._id?.toString()) || ""
            : coveringStandby.pulloutAddress)
        : day.pulloutAddress;
      return {
        division: `${divisionDoc.code}${isStandby ? "_SB" : ""}`,
        route: day.route?.code ?? "",
        operator: (coveringStandby ? coveringStandby.operator?.name : day.operator?.name) || "",
        vehicle: (coveringStandby ? coveringStandby.vehicle?.code : day.vehicle?.code) || "",
        pulloutAddress: pulloutAddress || "",
        startTime: coveringStandby ? coveringStandby.startTime : day.startTime,
        endTime: coveringStandby ? coveringStandby.endTime : day.endTime,
        statusLabel: STATUS_LABELS[day.status] || day.status || "",
        clientNotes: coveringStandby
          ? [day.clientNotes, `Covered by standby ${coveringStandby.route?.code || ""}`].filter(Boolean).join(" — ")
          : day.clientNotes || "",
        isStandby,
      };
    });

    rows.sort((a, b) => {
      if (a.isStandby !== b.isStandby) return a.isStandby ? 1 : -1;
      return String(a.route).localeCompare(String(b.route), undefined, { numeric: true });
    });

    return { date, dayAbbrev: DAYS_OF_WEEK[date.getUTCDay()], rows };
  });
};

const buildWorkbook = ({ divisionCode, days }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  for (const day of days) {
    const sheet = workbook.addWorksheet(day.dayAbbrev);
    sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

    const headerRow = sheet.addRow(HEADERS);
    headerRow.height = 28.5;
    headerRow.eachCell((cell) => {
      cell.font = { name: FONT_NAME, size: 11, bold: true };
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = ALL_BORDERS;
    });

    if (day.rows.length === 0) {
      const emptyRow = sheet.addRow([
        divisionCode, day.dayAbbrev, day.date, "", "No routes scheduled", "", "", "", "", "", "",
      ]);
      emptyRow.getCell(3).numFmt = "m/d";
      emptyRow.eachCell((cell, colNumber) => {
        cell.border = ALL_BORDERS;
        cell.font = { name: FONT_NAME, size: 11, bold: BOLD_COLUMNS.has(colNumber) };
      });
      continue;
    }

    for (const row of day.rows) {
      const excelRow = sheet.addRow([
        row.division,
        day.dayAbbrev,
        day.date,
        row.route,
        row.operator,
        row.vehicle,
        row.pulloutAddress,
        timeToDate(row.startTime),
        timeToDate(row.endTime),
        row.statusLabel,
        row.clientNotes,
      ]);
      excelRow.getCell(3).numFmt = "m/d";
      excelRow.getCell(8).numFmt = "h:mm";
      excelRow.getCell(9).numFmt = "h:mm";
      excelRow.eachCell((cell, colNumber) => {
        cell.border = ALL_BORDERS;
        cell.font = { name: FONT_NAME, size: 11, bold: BOLD_COLUMNS.has(colNumber) };
      });
      if (row.clientNotes) {
        const notesCell = excelRow.getCell(11);
        notesCell.fill = NOTE_FILL;
        notesCell.font = { name: FONT_NAME, size: 11, bold: true };
      }
    }
  }

  return workbook;
};

const mmddyy = (date) =>
  `${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}${String(
    date.getUTCFullYear()
  ).slice(-2)}`;

export const getWorkOrderReport = async (req, res) => {
  const { division, from } = req.query;
  if (!division || !from) {
    return res.status(400).json({ message: "division and from are required" });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const parsedFrom = parseDateOnly(from, "from");
  if (parsedFrom.error) return res.status(400).json({ message: parsedFrom.error });

  const divisionDoc = await Division.findById(division).select("code name pulloutAddressRules").lean();
  if (!divisionDoc) return res.status(404).json({ message: "Division not found" });

  const dates = Array.from({ length: WORK_ORDER_SPAN_DAYS }, (_, index) => addDays(parsedFrom.date, index));
  const days = await loadWorkOrderDays({ divisionDoc, dates });
  const workbook = buildWorkbook({ divisionCode: divisionDoc.code, days });

  const safeDivision = String(divisionDoc.code || "division").replace(/[^a-z0-9_-]+/gi, "-");
  const filename = `${safeDivision}_WO_${mmddyy(dates[0])}_${mmddyy(dates[dates.length - 1])}.xlsx`;

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
};
