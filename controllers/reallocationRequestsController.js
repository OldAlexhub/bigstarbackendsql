import mongoose from "../db/sqlMongoose.js";
import XLSX from "xlsx";
import ReallocationRequest from "../models/ReallocationRequest.js";
import RunCut from "../models/RunCut.js";
import Division from "../models/Division.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { parseDateOnly } from "../utils/dateRange.js";
import { approveOrApplyReallocation, normalizeReallocationAssignment } from "../utils/reallocationRequests.js";
import { respondToHttpError } from "../utils/httpError.js";
import { resolveOperator, resolveVehicle } from "../utils/resolveAssignment.js";

const populateRequest = (query) =>
  query
    .populate("division", "code name timezone")
    .populate("requestedBy", "name username")
    .populate("reviewedBy", "name username");

const clean = (value) => String(value || "").trim();

const exportPerson = (request, kind) => {
  const populated = request[`${kind}By`];
  const name = populated?.name || request[`${kind}ByName`] || "";
  const username = populated?.username || request[`${kind}ByUsername`] || "";
  if (name && username) return `${name} (${username})`;
  return name || username || "";
};

const exportStatus = (status) => ({
  pending: "Pending Deployment",
  approved: "Approved - Scheduled",
  applied: "Applied",
}[status] || status || "");

const EXPORT_HEADERS = [
  "Division",
  "Submitted",
  "Current Route",
  "Destination Route",
  "Original Operator",
  "Original Vehicle",
  "Original Pullout Address",
  "Requested Operator",
  "Requested Vehicle",
  "Requested Pullout Address",
  "Effective Date",
  "Status",
  "Submitted By",
  "Accepted By",
  "Reviewed At",
  "Applied At",
  "Application Error",
];

const requestExportRow = (request, excel = false) => {
  const dateValue = (value, dateOnly = false) => {
    if (!value) return "";
    if (excel) return new Date(value);
    return dateOnly ? String(value).slice(0, 10) : new Date(value).toISOString();
  };
  return [
    request.division?.name || request.division?.code || "",
    dateValue(request.createdAt),
    request.routeCode || "",
    request.destinationRouteCode || "",
    request.originalOperatorName || "",
    request.originalVehicleCode || "",
    request.originalPulloutAddress || "",
    request.requestedOperatorName || "",
    request.requestedVehicleCode || "",
    request.requestedPulloutAddress || "",
    dateValue(request.effectiveDate, true),
    exportStatus(request.status),
    exportPerson(request, "requested"),
    exportPerson(request, "reviewed"),
    dateValue(request.reviewedAt),
    dateValue(request.appliedAt),
    request.applicationError || "",
  ];
};

const escapeCsv = (value) => {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const countsByDivision = (requests) => requests.reduce((counts, request) => {
  const key = String(request.division);
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

const requestForUser = (request, user) => {
  const value = request.toObject ? request.toObject() : request;
  const seenBy = value.networkSeenBy || [];
  delete value.networkSeenBy;
  return {
    ...value,
    networkUnread:
      value.status !== "pending" &&
      !seenBy.some((userId) => String(userId) === String(user._id)),
  };
};

export const listReallocationRequests = async (req, res) => {
  const { division } = req.query;
  if (!mongoose.isValidObjectId(division)) {
    return res.status(400).json({ message: "Choose a division." });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const [requests, pendingCount] = await Promise.all([
    populateRequest(ReallocationRequest.find({ division }).sort({ createdAt: -1 }).limit(250)),
    ReallocationRequest.countDocuments({ division, status: "pending" }),
  ]);
  res.json({ requests: requests.map((request) => requestForUser(request, req.user)), pendingCount });
};

export const exportReallocationRequests = async (req, res) => {
  const { division } = req.query;
  if (!mongoose.isValidObjectId(division)) {
    return res.status(400).json({ message: "Choose a division." });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const divisionDoc = await Division.findById(division).select("code name").lean();
  if (!divisionDoc) return res.status(404).json({ message: "Division not found." });

  const requests = await populateRequest(
    ReallocationRequest.find({ division }).sort({ createdAt: -1 })
  );
  const format = req.query.format === "xlsx" ? "xlsx" : "csv";
  const safeDivision = String(divisionDoc.code || divisionDoc.name || "division")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "division";
  const filenameBase = `${safeDivision}-reallocation-request-history`;

  if (format === "xlsx") {
    const rows = requests.map((request) => requestExportRow(request, true));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...rows], { cellDates: true });
    worksheet["!cols"] = [
      { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 16 },
      { wch: 32 }, { wch: 24 }, { wch: 18 }, { wch: 32 }, { wch: 14 }, { wch: 23 },
      { wch: 28 }, { wch: 28 }, { wch: 20 }, { wch: 20 }, { wch: 38 },
    ];
    worksheet["!autofilter"] = { ref: `A1:Q${rows.length + 1}` };
    for (let row = 2; row <= rows.length + 1; row += 1) {
      if (worksheet[`B${row}`]) worksheet[`B${row}`].z = "mm/dd/yyyy hh:mm";
      if (worksheet[`K${row}`]) worksheet[`K${row}`].z = "mm/dd/yyyy";
      if (worksheet[`O${row}`]) worksheet[`O${row}`].z = "mm/dd/yyyy hh:mm";
      if (worksheet[`P${row}`]) worksheet[`P${row}`].z = "mm/dd/yyyy hh:mm";
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, "Request History");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellDates: true });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.send(buffer);
  }

  const rows = requests.map((request) => requestExportRow(request));
  const csv = [EXPORT_HEADERS, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
  return res.send(`\uFEFF${csv}`);
};

export const getReallocationNotifications = async (req, res) => {
  const divisionIds = await Division.find({
    ...divisionFilter(req.user),
    active: { $ne: false },
  }).distinct("_id");
  const unread = await ReallocationRequest.find({
    division: { $in: divisionIds },
    status: { $in: ["approved", "applied"] },
    networkSeenBy: { $ne: req.user._id },
  }).select("division").lean();
  res.json({ count: unread.length, byDivision: countsByDivision(unread) });
};

export const getPendingReallocationNotifications = async (req, res) => {
  const divisionIds = await Division.find({
    ...divisionFilter(req.user),
    active: { $ne: false },
  }).distinct("_id");
  const pending = await ReallocationRequest.find({
    division: { $in: divisionIds },
    status: "pending",
  }).select("division").lean();
  res.json({ count: pending.length, byDivision: countsByDivision(pending) });
};

export const acknowledgeReallocationNotifications = async (req, res) => {
  const { division } = req.body;
  if (!mongoose.isValidObjectId(division)) return res.status(400).json({ message: "Choose a division." });
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const result = await ReallocationRequest.updateMany(
    { division, status: { $in: ["approved", "applied"] }, networkSeenBy: { $ne: req.user._id } },
    { $addToSet: { networkSeenBy: req.user._id } }
  );
  res.json({ acknowledged: result.modifiedCount || 0 });
};

export const createReallocationRequest = async (req, res) => {
  const { division, runCut, destinationRunCut, effectiveDate } = req.body;
  if (!mongoose.isValidObjectId(division) || !mongoose.isValidObjectId(runCut)) {
    return res.status(400).json({ message: "Choose a division and current route." });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const parsedDate = parseDateOnly(effectiveDate, "effectiveDate");
  if (parsedDate.error) return res.status(400).json({ message: parsedDate.error });

  let requestedOperatorName = clean(req.body.operatorName);
  let requestedVehicleCode = clean(req.body.vehicleCode);
  let requestedPulloutAddress = clean(req.body.pulloutAddress);
  if (requestedOperatorName.length > 120 || requestedVehicleCode.length > 50 || requestedPulloutAddress.length > 300) {
    return res.status(400).json({ message: "One or more requested assignment fields are too long." });
  }

  const current = await RunCut.findById(runCut)
    .populate("route", "code")
    .populate("operator", "name")
    .populate("vehicle", "code");
  if (!current || String(current.division) !== String(division)) {
    return res.status(404).json({ message: "Current route assignment not found." });
  }

  let destination = null;
  if (destinationRunCut && String(destinationRunCut) !== String(runCut)) {
    if (!mongoose.isValidObjectId(destinationRunCut)) {
      return res.status(400).json({ message: "Choose a valid destination route." });
    }
    destination = await RunCut.findById(destinationRunCut)
      .populate("route", "code")
      .populate("operator", "name")
      .populate("vehicle", "code");
    if (!destination || String(destination.division) !== String(division)) {
      return res.status(404).json({ message: "Destination route assignment not found." });
    }
    if (destination.operator) {
      return res.status(409).json({ message: `Route ${destination.route?.code || "selected"} is already assigned. Choose an unassigned destination route.` });
    }
    if (destination.status !== "unassigned") {
      return res.status(409).json({ message: `Route ${destination.route?.code || "selected"} must be marked Unassigned in Master Run Cuts before it can receive this assignment.` });
    }
  }

  ({ vehicleCode: requestedVehicleCode, pulloutAddress: requestedPulloutAddress } = normalizeReallocationAssignment({
    movingRoutes: Boolean(destination),
    operatorName: requestedOperatorName,
    vehicleCode: requestedVehicleCode,
    pulloutAddress: requestedPulloutAddress,
  }));

  // Snapshot only controlled roster values. The browser presents selects,
  // but this server-side resolution prevents a hand-crafted request from
  // introducing a driver, vehicle, or pullout address that is not in the
  // selected division's active Master Run Cuts rosters.
  try {
    const rosterOperatorName = requestedOperatorName || (destination ? current.operator?.name || "" : "");
    const operatorDoc = await resolveOperator(division, rosterOperatorName);
    const vehicleDoc = await resolveVehicle(division, requestedVehicleCode);
    if (requestedOperatorName) requestedOperatorName = operatorDoc.name;
    requestedVehicleCode = vehicleDoc?.code || "";
    requestedPulloutAddress = operatorDoc?.pulloutAddress || "";
  } catch (error) {
    return respondToHttpError(error, res);
  }

  const originalOperatorName = current.operator?.name || "";
  const originalVehicleCode = current.vehicle?.code || "";
  const originalPulloutAddress = current.pulloutAddress || "";
  const changed = Boolean(destination) ||
    originalOperatorName.toLowerCase() !== requestedOperatorName.toLowerCase() ||
    originalVehicleCode.toLowerCase() !== requestedVehicleCode.toLowerCase() ||
    originalPulloutAddress !== requestedPulloutAddress;
  if (!changed) return res.status(400).json({ message: "Enter at least one assignment change." });

  try {
    const duplicate = await ReallocationRequest.findOne({
      open: true,
      involvedRunCuts: { $in: [current._id, destination?._id].filter(Boolean) },
    }).select("_id");
    if (duplicate) {
      return res.status(409).json({ message: "One of these routes already has a pending reallocation request." });
    }

    const created = await ReallocationRequest.create({
      division,
      runCut: current._id,
      involvedRunCuts: [current._id, destination?._id].filter(Boolean),
      route: current.route._id,
      routeCode: current.route.code,
      destinationRunCut: destination?._id || null,
      destinationRoute: destination?.route?._id || null,
      destinationRouteCode: destination?.route?.code || "",
      destinationOriginalOperatorName: destination?.operator?.name || "",
      destinationOriginalVehicleCode: destination?.vehicle?.code || "",
      destinationOriginalPulloutAddress: destination?.pulloutAddress || "",
      originalOperatorName,
      originalVehicleCode,
      originalPulloutAddress,
      requestedOperatorName,
      requestedVehicleCode,
      requestedPulloutAddress,
      effectiveDate: parsedDate.date,
      requestedBy: req.user._id,
      requestedByName: req.user.name || "",
      requestedByUsername: req.user.username || "",
    });
    const request = await populateRequest(ReallocationRequest.findById(created._id));
    res.status(201).json({ request });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "This route already has a pending reallocation request." });
    }
    throw error;
  }
};

export const acceptReallocationRequest = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid reallocation request." });
  }

  const existing = await ReallocationRequest.findById(req.params.id).select("division status");
  if (!existing) return res.status(404).json({ message: "Reallocation request not found." });
  if (!canAccessDivision(req.user, existing.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  try {
    const result = await approveOrApplyReallocation(existing._id, req.user);
    res.json({
      ...result,
      message: result.applied
        ? "Reallocation accepted and applied to the Master Run Cut."
        : "Reallocation accepted and scheduled for its effective date.",
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }
};
