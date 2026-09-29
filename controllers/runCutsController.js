import RunCut from "../models/RunCut.js";
import Division from "../models/Division.js";
import PermanentOsrChange from "../models/PermanentOsrChange.js";
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
import { parseDateOnly } from "../utils/dateRange.js";
import {
  RUN_CUT_EDITABLE_FIELDS,
  applyRunCutEdit,
  diffRunCutEdit,
  normalizeRunCutEdit,
  runCutChangesFromTo,
  runCutPreview,
  validateRunCutAssignment,
} from "../utils/runCutEdits.js";

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

const withScheduledPermanentOsrs = async (runCuts) => {
  const ids = runCuts.map((runCut) => runCut._id);
  if (!ids.length) return runCuts;
  const scheduled = await PermanentOsrChange.find({
    runCut: { $in: ids },
    applicationStatus: "scheduled",
  })
    .populate("operator", "name pulloutAddress division active")
    .populate("vehicle", "code division active")
    .lean();
  const byRunCut = new Map(scheduled.map((change) => [String(change.runCut), change]));
  return runCuts.map((runCut) => ({
    ...(runCut.toObject ? runCut.toObject() : runCut),
    pendingPermanentOsr: byRunCut.get(String(runCut._id)) || null,
  }));
};

export const listRunCuts = async (req, res) => {
  const includeStandby = req.query.includeStandby === "1";

  if (req.query.division) {
    if (!canAccessDivision(req.user, req.query.division)) {
      return res.status(403).json({ message: "No access to this division" });
    }
    const runCuts = await populateRunCut(RunCut.find({ division: req.query.division }));
    const visible = withVehicleConflictFlags(excludeStandby(runCuts, includeStandby));
    return res.json({ runCuts: await withScheduledPermanentOsrs(visible) });
  }

  const accessibleDivisionIds = await Division.find({
    ...divisionFilter(req.user),
    active: { $ne: false },
  }).distinct("_id");
  const runCuts = await populateRunCut(RunCut.find({ division: { $in: accessibleDivisionIds } }));
  const visible = withVehicleConflictFlags(excludeStandby(runCuts, includeStandby));
  res.json({ runCuts: await withScheduledPermanentOsrs(visible) });
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
  const rawEffectiveDate = req.body.effectiveDate ?? req.body.startDate;
  const parsedEffectiveDate = rawEffectiveDate === undefined
    ? null
    : parseDateOnly(rawEffectiveDate, "effectiveDate");
  if (parsedEffectiveDate?.error) {
    return res.status(400).json({ message: parsedEffectiveDate.error });
  }

  let runCutId;
  let division;
  let timezone;
  let routeCode;
  let effectiveDate;
  let applied = false;
  let scheduledPermanentOsr = null;
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

      const divisionDoc = await Division.findById(runCut.division);
      const today = todayInTimezone(divisionDoc.timezone);
      effectiveDate = parsedEffectiveDate?.date || today;
      if (effectiveDate < today) {
        throw httpError(400, "effectiveDate cannot be before today in the division's timezone.");
      }

      const body = { ...req.body, disruptionNotes, disruptionType: OSR_DISRUPTION_TYPE };
      delete body.effectiveDate;
      delete body.startDate;

      let changes;
      const normalized = await normalizeRunCutEdit(runCut, body);
      const requestedChanges = diffRunCutEdit(runCut, normalized.body);
      const substantiveChanges = requestedChanges.filter(
        (change) => !["disruptionType", "disruptionNotes"].includes(change.field)
      );
      if (!substantiveChanges.length) {
        throw httpError(
          400,
          "No Master Run Cut fields changed. Enter a new driver, vehicle, pullout address, schedule, status, days, or client notes."
        );
      }
      const operatorDoc = normalized.operatorDoc;
      const vehicleDoc = normalized.vehicleDoc;
      if (effectiveDate.getTime() === today.getTime()) {
        ({ changes } = await applyRunCutEdit(runCut, normalized.body, req.user._id, {
          replaceDayOverrides: true,
        }));
        applied = true;
      } else {
        const existing = await PermanentOsrChange.findOne({
          runCut: runCut._id,
          applicationStatus: "scheduled",
        }).select("_id");
        if (existing) {
          throw httpError(409, "This route already has a future permanent OSR scheduled.");
        }

        changes = requestedChanges;
        await validateRunCutAssignment(runCutPreview(runCut, normalized.body));

        const editableFields = RUN_CUT_EDITABLE_FIELDS.filter((field) => normalized.body[field] !== undefined);
        const values = Object.fromEntries(
          editableFields.map((field) => [field === "status" ? "runCutStatus" : field, normalized.body[field]])
        );
        scheduledPermanentOsr = await PermanentOsrChange.create({
          division: runCut.division,
          runCut: runCut._id,
          route: runCut.route._id,
          routeCode: runCut.route.code,
          effectiveDate,
          editableFields,
          ...values,
          disruptionNotes,
          requestedBy: req.user._id,
        });
      }

      runCutId = runCut._id;
      division = runCut.division;
      timezone = divisionDoc.timezone;
      routeCode = runCut.route?.code;
      fromToChanges = await runCutChangesFromTo(changes, { operatorDoc, vehicleDoc });
      fromToChanges.push({
        field: "starting date",
        from: "",
        to: effectiveDate.toISOString().slice(0, 10),
      });
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
    summary: `${applied ? "Processed" : "Scheduled"} a permanent OSR for ${routeCode}${summaryDetails} — ${disruptionNotes}`,
    route: routeCode,
    reason: disruptionNotes,
    changes: fromToChanges,
  });

  if (applied) queueProjectedMonths(division, timezone);
  const populated = await populateRunCut(RunCut.findById(runCutId));
  const vehicleConflicts = await divisionVehicleConflicts(division);

  res.json({
    runCut: populated,
    vehicleConflicts,
    applied,
    effectiveDate,
    scheduledPermanentOsr,
  });
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
      await PermanentOsrChange.deleteMany({ runCut: runCut._id, applicationStatus: "scheduled" });
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
