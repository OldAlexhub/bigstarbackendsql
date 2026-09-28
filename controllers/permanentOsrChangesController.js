import XLSX from "xlsx";
import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
import Division from "../models/Division.js";
import { canAccessDivision } from "../middleware/access.js";
import { parseInclusiveDateRange } from "../utils/dateRange.js";

const PERMANENT_OSR_ACTION = "runcut.permanent_osr_updated";
const EXPORT_HEADERS = ["Timestamp", "Division", "Route", "Field", "From", "To", "Reason", "Changed By", "Username"];

// One DeploymentActivityLog row per Permanent OSR submission can carry
// several changed fields — flattened here into one row per field so a
// "from -> to" report reads as a plain table instead of one dense summary
// cell per submission.
const flattenEntries = (entries) =>
  entries.flatMap((entry) =>
    (entry.changes?.length ? entry.changes : [{ field: "", from: "", to: "" }]).map((change) => ({
      createdAt: entry.createdAt,
      route: entry.route || "",
      field: change.field || "",
      from: change.from || "",
      to: change.to || "",
      reason: entry.reason || "",
      name: entry.name || "",
      username: entry.username || "",
    }))
  );

const permanentOsrQuery = ({ division, from, to }, { datesRequired = false } = {}) => {
  if (!division) return { error: "division is required" };
  if (datesRequired && (!from || !to)) return { error: "from and to are required" };

  const query = { division, action: PERMANENT_OSR_ACTION };
  if (from && to) {
    const range = parseInclusiveDateRange(from, to);
    if (range.error) return { error: range.error };
    query.createdAt = { $gte: range.fromInclusive, $lt: range.toExclusive };
  } else if (from) {
    const range = parseInclusiveDateRange(from, from);
    if (range.error) return { error: range.error };
    query.createdAt = { $gte: range.fromInclusive };
  } else if (to) {
    const range = parseInclusiveDateRange(to, to);
    if (range.error) return { error: range.error };
    query.createdAt = { $lt: range.toExclusive };
  }
  return { query };
};

export const listPermanentOsrChanges = async (req, res) => {
  const { division, from, to } = req.query;
  const { query, error } = permanentOsrQuery({ division, from, to });
  if (error) return res.status(400).json({ message: error });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const entries = await DeploymentActivityLog.find(query).sort({ createdAt: -1 }).limit(500).lean();
  res.json({ entries: flattenEntries(entries) });
};

export const exportPermanentOsrChanges = async (req, res) => {
  const { division, from, to } = req.query;
  const { query, error } = permanentOsrQuery({ division, from, to }, { datesRequired: true });
  if (error) return res.status(400).json({ message: error });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const divisionDoc = await Division.findById(division).select("code name").lean();
  if (!divisionDoc) return res.status(404).json({ message: "Division not found" });

  // Export is intentionally unbounded, same as the Tracker Log export: the
  // on-screen list is capped for responsiveness, the download is not.
  const entries = await DeploymentActivityLog.find(query).sort({ createdAt: -1 }).lean();
  const rows = flattenEntries(entries);
  const divisionLabel = divisionDoc.name || divisionDoc.code || "";
  const format = req.query.format === "xlsx" ? "xlsx" : "csv";
  const safeDivision = String(divisionDoc.code || divisionDoc.name || "division")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "division";
  const filenameBase = `${safeDivision}-permanent-osr-changes-${from}-to-${to}`;

  if (format === "xlsx") {
    const aoa = rows.map((row) => [
      new Date(row.createdAt), divisionLabel, row.route, row.field, row.from, row.to, row.reason, row.name, row.username,
    ]);
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...aoa], { cellDates: true });
    worksheet["!cols"] = [
      { wch: 21 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 24 }, { wch: 24 }, { wch: 40 }, { wch: 20 }, { wch: 16 },
    ];
    worksheet["!autofilter"] = { ref: `A1:I${aoa.length + 1}` };
    for (let row = 2; row <= aoa.length + 1; row += 1) {
      if (worksheet[`A${row}`]) worksheet[`A${row}`].z = "mm/dd/yyyy hh:mm:ss";
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, "Permanent OSR Changes");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellDates: true });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buffer);
  }

  const escapeCsv = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csvRows = rows.map((row) => [
    new Date(row.createdAt).toISOString(), divisionLabel, row.route, row.field, row.from, row.to, row.reason, row.name, row.username,
  ]);
  const csv = [EXPORT_HEADERS, ...csvRows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
  return res.send(`﻿${csv}`);
};
