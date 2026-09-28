import mongoose from "../db/sqlMongoose.js";
import XLSX from "xlsx";
import PDFDocument from "pdfkit";
import { computeEltOperationsReport } from "./eltReportingController.js";
import Division from "../models/Division.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import { divisionFilter } from "../middleware/access.js";
import { parseInclusiveDateRange } from "../utils/dateRange.js";
import {
  buildReportDataset,
  normalizeReportBuilderConfig,
  rawNetworkRowsFromEntries,
  reportBuilderMetadata,
} from "../utils/reportBuilder.js";
import { drawPdfTable, pdfPageLeft } from "../utils/pdfTable.js";

const parseDivisionIds = (raw) => {
  if (!raw) return { ids: null };
  const ids = [...new Set(String(raw).split(",").map((value) => value.trim()).filter(Boolean))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) {
    return { error: "Choose valid divisions." };
  }
  return { ids };
};

const resolveRequest = (query) => {
  const { from, to } = query;
  if (!from || !to) return { error: "from and to are required" };
  const range = parseInclusiveDateRange(from, to);
  if (range.error) return { error: range.error };
  const selected = parseDivisionIds(query.divisions);
  if (selected.error) return selected;
  return {
    from,
    to,
    fromDate: range.fromInclusive,
    toDate: new Date(range.toExclusive.getTime() - 1),
    divisionIds: selected.ids,
  };
};

const accessibleDivisionDocs = async (req, selectedIds) => {
  const filter = { ...divisionFilter(req.user), active: true };
  if (selectedIds?.length) {
    const ids = req.user.role === "ELT"
      ? selectedIds
      : selectedIds.filter((divisionId) =>
        req.user.divisionAccess.some((allowedId) => String(allowedId) === String(divisionId))
      );
    filter._id = { $in: ids };
  }
  return Division.find(filter).select("code name").sort({ code: 1 }).lean();
};

const loadRawNetworkRows = async (req, resolved, config) => {
  const divisions = await accessibleDivisionDocs(req, resolved.divisionIds);
  if (!divisions.length) return [];
  const filter = {
    division: { $in: divisions.map((division) => division._id) },
    date: { $gte: resolved.from, $lte: resolved.to },
  };
  if (config.networkSource !== "all") filter.source = config.networkSource;
  const entries = await NetworkKpiEntry.find(filter)
    .select("division source date sourceRouteCodes components metrics submission deployment assignmentOverride")
    .populate("submission", "files confirmedAt")
    .sort({ date: 1, division: 1, route: 1 })
    .lean();

  return rawNetworkRowsFromEntries(entries, divisions);
};

const loadDataset = async (req) => {
  const resolved = resolveRequest(req.query);
  if (resolved.error) return resolved;
  const config = normalizeReportBuilderConfig(req.query);
  if (config.source === "network_raw") {
    const networkRows = await loadRawNetworkRows(req, resolved, config);
    return {
      ...resolved,
      dataset: buildReportDataset({ networkRows }, config),
    };
  }
  const report = await computeEltOperationsReport(
    req,
    resolved.fromDate,
    resolved.toDate,
    resolved.divisionIds
  );
  return {
    ...resolved,
    dataset: buildReportDataset(report, req.query),
  };
};

const escapeCsv = (value) => {
  const string = String(value ?? "");
  const safe = /^[=+@]/.test(string.trimStart()) ? `'${string}` : string;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const filenamePart = (value) =>
  String(value || "report")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "report";

const worksheetRows = (dataset) => [
  dataset.columns.map((column) => column.label),
  ...dataset.rows.map((row) => dataset.columns.map((column) => row[column.key])),
];

export const getReportBuilderPreview = async (req, res) => {
  const result = await loadDataset(req);
  if (result.error) return res.status(400).json({ message: result.error });
  const previewLimit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  res.json({
    ...result.dataset,
    rows: result.dataset.rows.slice(0, previewLimit),
    previewLimit,
    from: result.from,
    to: result.to,
    metadata: reportBuilderMetadata(),
  });
};

export const exportBuiltReport = async (req, res) => {
  const result = await loadDataset(req);
  if (result.error) return res.status(400).json({ message: result.error });

  const { dataset, from, to } = result;
  const format = ["csv", "xlsx", "pdf"].includes(req.query.format) ? req.query.format : "xlsx";
  if (format === "pdf" && dataset.columns.length > 8) {
    return res.status(400).json({ message: "PDF exports support up to 8 selected columns. Use Excel for wider reports." });
  }

  const filenameBase = `${filenamePart(dataset.config.title)}-${from}-to-${to}`;
  const rows = worksheetRows(dataset);

  if (format === "csv") {
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
    return res.send(`\uFEFF${csv}`);
  }

  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!cols"] = dataset.columns.map((column) => ({ wch: column.width }));
    if (rows.length) {
      worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(dataset.columns.length - 1)}${rows.length}` };
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buffer);
  }

  const landscape = dataset.columns.length > 5;
  const doc = new PDFDocument({
    size: "letter",
    layout: landscape ? "landscape" : "portrait",
    margins: { top: 36, right: 32, bottom: 36, left: 32 },
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
  doc.pipe(res);

  const pageLeft = pdfPageLeft(doc);
  doc.fontSize(19).fillColor("#0f172a").text(dataset.config.title, pageLeft, doc.y);
  doc.moveDown(0.25);
  doc.fontSize(9).fillColor("#64748b").text(
    `${dataset.source.label} | ${from} to ${to} | ${dataset.total} record${dataset.total === 1 ? "" : "s"}`,
    pageLeft,
    doc.y
  );
  doc.moveDown(1);

  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWeight = dataset.columns.reduce((sum, column) => sum + column.pdfWeight, 0);
  const widths = dataset.columns.map((column) => availableWidth * (column.pdfWeight / totalWeight));
  const pdfRows = dataset.rows.map((row) => dataset.columns.map((column) => {
    const value = String(row[column.key] ?? "");
    return value.length > 320 ? `${value.slice(0, 317)}...` : value;
  }));
  drawPdfTable(
    doc,
    pageLeft,
    "Report detail",
    dataset.columns.map((column) => column.label),
    pdfRows,
    widths
  );
  doc.end();
};
