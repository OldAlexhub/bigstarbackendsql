import Division from "../models/Division.js";
import User from "../models/User.js";
import ChangeLog from "../models/ChangeLog.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
import DivisionThresholdChange from "../models/DivisionThresholdChange.js";
import Operator from "../models/Operator.js";
import Route from "../models/Route.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import Vehicle from "../models/Vehicle.js";
import WeeklyDivisionSummary from "../models/WeeklyDivisionSummary.js";
import NetworkSubmission from "../models/NetworkSubmission.js";
import NetworkRouteAlias from "../models/NetworkRouteAlias.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import CustomerServiceEntry from "../models/CustomerServiceEntry.js";
import SafetyEntry from "../models/SafetyEntry.js";
import SafetyScoreEntry from "../models/SafetyScoreEntry.js";
import OperationsKpiSetting from "../models/OperationsKpiSetting.js";
import OperationsKpiResult from "../models/OperationsKpiResult.js";
import CorrectiveActionPlan from "../models/CorrectiveActionPlan.js";
import ReallocationRequest from "../models/ReallocationRequest.js";
import PermanentOsrChange from "../models/PermanentOsrChange.js";
import TeamPost from "../models/TeamPost.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { isGlobalAdmin } from "../utils/roles.js";
import { ensureDefaultKpiSettings } from "../utils/operationsReporting.js";
import { runInTransaction } from "../utils/transaction.js";
import {
  loadThresholdHistory,
  parseThresholdDate,
  resolveThresholdsFromHistory,
  thresholdDateKey,
} from "../utils/thresholds.js";
import { recomputeDivisionRunCutHours } from "../utils/recomputeRunCutHours.js";
import { todayInTimezone } from "../utils/timezone.js";

export const DIVISION_OWNED_MODELS = [
  DailyIssueLog,
  DeploymentActivityLog,
  DivisionThresholdChange,
  Operator,
  Route,
  RunCut,
  RunCutDay,
  Vehicle,
  WeeklyDivisionSummary,
  NetworkSubmission,
  NetworkRouteAlias,
  NetworkKpiEntry,
  CustomerServiceEntry,
  SafetyEntry,
  SafetyScoreEntry,
  OperationsKpiSetting,
  OperationsKpiResult,
  CorrectiveActionPlan,
  ReallocationRequest,
  PermanentOsrChange,
  TeamPost,
];

const normalizedHistory = (history) => history.map((entry) => ({
  ...entry,
  effectiveDate: new Date(entry.effectiveDate),
}));

const baselineDateBefore = (division, effectiveDate) => {
  const createdDate = division.createdAt
    ? parseThresholdDate(thresholdDateKey(division.createdAt))
    : null;
  if (createdDate && createdDate < effectiveDate) return createdDate;
  const dayBefore = new Date(effectiveDate);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return dayBefore;
};

// Adds or updates one dated threshold version. Past dates are deliberately
// locked: new policy can start today or later, while prior reported days keep
// the values that were in force for them.
const applyThresholdChange = async (division, thresholds, userId) => {
  const today = todayInTimezone(division.timezone);
  const effectiveDate = thresholds.effectiveDate
    ? parseThresholdDate(thresholds.effectiveDate)
    : today;
  if (!effectiveDate) {
    return { error: "Choose a valid start date for this break minutes / revenue ratio change." };
  }
  if (effectiveDate < today) {
    return { error: "The start date cannot be in the past. Past settings are locked to preserve reported history." };
  }

  let history = normalizedHistory(await loadThresholdHistory(division._id));
  const fallback = {
    breakMinutes: division.thresholds.breakMinutes,
    revenueRatio: division.thresholds.revenueRatio,
  };
  const effectiveAtDate = resolveThresholdsFromHistory(history, effectiveDate, fallback);
  const breakMinutes = thresholds.breakMinutes === undefined
    ? effectiveAtDate.breakMinutes
    : Number(thresholds.breakMinutes);
  const revenueRatio = thresholds.revenueRatio === undefined
    ? effectiveAtDate.revenueRatio
    : Number(thresholds.revenueRatio);

  if (
    thresholds.breakMinutes === null ||
    thresholds.breakMinutes === "" ||
    !Number.isFinite(breakMinutes)
  ) {
    return { error: "Break minutes is required for every division." };
  }
  if (
    thresholds.revenueRatio === null ||
    thresholds.revenueRatio === "" ||
    !Number.isFinite(revenueRatio)
  ) {
    return { error: "Revenue ratio is required for every division." };
  }

  const dateKey = thresholdDateKey(effectiveDate);
  const existing = history.find((entry) => thresholdDateKey(entry.effectiveDate) === dateKey);
  if (
    effectiveAtDate.breakMinutes === breakMinutes &&
    effectiveAtDate.revenueRatio === revenueRatio &&
    (!existing || (existing.breakMinutes === breakMinutes && existing.revenueRatio === revenueRatio))
  ) {
    return { changed: false, history };
  }

  // Older divisions may predate the versioned history collection. Preserve
  // their original cached values as a baseline before inserting the first
  // change, so dates before this change never fall back to the new value.
  if (!history.length) {
    const baselineDate = baselineDateBefore(division, effectiveDate);
    await DivisionThresholdChange.findOneAndUpdate(
      { division: division._id, effectiveDate: baselineDate },
      {
        breakMinutes: fallback.breakMinutes,
        revenueRatio: fallback.revenueRatio,
        createdBy: userId,
      },
      { upsert: true, runValidators: true }
    );
    history = [{
      division: division._id,
      effectiveDate: baselineDate,
      breakMinutes: fallback.breakMinutes,
      revenueRatio: fallback.revenueRatio,
      createdBy: userId,
    }];
  }

  await DivisionThresholdChange.findOneAndUpdate(
    { division: division._id, effectiveDate },
    { breakMinutes, revenueRatio, createdBy: userId },
    { upsert: true, runValidators: true }
  );

  history = normalizedHistory(await loadThresholdHistory(division._id));
  const effectiveToday = resolveThresholdsFromHistory(history, today, fallback);
  division.thresholds.breakMinutes = effectiveToday.breakMinutes;
  division.thresholds.revenueRatio = effectiveToday.revenueRatio;
  return { changed: true, history };
};

export const listDivisions = async (req, res) => {
  const includeInactive = req.query.includeInactive === "1" && isGlobalAdmin(req.user);
  const divisions = await Division.find({
    ...divisionFilter(req.user),
    ...(includeInactive ? {} : { active: { $ne: false } }),
  })
    .sort({ code: 1 })
    .populate("parentDivision", "code name");

  const divisionIds = divisions.map((division) => division._id);
  const allHistory = divisionIds.length
    ? normalizedHistory(await DivisionThresholdChange.find({ division: { $in: divisionIds } }).lean())
    : [];
  const historyByDivision = new Map();
  for (const entry of allHistory) {
    const key = String(entry.division);
    if (!historyByDivision.has(key)) historyByDivision.set(key, []);
    historyByDivision.get(key).push(entry);
  }
  for (const history of historyByDivision.values()) {
    history.sort((a, b) => b.effectiveDate - a.effectiveDate);
  }

  res.json({
    divisions: divisions.map((division) => {
      const item = typeof division.toObject === "function" ? division.toObject() : division;
      const history = historyByDivision.get(String(item._id)) || [];
      return {
        ...item,
        thresholds: resolveThresholdsFromHistory(
          history,
          todayInTimezone(item.timezone),
          item.thresholds
        ),
      };
    }),
  });
};

export const listDivisionThresholds = async (req, res) => {
  const filter = isGlobalAdmin(req.user)
    ? {}
    : { division: { $in: req.user.divisionAccess || [] } };
  const thresholds = await DivisionThresholdChange.find(filter)
    .sort({ effectiveDate: -1, createdAt: -1 })
    .lean();
  res.json({ thresholds });
};

export const createDivision = async (req, res) => {
  const { code, name, type, parentDivision, thresholds, timezone } = req.body;
  const breakMinutes = Number(thresholds?.breakMinutes);
  const revenueRatio = Number(thresholds?.revenueRatio);
  if (
    thresholds?.breakMinutes === null ||
    thresholds?.breakMinutes === undefined ||
    thresholds?.breakMinutes === "" ||
    thresholds?.revenueRatio === null ||
    thresholds?.revenueRatio === undefined ||
    thresholds?.revenueRatio === "" ||
    !Number.isFinite(breakMinutes) ||
    !Number.isFinite(revenueRatio)
  ) {
    return res.status(400).json({ message: "Break minutes and revenue ratio are required to create a division." });
  }
  const division = await Division.create({
    code,
    name,
    type,
    parentDivision,
    thresholds: { breakMinutes, revenueRatio },
    timezone,
  });
  // Seed the effective-dated history (server/models/DivisionThresholdChange.js)
  // so getEffectiveThresholds always has a real entry to resolve, from the
  // division's very first day forward, instead of only ever relying on the
  // undated fallback on Division itself.
  await DivisionThresholdChange.create({
    division: division._id,
    effectiveDate: todayInTimezone(timezone),
    breakMinutes,
    revenueRatio,
    createdBy: req.user._id,
  });
  await ensureDefaultKpiSettings([division]);
  res.status(201).json({ division });
};

export const updateDivision = async (req, res) => {
  const { id } = req.params;
  const division = await Division.findById(id);
  if (!division) return res.status(404).json({ message: "Division not found" });
  if (!canAccessDivision(req.user, division._id)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const { name, active, thresholds, pulloutAddressRules } = req.body;
  if (name !== undefined) {
    if (!isGlobalAdmin(req.user)) {
      return res.status(403).json({ message: "ELT or Super Admin access is required to rename a division" });
    }
    const trimmedName = String(name).trim();
    if (!trimmedName) return res.status(400).json({ message: "Division name is required" });
    division.name = trimmedName;
  }
  if (active !== undefined) {
    if (!isGlobalAdmin(req.user)) {
      return res.status(403).json({ message: "ELT or Super Admin access is required to retire or restore a division" });
    }
    division.active = Boolean(active);
  }
  // A break minutes / revenue ratio change takes effect from a chosen start
  // date (default: today) instead of overwriting the current value outright,
  // so a change scheduled for today or the future doesn't touch dates before
  // it. Past start dates are rejected. See server/models/DivisionThresholdChange.js and
  // server/utils/thresholds.js for how that history gets resolved.
  let thresholdChangeMade = false;
  if (thresholds !== undefined && (thresholds.breakMinutes !== undefined || thresholds.revenueRatio !== undefined)) {
    const result = await applyThresholdChange(division, thresholds, req.user._id);
    if (result.error) return res.status(400).json({ message: result.error });
    thresholdChangeMade = result.changed;
  }
  if (pulloutAddressRules !== undefined) {
    if (pulloutAddressRules.standbyKeepsRouteAddress !== undefined) {
      division.pulloutAddressRules.standbyKeepsRouteAddress = Boolean(pulloutAddressRules.standbyKeepsRouteAddress);
    }
    if (pulloutAddressRules.editableInLiveSchedule !== undefined) {
      division.pulloutAddressRules.editableInLiveSchedule = Boolean(pulloutAddressRules.editableInLiveSchedule);
    }
  }
  if (isGlobalAdmin(req.user)) {
    const { code, type, parentDivision, timezone } = req.body;
    if (code !== undefined) division.code = code;
    if (type !== undefined) division.type = type;
    if (parentDivision !== undefined) division.parentDivision = parentDivision;
    if (timezone !== undefined) division.timezone = timezone;
  }

  await division.save();

  if (thresholdChangeMade) {
    await recomputeDivisionRunCutHours(division, req.user._id);
  }
  if (active === true) await ensureDefaultKpiSettings([division]);
  res.json({ division });
};

export const saveDivisionThreshold = async (req, res) => {
  const division = await Division.findById(req.params.id);
  if (!division) return res.status(404).json({ message: "Division not found" });
  if (!canAccessDivision(req.user, division._id)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (division.active === false) {
    return res.status(400).json({ message: "Restore this division before scheduling a settings change." });
  }

  const result = await applyThresholdChange(division, req.body || {}, req.user._id);
  if (result.error) return res.status(400).json({ message: result.error });

  await division.save();
  if (result.changed) {
    await recomputeDivisionRunCutHours(division, req.user._id);
  }

  const thresholds = await loadThresholdHistory(division._id);
  res.json({ division, thresholds, changed: result.changed });
};

export const deleteDivision = async (req, res) => {
  const division = await Division.findById(req.params.id);
  if (!division) return res.status(404).json({ message: "Division not found" });
  if (req.body?.confirmationCode !== division.code) {
    return res.status(400).json({ message: `Type ${division.code} to confirm permanent deletion` });
  }

  const divisionId = division._id;
  await runInTransaction(async () => {
    // Keep dependent deletes ordered on the shared transaction connection.
    for (const Model of DIVISION_OWNED_MODELS) {
      await Model.deleteMany({ division: divisionId });
    }
    await ChangeLog.deleteMany({ entityType: "Division", entityId: divisionId });
    await User.updateMany(
      { divisionAccess: divisionId },
      { $pull: { divisionAccess: divisionId } }
    );
    await Division.updateMany(
      { parentDivision: divisionId },
      { $set: { parentDivision: null } }
    );
    await Division.deleteOne({ _id: divisionId });
  });

  res.json({
    message: "Division and all associated records were permanently deleted",
    deletedDivisionId: divisionId,
  });
};
