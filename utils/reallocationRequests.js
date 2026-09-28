import ChangeLog from "../models/ChangeLog.js";
import Division from "../models/Division.js";
import ReallocationRequest from "../models/ReallocationRequest.js";
import RunCut from "../models/RunCut.js";
import { addMonths, monthInTimezone } from "./operationsKpis.js";
import { queueOperationsRefresh } from "./operationsReporting.js";
import { projectAssignment } from "./projectAssignment.js";
import { findOperatorConflict, findVehicleConflict, resolveOperator, resolveVehicle } from "./resolveAssignment.js";
import { todayInTimezone } from "./timezone.js";
import { runInTransaction } from "./transaction.js";
import { httpError } from "./httpError.js";

const conflictMessage = (conflict) =>
  `This operator is already assigned to route ${conflict.routeCode} on ${conflict.days.join(", ")} ` +
  `from ${conflict.startTime} to ${conflict.endTime} — that overlaps with this assignment.`;

const populateRequest = (query) =>
  query
    .populate("division", "code name timezone")
    .populate("requestedBy", "name username")
    .populate("reviewedBy", "name username");

export const isReallocationDue = (request) => {
  const timezone = request.division?.timezone;
  return new Date(request.effectiveDate) <= todayInTimezone(timezone);
};

export const normalizeReallocationAssignment = ({
  movingRoutes,
  operatorName = "",
  vehicleCode = "",
  pulloutAddress = "",
}) => {
  const unassigningCurrentRoute = !movingRoutes && !operatorName;
  return {
    operatorName,
    vehicleCode: unassigningCurrentRoute ? "" : vehicleCode,
    pulloutAddress: unassigningCurrentRoute ? "" : pulloutAddress,
  };
};

export const buildReallocationPlan = (request) => {
  const movingRoutes = Boolean(request.destinationRunCut);
  const assignment = normalizeReallocationAssignment({
    movingRoutes,
    operatorName: request.requestedOperatorName || "",
    vehicleCode: request.requestedVehicleCode || "",
    pulloutAddress: request.requestedPulloutAddress || "",
  });
  return {
    movingRoutes,
    operatorName: assignment.operatorName || (movingRoutes ? request.originalOperatorName : ""),
    sourceAssignment: movingRoutes
      ? { operator: null, vehicle: null, pulloutAddress: "" }
      : null,
    targetAssignment: {
      vehicleCode: assignment.vehicleCode,
      pulloutAddress: assignment.pulloutAddress,
    },
  };
};

export const assignmentMatchesSnapshot = (runCut, request, prefix = "original") => {
  const operatorName = runCut.operator?.name || "";
  const vehicleCode = runCut.vehicle?.code || "";
  const pulloutAddress = runCut.pulloutAddress || "";
  return (
    operatorName === (request[`${prefix}OperatorName`] || "") &&
    vehicleCode === (request[`${prefix}VehicleCode`] || "") &&
    pulloutAddress === (request[`${prefix}PulloutAddress`] || "")
  );
};

// Assignment state and the Master Run Cut status must agree. Clearing an
// operator makes the route Unassigned; adding an operator reactivates a route
// that was Unassigned without overwriting an intentional Off/Suspended state.
export const statusAfterReallocation = (currentStatus, operator) => {
  if (!operator) return "unassigned";
  return currentStatus === "unassigned" ? "active" : currentStatus;
};

export const applyReallocationAssignment = (runCut, { operator, vehicle, pulloutAddress }) => {
  runCut.operator = operator;
  runCut.vehicle = vehicle;
  runCut.pulloutAddress = pulloutAddress;
  runCut.status = statusAfterReallocation(runCut.status, operator);
  return runCut;
};

const personSnapshot = (user) => ({
  reviewedBy: user?._id || null,
  reviewedByName: user?.name || "",
  reviewedByUsername: user?.username || "",
  reviewedAt: new Date(),
});

export const approveOrApplyReallocation = async (requestId, reviewer = null) => {
  let divisionId = null;
  let timezone = null;
  let applied = false;

  await runInTransaction(async () => {
    const request = await ReallocationRequest.findOne({
      _id: requestId,
      status: { $in: ["pending", "approved"] },
    }).populate("division", "timezone");
    if (!request) throw httpError(409, "This reallocation request has already been completed or is unavailable.");

    if (request.status === "pending") {
      if (!reviewer) throw httpError(409, "This request must be accepted by a Deployment user first.");
      Object.assign(request, personSnapshot(reviewer));
    }

    divisionId = request.division?._id || request.division;
    timezone = request.division?.timezone;

    if (!isReallocationDue(request)) {
      request.status = "approved";
      request.applicationError = "";
      await request.save();
      return;
    }

    const sourceRunCut = await RunCut.findById(request.runCut)
      .populate("operator", "name")
      .populate("vehicle", "code");
    if (!sourceRunCut || String(sourceRunCut.division) !== String(divisionId) || String(sourceRunCut.route) !== String(request.route)) {
      throw httpError(409, "The Master Run Cut for this request is no longer available.");
    }
    if (!assignmentMatchesSnapshot(sourceRunCut, request)) {
      throw httpError(409, `Route ${request.routeCode} changed after this request was submitted. Submit a new request from the current assignment.`);
    }

    const plan = buildReallocationPlan(request);
    const { movingRoutes } = plan;
    const targetRunCut = movingRoutes
      ? await RunCut.findById(request.destinationRunCut).populate("operator", "name").populate("vehicle", "code")
      : sourceRunCut;
    if (
      !targetRunCut ||
      String(targetRunCut.division) !== String(divisionId) ||
      (movingRoutes && String(targetRunCut.route) !== String(request.destinationRoute))
    ) {
      throw httpError(409, "The destination Master Run Cut for this request is no longer available.");
    }
    if (movingRoutes && targetRunCut.operator) {
      throw httpError(409, `Route ${request.destinationRouteCode || "selected"} is no longer unassigned.`);
    }
    if (movingRoutes && targetRunCut.status !== "unassigned") {
      throw httpError(409, `Route ${request.destinationRouteCode || "selected"} is no longer marked Unassigned in Master Run Cuts.`);
    }
    if (movingRoutes && !assignmentMatchesSnapshot(targetRunCut, request, "destinationOriginal")) {
      throw httpError(409, `Route ${request.destinationRouteCode} changed after this request was submitted. Submit a new request using the current route details.`);
    }

    const operatorDoc = await resolveOperator(divisionId, plan.operatorName);
    const vehicleDoc = await resolveVehicle(divisionId, plan.targetAssignment.vehicleCode);
    const operator = operatorDoc?._id || null;
    const vehicle = vehicleDoc?._id || null;
    const pulloutAddress = operatorDoc?.pulloutAddress || "";
    const targetStatus = statusAfterReallocation(targetRunCut.status, operator);
    const sourceStatus = movingRoutes ? statusAfterReallocation(sourceRunCut.status, null) : null;
    const conflict = await findOperatorConflict({
      operator,
      daysOfWeek: targetRunCut.daysOfWeek,
      startTime: targetRunCut.startTime,
      endTime: targetRunCut.endTime,
      status: targetStatus,
      excludeRunCutIds: [sourceRunCut._id, targetRunCut._id],
    });
    if (conflict) throw httpError(409, conflictMessage(conflict));
    const vehicleConflict = await findVehicleConflict({
      vehicle,
      daysOfWeek: targetRunCut.daysOfWeek,
      startTime: targetRunCut.startTime,
      endTime: targetRunCut.endTime,
      status: targetStatus,
      excludeRunCutIds: [sourceRunCut._id, targetRunCut._id],
    });
    if (vehicleConflict) {
      throw httpError(
        409,
        `This vehicle is already assigned to route ${vehicleConflict.routeCode} on ${vehicleConflict.days.join(", ")} from ${vehicleConflict.startTime} to ${vehicleConflict.endTime}; that overlaps with this assignment.`
      );
    }

    const targetChanges = [
      { field: "operator", oldValue: targetRunCut.operator?._id || targetRunCut.operator, newValue: operator },
      { field: "vehicle", oldValue: targetRunCut.vehicle?._id || targetRunCut.vehicle, newValue: vehicle },
      { field: "status", oldValue: targetRunCut.status, newValue: targetStatus },
      {
        field: "pulloutAddress",
        oldValue: targetRunCut.pulloutAddress,
        newValue: pulloutAddress,
      },
    ].filter((change) => String(change.oldValue ?? "") !== String(change.newValue ?? ""));

    const sourceChanges = movingRoutes
      ? [
          { field: "operator", oldValue: sourceRunCut.operator?._id || sourceRunCut.operator, newValue: null },
          { field: "vehicle", oldValue: sourceRunCut.vehicle?._id || sourceRunCut.vehicle, newValue: null },
          { field: "status", oldValue: sourceRunCut.status, newValue: sourceStatus },
          { field: "pulloutAddress", oldValue: sourceRunCut.pulloutAddress, newValue: "" },
        ].filter((change) => String(change.oldValue ?? "") !== String(change.newValue ?? ""))
      : [];

    if (movingRoutes) {
      applyReallocationAssignment(sourceRunCut, plan.sourceAssignment);
      sourceRunCut.updatedBy = request.reviewedBy;
      await sourceRunCut.save();
      await projectAssignment(sourceRunCut, request.reviewedBy);
    }

    applyReallocationAssignment(targetRunCut, {
      operator,
      vehicle,
      pulloutAddress,
    });
    targetRunCut.updatedBy = request.reviewedBy;
    await targetRunCut.save();
    await projectAssignment(targetRunCut, request.reviewedBy);

    if (targetChanges.length || sourceChanges.length) {
      await ChangeLog.insertMany(
        [
          ...sourceChanges.map((change) => ({ ...change, entityId: sourceRunCut._id })),
          ...targetChanges.map((change) => ({ ...change, entityId: targetRunCut._id })),
        ].map((change) => ({
          entityType: "RunCut",
          entityId: change.entityId,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          changedBy: request.reviewedBy,
        }))
      );
    }

    request.status = "applied";
    request.open = false;
    request.appliedAt = new Date();
    request.applicationError = "";
    await request.save();
    applied = true;
  });

  if (applied && divisionId) {
    const month = monthInTimezone(timezone);
    queueOperationsRefresh(divisionId, month);
    queueOperationsRefresh(divisionId, addMonths(month, 1));
  }

  return {
    request: await populateRequest(ReallocationRequest.findById(requestId)),
    applied,
  };
};

export const applyDueReallocations = async () => {
  const activeDivisionIds = await Division.find({ active: { $ne: false } }).distinct("_id");
  const approved = await ReallocationRequest.find({
    status: "approved",
    division: { $in: activeDivisionIds },
  }).populate("division", "timezone");
  let applied = 0;

  for (const request of approved) {
    if (!isReallocationDue(request)) continue;
    try {
      const result = await approveOrApplyReallocation(request._id);
      if (result.applied) applied += 1;
    } catch {
      await ReallocationRequest.updateOne(
        { _id: request._id, status: "approved" },
        { $set: { applicationError: "Automatic application failed." } }
      );
      console.error(`Reallocation request ${request._id} could not be applied.`);
    }
  }

  return applied;
};
