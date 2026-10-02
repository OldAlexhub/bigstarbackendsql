import Operator from "../models/Operator.js";
import Vehicle from "../models/Vehicle.js";
import Route from "../models/Route.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import { normalizeName, normalizeCode, escapeRegex } from "./normalizeText.js";
import { httpError } from "./httpError.js";
import { getBranchGroupDivisionIds } from "./divisionBranches.js";
import mongoose from "../db/sqlMongoose.js";
import { NON_OPERATING_RUN_CUT_STATUSES, isOperatingAssignmentStatus } from "./hours.js";

const WEEK_MINUTES = 7 * 24 * 60;
const DAY_INDEX = new Map(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day, index) => [day, index]));

// Assignments must come from the selected division's active roster. Names
// are still accepted for older clients and approval workflows, but they are
// resolved against that same controlled roster and never create records as
// a side effect of editing a schedule.
export const resolveOperator = async (division, rawValue) => {
  if (!rawValue) return null;
  const query = mongoose.isValidObjectId(rawValue)
    ? { _id: rawValue, division }
    : {
        division,
        name: new RegExp(`^${escapeRegex(normalizeName(rawValue))}$`, "i"),
      };
  const operator = await Operator.findOne(query);
  if (!operator) throw httpError(400, "Choose a driver from this division's Drivers roster.");
  if (operator.active === false) throw httpError(400, "That driver is inactive. Choose an active driver.");
  return operator;
};

// Deployment's day-specific paths (a one-off extra route, a daily
// exception) can pull a driver from anywhere in the division's shared
// standby branch group, not just this exact division — Division 3 ADA and
// GoLink share one standby pool, so a shared-pool driver picking up a
// one-off route in either branch shouldn't need to belong to that exact
// division's own roster. Master Run Cuts' persistent assignment stays
// strictly single-division and keeps using resolveOperator unchanged.
export const resolveOperatorInBranchGroup = async (division, rawValue) => {
  if (!rawValue) return null;
  const branchDivisionIds = await getBranchGroupDivisionIds(division);
  const query = mongoose.isValidObjectId(rawValue)
    ? { _id: rawValue, division: { $in: branchDivisionIds } }
    : {
        division: { $in: branchDivisionIds },
        name: new RegExp(`^${escapeRegex(normalizeName(rawValue))}$`, "i"),
      };
  const operator = await Operator.findOne(query);
  if (!operator) throw httpError(400, "Choose a driver from this division or its shared standby pool.");
  if (operator.active === false) throw httpError(400, "That driver is inactive. Choose an active driver.");
  return operator;
};

export const resolveVehicle = async (division, rawValue) => {
  if (!rawValue) return null;
  const query = mongoose.isValidObjectId(rawValue)
    ? { _id: rawValue, division }
    : {
        division,
        code: new RegExp(`^${escapeRegex(normalizeCode(rawValue))}$`, "i"),
      };
  const vehicle = await Vehicle.findOne(query);
  if (!vehicle) throw httpError(400, "Choose a vehicle from this division's Vehicles roster.");
  if (vehicle.active === false) throw httpError(400, "That vehicle is inactive. Choose an active vehicle.");
  return vehicle;
};

export const resolveRoute = async (division, rawCode) => {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const existing = await Route.findOne({ division, code: new RegExp(`^${escapeRegex(code)}$`, "i") });
  if (existing) return existing;
  return Route.create({ division, code });
};

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const timeRangesOverlap = (aStart, aEnd, bStart, bEnd) => {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  let a1 = toMinutes(aStart);
  let a2 = toMinutes(aEnd);
  if (a2 <= a1) a2 += 24 * 60;
  let b1 = toMinutes(bStart);
  let b2 = toMinutes(bEnd);
  if (b2 <= b1) b2 += 24 * 60;
  return a1 < b2 && b1 < a2;
};

const weeklyInterval = (day, startTime, endTime) => {
  const dayIndex = DAY_INDEX.get(day);
  if (dayIndex === undefined || !startTime || !endTime) return null;
  const start = dayIndex * 24 * 60 + toMinutes(startTime);
  let end = dayIndex * 24 * 60 + toMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return { start, end };
};

export const recurringOverlapDays = (aDays, aStart, aEnd, bDays, bStart, bEnd) => {
  const overlapping = new Set();
  for (const aDay of aDays || []) {
    const a = weeklyInterval(aDay, aStart, aEnd);
    if (!a) continue;
    for (const bDay of bDays || []) {
      const base = weeklyInterval(bDay, bStart, bEnd);
      if (!base) continue;
      const collides = [-WEEK_MINUTES, 0, WEEK_MINUTES].some((offset) => {
        const b = { start: base.start + offset, end: base.end + offset };
        return a.start < b.end && b.start < a.end;
      });
      if (collides) overlapping.add(aDay);
    }
  }
  return [...overlapping];
};

const datedInterval = (date, startTime, endTime) => {
  if (!date || !startTime || !endTime) return null;
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  const start = day.getTime() + toMinutes(startTime) * 60_000;
  let end = day.getTime() + toMinutes(endTime) * 60_000;
  if (end <= start) end += 24 * 60 * 60_000;
  return { start, end };
};

const datedRangesOverlap = (aDate, aStart, aEnd, bDate, bStart, bEnd) => {
  const a = datedInterval(aDate, aStart, aEnd);
  const b = datedInterval(bDate, bStart, bEnd);
  return Boolean(a && b && a.start < b.end && b.start < a.end);
};

const adjacentDateRange = (date) => {
  const center = new Date(date);
  center.setUTCHours(0, 0, 0, 0);
  const from = new Date(center);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(center);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
};

// A person can't drive two routes at once — reject an assignment that would
// double-book a driver on an overlapping day and time. The roster record is
// division-owned, and every route using that record is checked.
export const findOperatorConflict = async ({ operator, daysOfWeek, startTime, endTime, status = "active", excludeRunCutId, excludeRunCutIds = [] }) => {
  if (!isOperatingAssignmentStatus(status) || !operator || !daysOfWeek?.length || !startTime || !endTime) return null;

  const excludedIds = [...excludeRunCutIds, ...(excludeRunCutId ? [excludeRunCutId] : [])];

  const candidates = await RunCut.find({
    operator,
    status: { $nin: NON_OPERATING_RUN_CUT_STATUSES },
    ...(excludedIds.length && { _id: { $nin: excludedIds } }),
  }).populate("route", "code");

  for (const candidate of candidates) {
    if (!isOperatingAssignmentStatus(candidate.status)) continue;
    const overlapDays = recurringOverlapDays(
      daysOfWeek,
      startTime,
      endTime,
      candidate.daysOfWeek,
      candidate.startTime,
      candidate.endTime
    );
    if (overlapDays.length) {
      return {
        routeCode: candidate.route?.code,
        days: overlapDays,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
      };
    }
  }
  return null;
};

// Same idea as findOperatorConflict, but for a single date rather than a
// recurring weekly pattern — used when Deployment adds a one-off extra duty.
// Checking every other RunCutDay this operator has on this exact date
// covers both their regular scheduled route (already projected onto this
// date) and any other extras, in one query.
//
// A standby's own duty hours are an availability window, not a commitment —
// deploying a standby to cover a route already skips this check against the
// standby's own hours, so a standby candidate is never treated as a
// blocking conflict here either; only their non-standby duties can collide.
export const findOperatorConflictOnDate = async ({ operator, date, startTime, endTime, status = "active", excludeRunCutDayId }) => {
  if (!isOperatingAssignmentStatus(status) || !operator || !date || !startTime || !endTime) return null;

  const { from, to } = adjacentDateRange(date);

  const candidates = await RunCutDay.find({
    operator,
    status: { $nin: NON_OPERATING_RUN_CUT_STATUSES },
    date: { $gte: from, $lte: to },
    _id: { $ne: excludeRunCutDayId },
  }).populate("route", "code type");

  for (const candidate of candidates) {
    if (!isOperatingAssignmentStatus(candidate.status)) continue;
    if (candidate.route?.type === "standby") continue;
    if (datedRangesOverlap(date, startTime, endTime, candidate.date, candidate.startTime, candidate.endTime)) {
      return { routeCode: candidate.route?.code, startTime: candidate.startTime, endTime: candidate.endTime };
    }
  }
  return null;
};

export const findVehicleConflict = async ({ vehicle, daysOfWeek, startTime, endTime, status = "active", excludeRunCutId, excludeRunCutIds = [] }) => {
  if (!isOperatingAssignmentStatus(status) || !vehicle || !daysOfWeek?.length || !startTime || !endTime) return null;

  const excludedIds = [...excludeRunCutIds, ...(excludeRunCutId ? [excludeRunCutId] : [])];
  const candidates = await RunCut.find({
    vehicle,
    status: { $nin: NON_OPERATING_RUN_CUT_STATUSES },
    ...(excludedIds.length && { _id: { $nin: excludedIds } }),
  }).populate("route", "code");

  for (const candidate of candidates) {
    if (!isOperatingAssignmentStatus(candidate.status)) continue;
    const overlapDays = recurringOverlapDays(
      daysOfWeek,
      startTime,
      endTime,
      candidate.daysOfWeek,
      candidate.startTime,
      candidate.endTime
    );
    if (overlapDays.length) {
      return {
        routeCode: candidate.route?.code,
        days: overlapDays,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
      };
    }
  }
  return null;
};

// Same standby exemption as findOperatorConflictOnDate: a vehicle parked
// with a standby duty isn't committed anywhere yet, so that duty alone
// doesn't block using the vehicle for a different dated assignment.
export const findVehicleConflictOnDate = async ({ vehicle, date, startTime, endTime, status = "active", excludeRunCutDayId }) => {
  if (!isOperatingAssignmentStatus(status) || !vehicle || !date || !startTime || !endTime) return null;

  const { from, to } = adjacentDateRange(date);

  const candidates = await RunCutDay.find({
    vehicle,
    status: { $nin: NON_OPERATING_RUN_CUT_STATUSES },
    date: { $gte: from, $lte: to },
    _id: { $ne: excludeRunCutDayId },
  }).populate("route", "code type");

  for (const candidate of candidates) {
    if (!isOperatingAssignmentStatus(candidate.status)) continue;
    if (candidate.route?.type === "standby") continue;
    if (datedRangesOverlap(date, startTime, endTime, candidate.date, candidate.startTime, candidate.endTime)) {
      return { routeCode: candidate.route?.code, startTime: candidate.startTime, endTime: candidate.endTime };
    }
  }
  return null;
};

// The same vehicle covering several routes across a day is completely
// normal (one bus, several shifts) — only worth flagging when two
// assignments actually collide: same vehicle, an overlapping day, and an
// overlapping time. Runs in-memory over a division's already-loaded
// RunCuts rather than hitting the DB again per row.
export const findVehicleConflictIds = (runCuts) => {
  const conflicting = new Set();
  for (let i = 0; i < runCuts.length; i += 1) {
    const a = runCuts[i];
    if (!a.vehicle || !isOperatingAssignmentStatus(a.status)) continue;
    for (let j = i + 1; j < runCuts.length; j += 1) {
      const b = runCuts[j];
      if (!b.vehicle || !isOperatingAssignmentStatus(b.status)) continue;
      const sameVehicle = String(a.vehicle._id || a.vehicle) === String(b.vehicle._id || b.vehicle);
      if (!sameVehicle) continue;
      if (recurringOverlapDays(a.daysOfWeek, a.startTime, a.endTime, b.daysOfWeek, b.startTime, b.endTime).length) {
        conflicting.add(a._id.toString());
        conflicting.add(b._id.toString());
      }
    }
  }
  return conflicting;
};
