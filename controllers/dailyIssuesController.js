import XLSX from "xlsx";
import DailyIssueLog from "../models/DailyIssueLog.js";
import Division from "../models/Division.js";
import { canAccessDivision } from "../middleware/access.js";
import { logDeploymentActivity } from "../utils/deploymentActivityLog.js";
import { parseInclusiveDateRange } from "../utils/dateRange.js";
import { OSR_DISRUPTION_TYPES } from "../utils/disruptionTypes.js";

const REPORT_HEADERS = ["Date", "Route", "Operator", "Disruption", "Notes"];
const toISODate = (date) => new Date(date).toISOString().slice(0, 10);
const DUPLICATE_ISSUE_MESSAGE =
  "An issue already exists for this date, route, operator, and disruption type.";

const issueIdentity = ({ division, route, operator, date, disruptionType }) => ({
  division,
  route: route || null,
  operator: operator || null,
  date,
  disruptionType,
});

const promoteAutoIssue = (issueId, notes, userId) =>
  DailyIssueLog.findOneAndUpdate(
    { _id: issueId, autoSyncTag: { $ne: null } },
    { $set: { autoSyncTag: null, notes, createdBy: userId } },
    { returnDocument: "after" }
  );

const loadReportRows = async (req) => {
  const { division, from, to } = req.query;
  if (!division || !from || !to) {
    return { error: "division, from, and to are required" };
  }
  if (!canAccessDivision(req.user, division)) {
    return { error: "No access to this division", status: 403 };
  }

  const divisionDoc = await Division.findById(division);
  if (!divisionDoc) return { error: "Division not found", status: 404 };

  const range = parseInclusiveDateRange(from, to);
  if (range.error) return { error: range.error };

  const issues = await DailyIssueLog.find({
    division,
    date: { $gte: range.fromInclusive, $lt: range.toExclusive },
    ...(req.query.osr === "1" ? { disruptionType: { $in: OSR_DISRUPTION_TYPES } } : {}),
  })
    .populate("route", "code")
    .populate("operator", "name")
    .sort({ date: 1, createdAt: 1 })
    .limit(5000);

  return { divisionDoc, issues };
};

export const listDailyIssues = async (req, res) => {
  const { division, from, to } = req.query;
  if (!division) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const query = { division };
  if (from || to) {
    if (!from || !to) {
      return res.status(400).json({ message: "from and to are required together" });
    }
    const range = parseInclusiveDateRange(from, to);
    if (range.error) return res.status(400).json({ message: range.error });
    query.date = { $gte: range.fromInclusive, $lt: range.toExclusive };
  }

  const issues = await DailyIssueLog.find(query)
    .populate("route", "code")
    .populate("operator", "name")
    .sort({ date: -1, createdAt: -1 })
    .limit(200);
  res.json({ issues });
};

export const createDailyIssue = async (req, res) => {
  const { division, route, operator, date, disruptionType, notes } = req.body;
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const parsedDate = parseInclusiveDateRange(date, date);
  if (parsedDate.error) return res.status(400).json({ message: parsedDate.error });

  const identity = issueIdentity({
    division,
    route,
    operator,
    date: parsedDate.fromInclusive,
    disruptionType,
  });

  let issue = await DailyIssueLog.findOne(identity);
  if (issue && !issue.autoSyncTag) {
    return res.status(409).json({ message: DUPLICATE_ISSUE_MESSAGE });
  }

  if (issue) {
    // A manual entry is the operator's authoritative version. Promote the
    // matching generated row in place so its RunCutDay provenance remains
    // available, while clearing the auto tag makes the row editable.
    issue = await promoteAutoIssue(issue._id, notes, req.user._id);
    if (!issue) return res.status(409).json({ message: DUPLICATE_ISSUE_MESSAGE });
  } else {
    try {
      issue = await DailyIssueLog.create({
        ...identity,
        notes,
        createdBy: req.user._id,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const conflictingIssue = await DailyIssueLog.findOne(identity);
      if (!conflictingIssue || !conflictingIssue.autoSyncTag) {
        return res.status(409).json({ message: DUPLICATE_ISSUE_MESSAGE });
      }
      issue = await promoteAutoIssue(conflictingIssue._id, notes, req.user._id);
      if (!issue) return res.status(409).json({ message: DUPLICATE_ISSUE_MESSAGE });
    }
  }
  await issue.populate([
    { path: "route", select: "code" },
    { path: "operator", select: "name" },
  ]);

  logDeploymentActivity({
    division,
    user: req.user,
    action: "issue.created",
    summary: `Logged "${disruptionType}" for ${issue.route?.code || "no route"} on ${toISODate(issue.date)}`,
  });

  res.status(201).json({ issue });
};

// Auto-synced entries (autoSyncTag set) are derived from a RunCutDay's
// status/disruption/client notes — see server/utils/autoIssueSync.js — and get
// regenerated the next time that route's live day changes, so editing or
// deleting one here wouldn't stick. Only manually-logged entries can be
// changed through this endpoint; the real edit for an auto-synced one is
// changing the route's live-day fields in Deployment's Live Schedule.
export const updateDailyIssue = async (req, res) => {
  const issue = await DailyIssueLog.findById(req.params.id);
  if (!issue) return res.status(404).json({ message: "Issue not found" });
  if (!canAccessDivision(req.user, issue.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (issue.autoSyncTag) {
    return res.status(400).json({
      message: "This entry is auto-synced from the route's live day — change it from Deployment's Live Schedule instead.",
    });
  }

  const { route, operator, date, disruptionType, notes } = req.body;
  let normalizedDate = issue.date;
  if (date !== undefined) {
    const parsedDate = parseInclusiveDateRange(date, date);
    if (parsedDate.error) return res.status(400).json({ message: parsedDate.error });
    normalizedDate = parsedDate.fromInclusive;
  }

  const nextIdentity = issueIdentity({
    division: issue.division,
    route: route !== undefined ? route : issue.route,
    operator: operator !== undefined ? operator : issue.operator,
    date: normalizedDate,
    disruptionType: disruptionType !== undefined ? disruptionType : issue.disruptionType,
  });
  const duplicate = await DailyIssueLog.findOne({ ...nextIdentity, _id: { $ne: issue._id } });
  if (duplicate) return res.status(409).json({ message: DUPLICATE_ISSUE_MESSAGE });

  if (route !== undefined) issue.route = route || null;
  if (operator !== undefined) issue.operator = operator || null;
  if (date !== undefined) issue.date = normalizedDate;
  if (disruptionType !== undefined) issue.disruptionType = disruptionType;
  if (notes !== undefined) issue.notes = notes;

  await issue.save();
  await issue.populate([
    { path: "route", select: "code" },
    { path: "operator", select: "name" },
  ]);

  logDeploymentActivity({
    division: issue.division,
    user: req.user,
    action: "issue.updated",
    summary: `Updated "${issue.disruptionType}" for ${issue.route?.code || "no route"} on ${toISODate(issue.date)}`,
  });

  res.json({ issue });
};

// One row per issue/route-closure event within a date range — the
// unbounded, date-filtered counterpart to listDailyIssues (which is capped
// at 200 for the always-on Issue Log view). Same DailyIssueLog data either
// way: a closure is already represented here whether it came from a
// manually-logged entry or an auto-synced live-day change.
export const listDailyIssuesReport = async (req, res) => {
  const { error, status, issues } = await loadReportRows(req);
  if (error) return res.status(status || 400).json({ message: error });
  res.json({ issues });
};

export const exportDailyIssues = async (req, res) => {
  const { error, status, divisionDoc, issues } = await loadReportRows(req);
  if (error) return res.status(status || 400).json({ message: error });

  const { from, to } = req.query;
  const format = req.query.format === "xlsx" ? "xlsx" : "csv";
  const filenameBase = `${divisionDoc.code}-${req.query.osr === "1" ? "osrs" : "issues"}-${from}-to-${to}`;
  const rows = issues.map((i) => [
    toISODate(i.date),
    i.route?.code || "",
    i.operator?.name || "",
    i.disruptionType,
    i.notes || "",
  ]);

  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([REPORT_HEADERS, ...rows]);
    ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 26 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, "Issues");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buffer);
  }

  const escapeCsv = (value) => {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [REPORT_HEADERS, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
  res.send(csv);
};

export const deleteDailyIssue = async (req, res) => {
  const issue = await DailyIssueLog.findById(req.params.id).populate("route", "code");
  if (!issue) return res.status(404).json({ message: "Issue not found" });
  if (!canAccessDivision(req.user, issue.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (issue.autoSyncTag) {
    return res.status(400).json({
      message: "This entry is auto-synced from the route's live day — change it from Deployment's Live Schedule instead.",
    });
  }

  logDeploymentActivity({
    division: issue.division,
    user: req.user,
    action: "issue.deleted",
    summary: `Deleted "${issue.disruptionType}" for ${issue.route?.code || "no route"} on ${toISODate(issue.date)}`,
  });

  await issue.deleteOne();
  res.json({ message: "Issue deleted" });
};
