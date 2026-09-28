import RunCutDay from "../models/RunCutDay.js";
import RunCut from "../models/RunCut.js";
import Division from "../models/Division.js";
import Route from "../models/Route.js";
import Settings from "../models/Settings.js";
import { canAccessDivision } from "../middleware/access.js";
import { computeHours } from "../utils/hours.js";
import { getEffectiveThresholds } from "../utils/thresholds.js";
import { syncAutoIssuesBulk } from "../utils/autoIssueSync.js";
import { isOsrDisruptionType } from "../utils/disruptionTypes.js";
import { exceptionPlanningWindowError, exceptionStatus } from "../utils/runCutDayExceptionPolicy.js";
import {
  activateRouteWithStandbyCoverage,
  CLOSED_SUSPENDED_DISPOSITION,
  DISPOSITION_TYPES,
  removeStandbyCoverageFromRoute,
  resolveStandbyPulloutAddress,
  syncDispositionWithStatus,
  syncStatusWithDisposition,
} from "../utils/dispositions.js";
import { logDeploymentActivity } from "../utils/deploymentActivityLog.js";
import { queueOperationsRefresh } from "../utils/operationsReporting.js";
import { runInTransaction } from "../utils/transaction.js";
import { httpError, respondToHttpError } from "../utils/httpError.js";
import { getBranchGroupDivisionIds } from "../utils/divisionBranches.js";
import { todayInTimezone } from "../utils/timezone.js";
import {
  resolveOperatorInBranchGroup,
  resolveVehicle,
  resolveRoute,
  findOperatorConflictOnDate,
  findVehicleConflictOnDate,
} from "../utils/resolveAssignment.js";

const isoDate = (date) => new Date(date).toISOString().slice(0, 10);

const populateRunCutDay = (query) =>
  query
    .populate("division", "code name")
    .populate("route", "code type")
    .populate("operator", "name pulloutAddress division active")
    .populate("vehicle", "code division active")
    .populate("coveringRoute", "code division");

const conflictMessage = (conflict) =>
  `This operator is already on route ${conflict.routeCode} from ${conflict.startTime} to ${conflict.endTime} ` +
  `that day — that overlaps with this duty.`;

const vehicleConflictMessage = (conflict) =>
  `This vehicle is already on route ${conflict.routeCode} from ${conflict.startTime} to ${conflict.endTime} ` +
  "that day; that overlaps with this duty.";

const dayOffset = (date, timezone) => {
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) throw httpError(400, "Choose a valid service date.");
  target.setUTCHours(0, 0, 0, 0);
  return Math.round((target.getTime() - todayInTimezone(timezone).getTime()) / 86_400_000);
};

const requireTodayOrTomorrow = (date, division) => {
  const offset = dayOffset(date, division?.timezone);
  if (offset < 0 || offset > 1) {
    throw httpError(400, "Daily assignment changes and additional revenue routes are limited to today and tomorrow.");
  }
};

const requireExceptionWindow = async ({ date, division, assignmentWasUpdated, disruptionType }) => {
  const isOsr = isOsrDisruptionType(disruptionType);
  const settings = isOsr ? await Settings.getSingleton() : null;
  const maxDays = settings?.osrAdvanceDays ?? 7;
  const offset = dayOffset(date, division?.timezone);
  const message = exceptionPlanningWindowError({ offset, assignmentWasUpdated, disruptionType, osrAdvanceDays: maxDays });
  if (message) throw httpError(400, message);
};

export const listRunCutDays = async (req, res) => {
  const { division, from, to } = req.query;
  if (!division || !from || !to) {
    return res.status(400).json({ message: "division, from, and to are required" });
  }
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  let divisionIds = [division];
  if (req.query.sharedStandby === "1") {
    divisionIds = await getBranchGroupDivisionIds(division);
  }

  const runCutDays = await populateRunCutDay(
    RunCutDay.find({
      division: { $in: divisionIds },
      date: { $gte: new Date(from), $lte: new Date(to) },
    }).sort({ date: 1 })
  );

  const includeStandby = req.query.includeStandby === "1";
  res.json({
    runCutDays:
      req.query.sharedStandby === "1"
        ? runCutDays.filter((rcd) => rcd.route?.type === "standby")
        : includeStandby
        ? runCutDays
        : runCutDays.filter((rcd) => rcd.route?.type !== "standby"),
  });
};

// The one direct edit RunCutDay still allows on a normal scheduled day (see
// updateRunCutDayException for Deployment's day-specific edits): whether a
// standby duty was actually called in on this specific date, and if so,
// which scheduled route it's covering. coveringRoute is optional — a
// standby can be marked deployed (in service) without covering any existing
// scheduled route, e.g. when picking up a one-off Add Revenue Route duty
// instead — and is always cleared when deployed is set back to false.
export const setRunCutDayDeployed = async (req, res) => {
  let runCutDayId;
  let affectedDivisions = [];
  let date;
  let activity;

  try {
    await runInTransaction(async () => {
      const runCutDay = await RunCutDay.findById(req.params.id).populate("route", "code type");
      if (!runCutDay) throw httpError(404, "Run cut day not found");
      if (runCutDay.route?.type !== "standby") {
        throw httpError(400, "Deployed can only be set on standby routes");
      }

      const deployed = Boolean(req.body.deployed);
      const previousCoveringRoute = runCutDay.coveringRoute;
      const requestedCoveringRoute = deployed ? req.body.coveringRoute : previousCoveringRoute;
      const routeDoc = requestedCoveringRoute
        ? await Route.findOne({ _id: requestedCoveringRoute, active: { $ne: false } })
        : null;
      const previousRouteDoc = previousCoveringRoute
        ? await Route.findById(previousCoveringRoute)
        : null;
      const hasPermission = routeDoc
        ? canAccessDivision(req.user, routeDoc.division)
        : canAccessDivision(req.user, runCutDay.division);
      if (!hasPermission) throw httpError(403, "No access to this standby pool");
      if (
        previousRouteDoc &&
        String(previousCoveringRoute) !== String(requestedCoveringRoute) &&
        !canAccessDivision(req.user, previousRouteDoc.division)
      ) {
        throw httpError(403, "You cannot reassign standby coverage from a branch you cannot access.");
      }

      let coveringRouteCode = null;
      let coveredRunCutDay = null;
      if (deployed && req.body.coveringRoute) {
        const { coveringRoute } = req.body;
        if (!routeDoc) throw httpError(400, "That route is unavailable.");
        if (routeDoc.type === "standby") {
          throw httpError(400, "A standby can only cover a scheduled route.");
        }

        const branchDivisionIds = await getBranchGroupDivisionIds(runCutDay.division);
        if (!branchDivisionIds.some((id) => String(id) === String(routeDoc.division))) {
          throw httpError(400, "That route is not in this standby's branch group.");
        }

        coveredRunCutDay = await RunCutDay.findOne({
          division: routeDoc.division,
          route: routeDoc._id,
          date: runCutDay.date,
        });
        if (!coveredRunCutDay) {
          throw httpError(400, "That route is not scheduled on this date.");
        }

        const duplicateCoverage = await RunCutDay.findOne({
          _id: { $ne: runCutDay._id },
          date: runCutDay.date,
          deployed: true,
          coveringRoute: routeDoc._id,
        });
        if (duplicateCoverage) {
          throw httpError(409, "That route is already covered by another standby.");
        }

        runCutDay.coveringRoute = routeDoc._id;
        coveringRouteCode = routeDoc.code;
      } else {
        // Either not deployed, or deployed without covering any existing
        // scheduled route (in service generally, e.g. for a one-off Add
        // Revenue Route duty).
        runCutDay.coveringRoute = null;
      }

      runCutDay.deployed = deployed;
      runCutDay.updatedBy = req.user._id;
      await runCutDay.save();

      const coverageChanged =
        previousCoveringRoute &&
        (!deployed || String(previousCoveringRoute) !== String(runCutDay.coveringRoute));

      if (coverageChanged) {
        const previouslyCoveredRunCutDay = await RunCutDay.findOne({
          route: previousCoveringRoute,
          date: runCutDay.date,
        });
        if (
          previouslyCoveredRunCutDay &&
          removeStandbyCoverageFromRoute(previouslyCoveredRunCutDay, runCutDay._id)
        ) {
          previouslyCoveredRunCutDay.updatedBy = req.user._id;
          await previouslyCoveredRunCutDay.save();
        }
      }

      if (deployed && coveredRunCutDay) {
        const divisionDoc = await Division.findById(coveredRunCutDay.division);
        const divisionKeepsRouteAddress = Boolean(divisionDoc?.pulloutAddressRules?.standbyKeepsRouteAddress);
        let masterPulloutAddress;
        if (divisionKeepsRouteAddress && !coveredRunCutDay.pulloutAddress) {
          const masterRunCut = await RunCut.findOne({
            division: coveredRunCutDay.division,
            route: coveredRunCutDay.route,
          }).select("pulloutAddress");
          masterPulloutAddress = masterRunCut?.pulloutAddress;
        }
        activateRouteWithStandbyCoverage(
          coveredRunCutDay,
          runCutDay._id,
          {
            // Whoever is actually driving today is the standby, on the
            // standby's own vehicle — Live Schedule should show that
            // reality directly, the same way the Client Report and Work
            // Order already display it.
            operator: runCutDay.operator,
            vehicle: runCutDay.vehicle,
            pulloutAddress: resolveStandbyPulloutAddress({
              divisionKeepsRouteAddress,
              standbyPulloutAddress: runCutDay.pulloutAddress,
              coveredPulloutAddress: coveredRunCutDay.pulloutAddress,
              masterPulloutAddress,
            }),
          }
        );
        coveredRunCutDay.overrides.status = true;
        const thresholds = await getEffectiveThresholds(divisionDoc, coveredRunCutDay.date);
        const { serviceHours, revenueHours } = computeHours({
          startTime: coveredRunCutDay.startTime,
          endTime: coveredRunCutDay.endTime,
          status: coveredRunCutDay.status,
          ...thresholds,
        });
        coveredRunCutDay.serviceHours = serviceHours;
        coveredRunCutDay.revenueHours = revenueHours;
        coveredRunCutDay.updatedBy = req.user._id;
        await coveredRunCutDay.save();
        await syncAutoIssuesBulk([coveredRunCutDay], req.user._id);
      }

      runCutDayId = runCutDay._id;
      affectedDivisions = [
        ...new Set(
          [runCutDay.division, coveredRunCutDay?.division, routeDoc?.division]
            .filter(Boolean)
            .map(String)
        ),
      ];
      date = runCutDay.date;
      activity = {
        division: coveredRunCutDay?.division || routeDoc?.division || runCutDay.division,
        user: req.user,
        action: "runcutday.deployed_set",
        summary: deployed
          ? `Marked standby ${runCutDay.route.code} deployed on ${isoDate(date)}${
              coveringRouteCode ? ` (covering ${coveringRouteCode})` : ""
            }`
          : `Marked standby ${runCutDay.route.code} not deployed on ${isoDate(date)}`,
      };
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "That route is already covered by another standby." });
    }
    return respondToHttpError(error, res);
  }

  logDeploymentActivity(activity);
  const populated = await populateRunCutDay(RunCutDay.findById(runCutDayId));
  for (const divisionId of affectedDivisions) {
    queueOperationsRefresh(divisionId, isoDate(date).slice(0, 7));
  }
  res.json({ runCutDay: populated });
};

// Deployment's day-specific exception path: assignment, status, notes,
// disruption, and disposition fields. Values set here apply only to this
// date and are protected from the next
// projectAssignment run (server/utils/projectAssignment.js), which leaves
// an overridden field alone instead of replacing it with whatever the
// persistent RunCut assignment says. Ordinary assignment fields are
// accepted only for today/tomorrow; an Orion Service Request may use the
// configured OSR window. Neither path writes back to the persistent RunCut.
export const updateRunCutDayException = async (req, res) => {
  const runCutDay = await RunCutDay.findById(req.params.id).populate("route", "code type");
  if (!runCutDay) return res.status(404).json({ message: "Run cut day not found" });
  if (!canAccessDivision(req.user, runCutDay.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const {
    operatorId,
    operatorName,
    vehicleId,
    vehicleCode,
    pulloutAddress,
    startTime,
    endTime,
    status,
    clientNotes,
    disruptionType,
    disruptionNotes,
    disposition,
  } = req.body;
  const divisionDoc = await Division.findById(runCutDay.division);
  const assignmentWasUpdated = [operatorId, operatorName, vehicleId, vehicleCode, startTime, endTime].some(
    (value) => value !== undefined
  );
  const conflictRelevantUpdate = assignmentWasUpdated || status !== undefined;
  try {
    await requireExceptionWindow({
      date: runCutDay.date,
      division: divisionDoc,
      assignmentWasUpdated,
      disruptionType,
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }

  const changeDescriptions = [];
  let statusWasUpdated = false;
  if (operatorId !== undefined || operatorName !== undefined) {
    let operatorDoc;
    try {
      operatorDoc = await resolveOperatorInBranchGroup(
        runCutDay.division,
        operatorId !== undefined ? operatorId : operatorName
      );
    } catch (error) {
      return respondToHttpError(error, res);
    }
    runCutDay.operator = operatorDoc?._id || null;
    if (!runCutDay.pulloutAddressStandbyDay) {
      runCutDay.pulloutAddress = operatorDoc?.pulloutAddress || "";
    }
    runCutDay.overrides.operator = true;
    runCutDay.overrides.pulloutAddress = true;
    changeDescriptions.push(`operator to ${operatorDoc?.name || "unassigned"}`);
  }
  // A driver's saved pullout address is only the usual case — the actual
  // pickup spot for one date can differ (a rider's request, a detour), so a
  // pulloutAddress sent here always wins over the operator-derived default
  // above, even when this route is currently borrowing a standby's address.
  if (pulloutAddress !== undefined) {
    runCutDay.pulloutAddress = pulloutAddress || "";
    runCutDay.overrides.pulloutAddress = true;
    changeDescriptions.push("pullout address");
  }
  if (vehicleId !== undefined || vehicleCode !== undefined) {
    let vehicleDoc;
    try {
      vehicleDoc = await resolveVehicle(
        runCutDay.division,
        vehicleId !== undefined ? vehicleId : vehicleCode
      );
    } catch (error) {
      return respondToHttpError(error, res);
    }
    runCutDay.vehicle = vehicleDoc?._id || null;
    runCutDay.overrides.vehicle = true;
    changeDescriptions.push(`vehicle to ${vehicleDoc?.code || "unassigned"}`);
  }
  if (startTime !== undefined) {
    runCutDay.startTime = startTime || null;
    runCutDay.overrides.startTime = true;
    changeDescriptions.push(`start time to ${startTime || "not set"}`);
  }
  if (endTime !== undefined) {
    runCutDay.endTime = endTime || null;
    runCutDay.overrides.endTime = true;
    changeDescriptions.push(`end time to ${endTime || "not set"}`);
  }
  if (status !== undefined) {
    runCutDay.status = exceptionStatus({ currentStatus: runCutDay.status, requestedStatus: status });
    runCutDay.overrides.status = true;
    statusWasUpdated = true;
    changeDescriptions.push(`status to ${status}`);
    if (syncDispositionWithStatus(runCutDay, status)) {
      changeDescriptions.push(
        status === "suspended" ? "disposition to closed/suspended" : "cleared automatic disposition"
      );
    }
  }
  if (clientNotes !== undefined) {
    runCutDay.clientNotes = clientNotes;
    runCutDay.overrides.clientNotes = true;
    changeDescriptions.push("client notes");
  }
  if (disruptionType !== undefined || disruptionNotes !== undefined) {
    if (disruptionType !== undefined) runCutDay.disruptionType = disruptionType;
    if (disruptionNotes !== undefined) runCutDay.disruptionNotes = disruptionNotes;
    runCutDay.overrides.disruption = true;
    changeDescriptions.push(`disruption to ${disruptionType ?? runCutDay.disruptionType ?? "—"}`);
  }
  if (disposition !== undefined) {
    if (disposition !== null && !DISPOSITION_TYPES.includes(disposition)) {
      return res.status(400).json({ message: "Invalid disposition." });
    }
    // A standby-set disposition is a starting point, not a lock — dispatch
    // can change or clear it here without removing the standby coverage
    // itself. Once changed, it stops being standby-owned (see
    // removeStandbyCoverageFromRoute), so removing that coverage later
    // won't revert this manual choice.
    if (disposition === CLOSED_SUSPENDED_DISPOSITION) {
      const wasSuspended = runCutDay.status === "suspended";
      syncStatusWithDisposition(runCutDay, disposition);
      runCutDay.overrides.status = true;
      statusWasUpdated = true;
      if (!wasSuspended) changeDescriptions.push("status to suspended");
    } else if (runCutDay.dispositionSource === "status") {
      if (disposition !== runCutDay.disposition) {
        return res.status(400).json({
          message: "Change the route status from Suspended before changing its automatic disposition.",
        });
      }
    } else {
      runCutDay.disposition = disposition || null;
      runCutDay.dispositionSource = disposition ? "manual" : null;
      runCutDay.dispositionStandbyDay = null;
    }
    changeDescriptions.push(`disposition to ${disposition || "not dispositioned"}`);
  }

  if (conflictRelevantUpdate) {
    const conflict = await findOperatorConflictOnDate({
      operator: runCutDay.operator,
      date: runCutDay.date,
      startTime: runCutDay.startTime,
      endTime: runCutDay.endTime,
      status: runCutDay.status,
      excludeRunCutDayId: runCutDay._id,
    });
    if (conflict) return res.status(409).json({ message: conflictMessage(conflict) });
    const vehicleConflict = await findVehicleConflictOnDate({
      vehicle: runCutDay.vehicle,
      date: runCutDay.date,
      startTime: runCutDay.startTime,
      endTime: runCutDay.endTime,
      status: runCutDay.status,
      excludeRunCutDayId: runCutDay._id,
    });
    if (vehicleConflict) return res.status(409).json({ message: vehicleConflictMessage(vehicleConflict) });
  }

  if (statusWasUpdated || startTime !== undefined || endTime !== undefined) {
    const thresholds = await getEffectiveThresholds(divisionDoc, runCutDay.date);
    const { serviceHours, revenueHours } = computeHours({
      startTime: runCutDay.startTime,
      endTime: runCutDay.endTime,
      status: runCutDay.status,
      ...thresholds,
    });
    runCutDay.serviceHours = serviceHours;
    runCutDay.revenueHours = revenueHours;
  }

  runCutDay.updatedBy = req.user._id;
  let affected = [];
  const activities = [];
  await runInTransaction(async () => {
    activities.length = 0;
    await runCutDay.save();

    if (changeDescriptions.length) {
      activities.push({
        division: runCutDay.division,
        user: req.user,
        action: "runcutday.exception_updated",
        summary: `Updated ${runCutDay.route.code} on ${isoDate(runCutDay.date)}: set ${changeDescriptions.join(", ")}`,
      });
    }

    affected = [runCutDay];

    await syncAutoIssuesBulk(affected, req.user._id);
  });

  for (const activity of activities) logDeploymentActivity(activity);

  const populated = await populateRunCutDay(RunCutDay.findById(runCutDay._id));
  for (const day of affected) queueOperationsRefresh(day.division, isoDate(day.date).slice(0, 7));
  res.json({ runCutDay: populated });
};

// An operator picking up revenue on a route outside its normal schedule for
// today or tomorrow only — a one-off, not a change to the ongoing plan.
// Either pick an existing route from the division's active pool (routeId),
// or make up a route number for a route that only runs this one day
// (routeCode) — resolveRoute finds or creates that division's Route by
// code, the same way an operator/vehicle name resolves against its roster.
export const createExtraRunCutDay = async (req, res) => {
  const {
    division,
    date,
    routeId,
    routeCode,
    operatorId,
    operatorName,
    vehicleId,
    vehicleCode,
    pulloutAddress,
    startTime,
    endTime,
    notes,
  } = req.body;
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (!date || (!routeId && !routeCode)) {
    return res.status(400).json({ message: "date and a route are required" });
  }

  const dayDate = new Date(date);
  let route;
  let runCutDay;
  try {
    await runInTransaction(async () => {
      const divisionDoc = await Division.findById(division);
      if (!divisionDoc) throw httpError(404, "Division not found");
      requireTodayOrTomorrow(dayDate, divisionDoc);

      route = routeId
        ? await Route.findOne({ _id: routeId, division, type: { $ne: "standby" }, active: { $ne: false } })
        : await resolveRoute(division, routeCode);
      if (!route) {
        throw httpError(
          400,
          routeId ? "Choose an active revenue route from this division." : "Enter a route number."
        );
      }
      if (route.type === "standby") {
        throw httpError(400, "That route number belongs to a standby route. Enter a different number.");
      }

      const operatorDoc = await resolveOperatorInBranchGroup(division, operatorId ?? operatorName);
      const vehicleDoc = await resolveVehicle(division, vehicleId ?? vehicleCode);
      const operator = operatorDoc?._id || null;
      const vehicle = vehicleDoc?._id || null;
      const conflict = await findOperatorConflictOnDate({ operator, date: dayDate, startTime, endTime, status: "add_rte" });
      if (conflict) throw httpError(409, conflictMessage(conflict));
      const vehicleConflict = await findVehicleConflictOnDate({ vehicle, date: dayDate, startTime, endTime, status: "add_rte" });
      if (vehicleConflict) throw httpError(409, vehicleConflictMessage(vehicleConflict));

      const thresholds = await getEffectiveThresholds(divisionDoc, dayDate);
      const { serviceHours, revenueHours } = computeHours({
        startTime,
        endTime,
        status: "add_rte",
        ...thresholds,
      });

      runCutDay = await RunCutDay.create({
        division,
        route: route._id,
        date: dayDate,
        operator,
        vehicle,
        // A driver's saved pullout address is the sensible default, but an
        // explicit one wins — a one-off route can have its own pickup spot,
        // same as the OSR Planner and a Permanent OSR already allow.
        pulloutAddress: pulloutAddress !== undefined ? pulloutAddress || "" : operatorDoc?.pulloutAddress || "",
        startTime,
        endTime,
        status: "add_rte",
        serviceHours,
        revenueHours,
        clientNotes: notes || "",
        isExtra: true,
        overrides: {
          operator: true,
          vehicle: true,
          pulloutAddress: true,
          startTime: true,
          endTime: true,
          status: true,
          clientNotes: true,
          disruption: false,
        },
        updatedBy: req.user._id,
      });
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "This route already has a scheduled duty on this date." });
    }
    return respondToHttpError(error, res);
  }

  logDeploymentActivity({
    division,
    user: req.user,
    action: "runcutday.extra_added",
    summary: `Added extra run for ${route.code} on ${isoDate(dayDate)}${operatorName || operatorId ? ` (driver assigned)` : ""}`,
  });

  const populated = await populateRunCutDay(RunCutDay.findById(runCutDay._id));
  queueOperationsRefresh(division, isoDate(dayDate).slice(0, 7));
  res.status(201).json({ runCutDay: populated });
};

export const deleteExtraRunCutDay = async (req, res) => {
  const runCutDay = await RunCutDay.findById(req.params.id).populate("route", "code");
  if (!runCutDay) return res.status(404).json({ message: "Run cut day not found" });
  if (!canAccessDivision(req.user, runCutDay.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (!runCutDay.isExtra) {
    return res.status(400).json({ message: "Only an extra duty added here can be removed this way." });
  }

  const activity = {
    division: runCutDay.division,
    user: req.user,
    action: "runcutday.extra_removed",
    summary: `Removed extra run for ${runCutDay.route.code} on ${isoDate(runCutDay.date)}`,
  };

  const division = runCutDay.division;
  const month = isoDate(runCutDay.date).slice(0, 7);
  await runInTransaction(() => runCutDay.deleteOne());
  logDeploymentActivity(activity);
  queueOperationsRefresh(division, month);
  res.json({ message: "Extra duty removed" });
};
