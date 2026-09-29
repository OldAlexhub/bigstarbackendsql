import ChangeLog from "../models/ChangeLog.js";
import Division from "../models/Division.js";
import Operator from "../models/Operator.js";
import Vehicle from "../models/Vehicle.js";
import { computeHours } from "./hours.js";
import { projectAssignment } from "./projectAssignment.js";
import {
  findOperatorConflict,
  findVehicleConflict,
  resolveOperator,
  resolveVehicle,
} from "./resolveAssignment.js";
import { getEffectiveThresholds } from "./thresholds.js";
import { todayInTimezone } from "./timezone.js";
import { httpError } from "./httpError.js";

export const RUN_CUT_EDITABLE_FIELDS = [
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

const conflictMessage = (conflict) =>
  `This operator is already assigned to route ${conflict.routeCode} on ${conflict.days.join(", ")} ` +
  `from ${conflict.startTime} to ${conflict.endTime} — that overlaps with this assignment.`;

const vehicleConflictMessage = (conflict) =>
  `This vehicle is already assigned to route ${conflict.routeCode} on ${conflict.days.join(", ")} ` +
  `from ${conflict.startTime} to ${conflict.endTime}; that overlaps with this assignment.`;

export const normalizeRunCutEdit = async (runCut, rawBody) => {
  const body = { ...rawBody };
  const operatorWasUpdated = body.operatorId !== undefined || body.operatorName !== undefined;
  let operatorDoc;
  if (operatorWasUpdated) {
    operatorDoc = await resolveOperator(
      runCut.division,
      body.operatorId !== undefined ? body.operatorId : body.operatorName
    );
    body.operator = operatorDoc?._id || null;
    // The Permanent OSR screen allows an explicit pullout address. Default
    // to the driver's roster address only when the caller did not send one.
    if (body.pulloutAddress === undefined) body.pulloutAddress = operatorDoc?.pulloutAddress || "";
    delete body.operatorId;
    delete body.operatorName;
  }

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

  return { body, operatorDoc, vehicleDoc };
};

export const diffRunCutEdit = (runCut, body) => {
  const changes = [];
  for (const field of RUN_CUT_EDITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    const oldValue = runCut[field];
    const newValue = body[field];
    const changed =
      field === "daysOfWeek"
        ? JSON.stringify([...(oldValue || [])].sort()) !== JSON.stringify([...(newValue || [])].sort())
        : String(oldValue ?? "") !== String(newValue ?? "");
    if (changed) changes.push({ field, oldValue, newValue });
  }
  return changes;
};

export const runCutPreview = (runCut, body) => {
  const preview = {
    _id: runCut._id,
    division: runCut.division,
    daysOfWeek: [...(runCut.daysOfWeek || [])],
    operator: runCut.operator,
    vehicle: runCut.vehicle,
    pulloutAddress: runCut.pulloutAddress,
    startTime: runCut.startTime,
    endTime: runCut.endTime,
    status: runCut.status,
    clientNotes: runCut.clientNotes,
    disruptionType: runCut.disruptionType,
    disruptionNotes: runCut.disruptionNotes,
  };
  for (const field of RUN_CUT_EDITABLE_FIELDS) {
    if (body[field] !== undefined) preview[field] = body[field];
  }
  return preview;
};

export const validateRunCutAssignment = async (runCut) => {
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
};

// Shared by direct Master Run Cut edits, same-day Permanent OSRs, and the
// scheduler that activates future Permanent OSRs on their effective date.
export const applyRunCutEdit = async (runCut, rawBody, userId) => {
  const { body, operatorDoc, vehicleDoc } = await normalizeRunCutEdit(runCut, rawBody);
  const changes = diffRunCutEdit(runCut, body);
  for (const change of changes) runCut[change.field] = change.newValue;

  await validateRunCutAssignment(runCut);

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

export const runCutChangesFromTo = async (changes, { operatorDoc, vehicleDoc }) => {
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
