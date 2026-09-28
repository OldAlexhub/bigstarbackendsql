import Route from "../models/Route.js";
import Division from "../models/Division.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { runInTransaction } from "../utils/transaction.js";
import { restoreCoverageOwnedByStandbyDays } from "../utils/standbyCoveragePersistence.js";

export const listRoutes = async (req, res) => {
  const typeFilter = req.query.includeStandby === "1" ? {} : { type: { $ne: "standby" } };
  const activeFilter = { active: { $ne: false } };

  if (req.query.division) {
    if (!canAccessDivision(req.user, req.query.division)) {
      return res.status(403).json({ message: "No access to this division" });
    }
    const routes = await Route.find({ division: req.query.division, ...typeFilter, ...activeFilter })
      .sort({ code: 1 })
      .populate("division", "code name");
    return res.json({ routes });
  }

  const accessibleDivisionIds = await Division.find({
    ...divisionFilter(req.user),
    active: { $ne: false },
  }).distinct("_id");
  const routes = await Route.find({ division: { $in: accessibleDivisionIds }, ...typeFilter, ...activeFilter })
    .sort({ code: 1 })
    .populate("division", "code name");
  res.json({ routes });
};

export const createRoute = async (req, res) => {
  const { division, code, type = "standard" } = req.body;
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (!code?.trim()) return res.status(400).json({ message: "Route code is required" });
  if (!["standard", "standby"].includes(type)) {
    return res.status(400).json({ message: "Route type must be standard or standby" });
  }
  const existing = await Route.findOne({ division, code: code.trim() });
  if (existing && existing.active !== false) {
    return res.status(409).json({ message: `Route ${code.trim()} already exists in this division.` });
  }
  if (existing) {
    existing.active = true;
    existing.type = type;
    await existing.save();
    return res.status(201).json({ route: existing });
  }
  const route = await Route.create({ division, code: code.trim(), type });
  res.status(201).json({ route });
};

export const updateRoute = async (req, res) => {
  const route = await Route.findById(req.params.id);
  if (!route) return res.status(404).json({ message: "Route not found" });
  if (!canAccessDivision(req.user, route.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const { code, active, type } = req.body;
  if (code !== undefined) route.code = code;
  if (active !== undefined) route.active = active;
  if (type !== undefined) {
    if (!["standard", "standby"].includes(type)) {
      return res.status(400).json({ message: "Route type must be standard or standby" });
    }
    route.type = type;
  }
  await route.save();
  res.json({ route });
};

export const deleteRoute = async (req, res) => {
  const route = await Route.findById(req.params.id);
  if (!route) return res.status(404).json({ message: "Route not found" });
  if (!canAccessDivision(req.user, route.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  // Retiring a route also removes its live assignment and any future
  // projected days — otherwise the daily rollover keeps regenerating
  // RunCutDay for a route that no longer exists, and those orphaned rows
  // (route: null once populated) silently get counted as ordinary
  // operational duties in the Tracker. Past RunCutDay/issue history for
  // this route is left alone, same as everywhere else in this model. The
  // Route itself is kept inactive so historical records retain their code
  // and the action can be recovered by adding the same route again.
  await runInTransaction(async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const futureRunCutDays = await RunCutDay.find({ route: route._id, date: { $gte: today } });
    const futureIds = futureRunCutDays.map((rcd) => rcd._id);
    await DailyIssueLog.deleteMany({ runCutDay: { $in: futureIds }, autoSyncTag: { $ne: null } });
    await restoreCoverageOwnedByStandbyDays(futureIds, req.user._id);
    await RunCutDay.deleteMany({ _id: { $in: futureIds } });
    await RunCut.deleteOne({ route: route._id });

    route.active = false;
    await route.save();
  });
  res.json({ message: "Route removed from Master Run Cuts" });
};
