import RunCut from "../models/RunCut.js";
import Division from "../models/Division.js";
import ChangeLog from "../models/ChangeLog.js";
import Operator from "../models/Operator.js";
import Vehicle from "../models/Vehicle.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { computeHours } from "../utils/hours.js";
import { getEffectiveThresholds } from "../utils/thresholds.js";
import { todayInTimezone } from "../utils/timezone.js";
import { projectAssignment } from "../utils/projectAssignment.js";
import {
  resolveOperator,
  resolveVehicle,
  findOperatorConflict,
  findVehicleConflict,
  findVehicleConflictIds,
} from "../utils/resolveAssignment.js";
import { addMonths, monthInTimezone } from "../utils/operationsKpis.js";
import { queueOperationsRefresh } from "../utils/operationsReporting.js";
import { runInTransaction } from "../utils/transaction.js";
import { httpError, respondToHttpError } from "../utils/httpError.js";
import { logDeploymentActivity } from "../utils/deploymentActivityLog.js";
import { OSR_DISRUPTION_TYPE } from "../utils/disruptionTypes.js";

const queueProjectedMonths = (division, timezone) => {
  const month = monthInTimezone(timezone);
  queueOperationsRefresh(division, month);
  queueOperationsRefresh(division, addMonths(month, 1));
};

const populateRunCut = (query) =>
  query
    .populate("route", "code type")
    .populate("operator", "name pulloutAddress division active")
    .populate("vehicle", "code division active")
    .populate("division", "code name");

const excludeStandby = (runCuts, includeStandby) =>
  includeStandby ? runCuts : runCuts.filter((rc) => rc.route?.type !== "standby");

const conflictMessage = (conflict) =>
  `This operator is already assigned to route ${conflict.routeCode} on ${conflict.days.join(", ")} ` +
  `from ${conflict.startTime} to ${conflict.endTime} — that overlaps with this assignment.`;

const vehicleConflictMessage = (conflict) =>
  `This vehicle is already assigned to route ${conflict.routeCode} on ${conflict.days.join(", ")} ` +
  `from ${conflict.startTime} to ${conflict.endTime}; that overlaps with this assignment.`;

// Flags rows whose vehicle is double-booked (same vehicle, overlapping day
// + time) against another row in the same result set — reusing a vehicle
// across non-overlapping shifts is normal and left unflagged.
const withVehicleConflictFlags = (runCuts) => {
  const conflictIds = findVehicleConflictIds(runCuts);
  return runCuts.map((rc) => {
    const plain = rc.toObject ? rc.toObject() : rc;
    return { ...plain, vehicleConflict: conflictIds.has(rc._id.toString()) };
  });
};

export const listRunCuts = async (req, res) => {
  const includeStandby = req.query.includeStandby === "1";

  if (req.query.division) {
    if (!canAccessDivision(req.user, req.query.division)) {
      return res.status(403).json({ message: "No access to this division" });
    }
    const runCuts = await populateRunCut(RunCut.find({ division: req.query.division }));
    return res.json({ runCuts: withVehicleConflictFlags(excludeStandby(runCuts, includeStandby)) });
  }

  const accessibleDivisionIds = await Division.find({
    ...divisionFilter(req.user),
    active: { $ne: false },
  }).distinct("_id");
  const runCuts = await populateRunCut(RunCut.find({ division: { $in: accessibleDivisionIds } }));
  res.json({ runCuts: withVehicleConflictFlags(excludeStandby(runCuts, includeStandby)) });
};

export const createRunCut = async (req, res) => {
  const { division, route, daysOfWeek, operatorId, operatorName, vehicleId, vehicleCode, startTime, endTime, status } =
    req.body;
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  let runCutId;
  let timezone;
  try {
    await runInTransaction(async () => {
      const operatorDoc = await resolveOperator(division, operatorId ?? operatorName);
      const vehicleDoc = await resolveVehicle(division, vehicleId ?? vehicleCode);
      const operator = operatorDoc?._id || null;
      const vehicle = vehicleDoc?._id || null;
      const resolvedStatus = status || "active";
      const conflict = await findOperatorConflict({
        operator,
        daysOfWeek: daysOfWeek || [],
        startTime,
        endTime,
        status: resolvedStatus,
      });
      if (conflict) throw httpError(409, conflictMessage(conflict));
      const vehicleConflict = await findVehicleConflict({
        vehicle,
        daysOfWeek: daysOfWeek || [],
        startTime,
        endTime,
        status: resolvedStatus,
      });
      if (vehicleConflict) throw httpError(409, vehicleConflictMessage(vehicleConflict));

      const divisionDoc = await Division.findById(division);
      const thresholds = await getEffectiveThresholds(divisionDoc, todayInTimezone(divisionDoc.timezone));
      const { serviceHours, revenueHours } = computeHours({
        startTime,
        endTime,
        status: resolvedStatus,
        ...thresholds,
      });

      const runCut = await RunCut.create({
        division,
        route,
        daysOfWeek: daysOfWeek || [],
        operator,
        vehicle,
        pulloutAddress: operatorDoc?.pulloutAddress || "",
        startTime,
        endTime,
        status: resolvedStatus,
        serviceHours,
        revenueHours,
        updatedBy: req.user._id,
      });

      await projectAssignment(runCut, req.user._id);
      runCutId = runCut._id;
      timezone = divisionDoc.timezone;
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }

  queueProjectedMonths(division, timezone);
  const populated = await populateRunCut(RunCut.findById(runCutId));
  res.status(201).json({ runCut: populated });
};

const RUN_CUT_EDITABLE_FIELDS = [
  "daysOfWeek",
  "operator",
  "vehicle",
  "pulloutAddress",
  "startTime",
  "endTime",
  "status",
  "clientNotes",
  "disruptionType",
  "disruptionNotes",
];

// Shared by updateRunCut (Master Run Cuts) and updateRunCutPermanentOsr
// (Deployment's Permanent OSR) — both edit the same persistent RunCut the
// same way: resolve operator/vehicle by id or name, diff the editable
// fields, block a recurring day/time conflict, recompute hours, save, and
// re-project the standing change onto the rolling RunCutDay window
// (projectAssignment leaves any day that already has its own Deployment
// override alone). Only the caller-facing response and audit trail differ.
const applyRunCutEdit = async (runCut, rawBody, userId) => {
  const body = { ...rawBody };
  const operatorWasUpdated = body.operatorId !== undefined || body.operatorName !== undefined;
  let operatorDoc;
  if (operatorWasUpdated) {
    operatorDoc = await resolveOperator(
      runCut.division,
      body.operatorId !== undefined ? body.operatorId : body.operatorName
    );
    body.operator = operatorDoc?._id || null;
    body.pulloutAddress = operatorDoc?.pulloutAddress || "";
    delete body.operatorId;
    delete body.operatorName;
  }
  if (!operatorWasUpdated) delete body.pulloutAddress;
  let vehicleDoc;
  if (body.vehicleId !== undefined || body.vehicleCode !== undefined) {
    vehicleDoc = await resolveVehicle(
      runCut.division,
      body.vehicleId !== undefined ? body.vehicleId : body.vehicleCode
    );
    body.vehicle = vehicleDoc?._id || null;
    delete body.vehicleId;
    delete body.vehicleCode;
  }

  const changes = [];
  for (const field of RUN_CUT_EDITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    const oldValue = runCut[field];
    const newValue = body[field];
    const changed =
      field === "daysOfWeek"
        ? JSON.stringify([...(oldValue || [])].sort()) !== JSON.stringify([...(newValue || [])].sort())
        : String(oldValue ?? "") !== String(newValue ?? "");
    if (changed) {
      changes.push({ field, oldValue, newValue });
      runCut[field] = newValue;
    }
  }

  const conflict = await findOperatorConflict({
    operator: runCut.operator,
    daysOfWeek: runCut.daysOfWeek,
    startTime: runCut.startTime,
    endTime: runCut.endTime,
    status: runCut.status,
    excludeRunCutId: runCut._id,
  });
  if (conflict) throw httpError(409, conflictMessage(conflict));
  const vehicleConflict = await findVehicleConflict({
    vehicle: runCut.vehicle,
    daysOfWeek: runCut.daysOfWeek,
    startTime: runCut.startTime,
    endTime: runCut.endTime,
    status: runCut.status,
    excludeRunCutId: runCut._id,
  });
  if (vehicleConflict) throw httpError(409, vehicleConflictMessage(vehicleConflict));

  const divisionDoc = await Division.findById(runCut.division);
  const thresholds = await getEffectiveThresholds(divisionDoc, todayInTimezone(divisionDoc.timezone));
  const { serviceHours, revenueHours } = computeHours({
    startTime: runCut.startTime,
    endTime: runCut.endTime,
    status: runCut.status,
    ...thresholds,
  });
  runCut.serviceHours = serviceHours;
  runCut.revenueHours = revenueHours;
  runCut.updatedBy = userId;

  await runCut.save();
  await projectAssignment(runCut, userId);

  if (changes.length) {
    await ChangeLog.insertMany(
      changes.map((change) => ({
        entityType: "RunCut",
        entityId: runCut._id,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedBy: userId,
      }))
    );
  }

  return { changes, divisionDoc, operatorDoc, vehicleDoc };
};

const RUN_CUT_FIELD_LABELS = {
  operator: "operator",
  vehicle: "vehicle",
  pulloutAddress: "pullout address",
  startTime: "start time",
  endTime: "end time",
  status: "status",
  clientNotes: "client notes",
  disruptionType: "disruption type",
  disruptionNotes: "reason",
  daysOfWeek: "days",
};

// Builds a human-readable "from -> to" per changed field, for the Permanent
// OSR change history (server/controllers/permanentOsrChangesController.js).
// applyRunCutEdit only resolves the NEW operator/vehicle doc, so the prior
// one is looked up here by its stored id — ChangeLog itself keeps the raw
// ids, which is enough for its own generic diff trail but not for a report
// meant to read as plain "from -> to" text.
const runCutChangesFromTo = async (changes, { operatorDoc, vehicleDoc }) => {
  const oldOperatorId = changes.find((change) => change.field === "operator")?.oldValue;
  const oldVehicleId = changes.find((change) => change.field === "vehicle")?.oldValue;
  const [oldOperatorDoc, oldVehicleDoc] = await Promise.all([
    oldOperatorId ? Operator.findById(oldOperatorId).select("name") : null,
    oldVehicleId ? Vehicle.findById(oldVehicleId).select("code") : null,
  ]);

  return changes.map((change) => {
    const field = RUN_CUT_FIELD_LABELS[change.field] || change.field;
    if (change.field === "operator") {
      return { field, from: oldOperatorDoc?.name || "Unassigned", to: operatorDoc?.name || "Unassigned" };
    }
    if (change.field === "vehicle") {
      return { field, from: oldVehicleDoc?.code || "Unassigned", to: vehicleDoc?.code || "Unassigned" };
    }
    if (change.field === "daysOfWeek") {
      return {
        field,
        from: (change.oldValue || []).join(", ") || "None",
        to: (change.newValue || []).join(", ") || "None",
      };
    }
    return { field, from: String(change.oldValue || "Not set"), to: String(change.newValue || "Not set") };
  });
};

const divisionVehicleConflicts = async (division) => {
  const divisionRunCuts = await RunCut.find({ division }, "vehicle daysOfWeek startTime endTime status");
  const conflictIds = findVehicleConflictIds(divisionRunCuts);
  return Object.fromEntries(
    divisionRunCuts.map((rc) => [rc._id.toString(), conflictIds.has(rc._id.toString())])
  );
};

export const updateRunCut = async (req, res) => {
  let runCutId;
  let division;
  let timezone;
  try {
    await runInTransaction(async () => {
      const runCut = await RunCut.findById(req.params.id);
      if (!runCut) throw httpError(404, "Run cut not found");
      if (!canAccessDivision(req.user, runCut.division)) {
        throw httpError(403, "No access to this division");
      }

      const { divisionDoc } = await applyRunCutEdit(runCut, req.body, req.user._id);

      runCutId = runCut._id;
      division = runCut.division;
      timezone = divisionDoc.timezone;
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }

  queueProjectedMonths(division, timezone);
  const populated = await populateRunCut(RunCut.findById(runCutId));

  // A vehicle/day/time edit can change which OTHER rows in the division are
  // now (or no longer) double-booked, not just this one — recomputed here
  // and sent back alongside the edited row so the client can patch every
  // affected row's flag in place instead of reloading the whole division's
  // list (the previous full-reload was the visible "refresh" on every edit).
  const vehicleConflicts = await divisionVehicleConflicts(division);

  res.json({ runCut: populated, vehicleConflicts });
};

// A Permanent OSR is an Orion Service Request that doesn't just apply to one
// date (that's the day-specific OSR Planner in Live Schedule) — it changes
// the ongoing Master Run Cut itself, the same way an edit in Master Run Cuts
// does. It's reachable from Deployment without needing Master Run Cuts
// write access, is always tagged as an OSR, requires a stated reason, and
// — unlike a plain Master Run Cuts edit — is recorded in Deployment's
// Tracker Log so every Deployment-initiated change stays in that audit
// trail.
export const updateRunCutPermanentOsr = async (req, res) => {
  const disruptionNotes = (req.body.disruptionNotes || "").trim();
  if (!disruptionNotes) {
    return res.status(400).json({ message: "A reason for this permanent OSR is required." });
  }

  let runCutId;
  let division;
  let timezone;
  let routeCode;
  let summaryDetails = "";
  let fromToChanges = [];
  try {
    await runInTransaction(async () => {
      const runCut = await RunCut.findById(req.params.id).populate("route", "code type");
      if (!runCut) throw httpError(404, "Run cut not found");
      if (!canAccessDivision(req.user, runCut.division)) {
        throw httpError(403, "No access to this division");
      }
      if (runCut.route?.type === "standby") {
        throw httpError(400, "A permanent OSR applies to a revenue route, not a standby duty.");
      }

      const body = { ...req.body, disruptionNotes, disruptionType: OSR_DISRUPTION_TYPE };
      const { changes, divisionDoc, operatorDoc, vehicleDoc } = await applyRunCutEdit(runCut, body, req.user._id);

      runCutId = runCut._id;
      division = runCut.division;
      timezone = divisionDoc.timezone;
      routeCode = runCut.route?.code;
      fromToChanges = await runCutChangesFromTo(changes, { operatorDoc, vehicleDoc });
      summaryDetails = fromToChanges.length
        ? `: set ${fromToChanges.map((change) => `${change.field} to ${change.to}`).join(", ")}`
        : "";
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }

  logDeploymentActivity({
    division,
    user: req.user,
    action: "runcut.permanent_osr_updated",
    summary: `Processed a permanent OSR for ${routeCode}${summaryDetails} — ${disruptionNotes}`,
    route: routeCode,
    reason: disruptionNotes,
    changes: fromToChanges,
  });

  queueProjectedMonths(division, timezone);
  const populated = await populateRunCut(RunCut.findById(runCutId));
  const vehicleConflicts = await divisionVehicleConflicts(division);

  res.json({ runCut: populated, vehicleConflicts });
};

export const deleteRunCut = async (req, res) => {
  let division;
  let timezone;
  try {
    await runInTransaction(async () => {
      const runCut = await RunCut.findById(req.params.id);
      if (!runCut) throw httpError(404, "Run cut not found");
      if (!canAccessDivision(req.user, runCut.division)) {
        throw httpError(403, "No access to this division");
      }
      const divisionDoc = await Division.findById(runCut.division);
      runCut.daysOfWeek = [];
      await projectAssignment(runCut, req.user._id);
      await runCut.deleteOne();
      division = runCut.division;
      timezone = divisionDoc?.timezone;
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }

  queueProjectedMonths(division, timezone);
  res.json({ message: "Run cut deleted" });
};
