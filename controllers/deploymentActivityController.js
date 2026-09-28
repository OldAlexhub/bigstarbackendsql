import XLSX from "xlsx";
import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
import Division from "../models/Division.js";
import { canAccessDivision } from "../middleware/access.js";
import { parseInclusiveDateRange } from "../utils/dateRange.js";

const EXPORT_HEADERS = ["Timestamp", "Division", "User Name", "Username", "Action", "Details"];

const escapeCsv = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const activityQuery = ({ division, from, to }, { datesRequired = false } = {}) => {
  if (!division) return { error: "division is required" };
  if (datesRequired && (!from || !to)) return { error: "from and to are required" };

  const query = { division };
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

export const listDeploymentActivity = async (req, res) => {
  const { division, from, to } = req.query;
  const { query, error } = activityQuery({ division, from, to });
  if (error) return res.status(400).json({ message: error });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const entries = await DeploymentActivityLog.find(query).sort({ createdAt: -1 }).limit(500);
  res.json({ entries });
};

export const exportDeploymentActivity = async (req, res) => {
  const { division, from, to } = req.query;
  const { query, error } = activityQuery({ division, from, to }, { datesRequired: true });
  if (error) return res.status(400).json({ message: error });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const divisionDoc = await Division.findById(division).select("code name").lean();
  if (!divisionDoc) return res.status(404).json({ message: "Division not found" });

  // Export is intentionally unbounded: the on-screen table is capped for
  // responsiveness, while a requested date-range download must contain the
  // complete audit trail for that range.
  const entries = await DeploymentActivityLog.find(query).sort({ createdAt: -1 }).lean();
  const divisionLabel = divisionDoc.name || divisionDoc.code || "";
  const format = req.query.format === "xlsx" ? "xlsx" : "csv";
  const safeDivision = String(divisionDoc.code || divisionDoc.name || "division")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "division";
  const filenameBase = `${safeDivision}-deployment-tracker-log-${from}-to-${to}`;

  if (format === "xlsx") {
    const rows = entries.map((entry) => [
      new Date(entry.createdAt),
      divisionLabel,
      entry.name || "",
      entry.username || "",
      entry.action || "",
      entry.summary || "",
    ]);
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...rows], { cellDates: true });
    worksheet["!cols"] = [
      { wch: 21 }, { wch: 24 }, { wch: 24 }, { wch: 20 }, { wch: 28 }, { wch: 70 },
    ];
    worksheet["!autofilter"] = { ref: `A1:F${rows.length + 1}` };
    for (let row = 2; row <= rows.length + 1; row += 1) {
      if (worksheet[`A${row}`]) worksheet[`A${row}`].z = "mm/dd/yyyy hh:mm:ss";
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tracker Log");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellDates: true });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buffer);
  }

  const rows = entries.map((entry) => [
    new Date(entry.createdAt).toISOString(),
    divisionLabel,
    entry.name || "",
    entry.username || "",
    entry.action || "",
    entry.summary || "",
  ]);
  const csv = [EXPORT_HEADERS, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
  return res.send(`\uFEFF${csv}`);
};
