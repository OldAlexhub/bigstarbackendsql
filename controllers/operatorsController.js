import Operator from "../models/Operator.js";
import Division from "../models/Division.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { normalizeName } from "../utils/normalizeText.js";
import { todayInTimezone } from "../utils/timezone.js";
import { getBranchGroupDivisionIds } from "../utils/divisionBranches.js";

const populatedOperator = (query) =>
  query.populate("division", "code name").populate("provider", "name");

const duplicateMessage = (error, res) => {
  if (error?.code !== 11000) return false;
  res.status(409).json({ message: "That driver is already in this division's roster." });
  return true;
};

export const listOperators = async (req, res) => {
  const filter = {};
  if (req.query.division) {
    if (!canAccessDivision(req.user, req.query.division)) {
      return res.status(403).json({ message: "No access to this division" });
    }
    // A division that shares its standby pool with related branches (e.g.
    // Division 3 ADA/GoLink) also needs those branches' drivers selectable
    // here — a shared-pool driver picking up a one-off route in this
    // division shouldn't be limited to this division's own roster.
    filter.division = req.query.sharedStandby === "1"
      ? { $in: await getBranchGroupDivisionIds(req.query.division) }
      : req.query.division;
  } else {
    const accessibleDivisionIds = await Division.find({
      ...divisionFilter(req.user),
      active: { $ne: false },
    }).distinct("_id");
    filter.division = { $in: accessibleDivisionIds };
  }
  if (req.query.active === "1") filter.active = true;

  const operators = await populatedOperator(Operator.find(filter).sort({ name: 1 }));
  res.json({ operators });
};

export const createOperator = async (req, res) => {
  const { division, employeeId, provider, pulloutAddress, active } = req.body;
  const name = normalizeName(req.body.name);
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (!name) return res.status(400).json({ message: "Driver name is required." });

  try {
    const inactive = await Operator.findOne({ division, name, active: false });
    if (inactive) {
      inactive.name = name;
      inactive.pulloutAddress = pulloutAddress || "";
      inactive.employeeId = employeeId || null;
      inactive.provider = provider || null;
      inactive.active = active !== false;
      await inactive.save();
      const operator = await populatedOperator(Operator.findById(inactive._id));
      return res.status(201).json({ operator });
    }

    const created = await Operator.create({
      division,
      name,
      pulloutAddress: pulloutAddress || "",
      employeeId,
      provider: provider || null,
      active: active !== false,
    });
    const operator = await populatedOperator(Operator.findById(created._id));
    res.status(201).json({ operator });
  } catch (error) {
    if (!duplicateMessage(error, res)) throw error;
  }
};

export const updateOperator = async (req, res) => {
  const operator = await Operator.findById(req.params.id);
  if (!operator) return res.status(404).json({ message: "Operator not found" });
  if (!canAccessDivision(req.user, operator.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const { name, division, pulloutAddress, employeeId, provider, active } = req.body;
  const previousPulloutAddress = operator.pulloutAddress || "";
  if (division !== undefined && String(division) !== String(operator.division)) {
    if (!canAccessDivision(req.user, division)) {
      return res.status(403).json({ message: "No access to the selected division" });
    }
    const currentDivision = await Division.findById(operator.division).select("timezone");
    const today = todayInTimezone(currentDivision?.timezone);
    const assigned =
      (await RunCut.exists({ operator: operator._id })) ||
      (await RunCutDay.exists({ operator: operator._id, date: { $gte: today } }));
    if (assigned) {
      return res.status(409).json({ message: "Unassign this driver from Master Run Cuts before changing divisions." });
    }
    operator.division = division;
  }
  if (name !== undefined) {
    const normalized = normalizeName(name);
    if (!normalized) return res.status(400).json({ message: "Driver name is required." });
    operator.name = normalized;
  }
  if (pulloutAddress !== undefined) operator.pulloutAddress = pulloutAddress;
  if (employeeId !== undefined) operator.employeeId = employeeId;
  if (provider !== undefined) operator.provider = provider || null;
  if (active !== undefined) operator.active = active;
  try {
    await operator.save();
    if ((operator.pulloutAddress || "") !== previousPulloutAddress) {
      const divisionDoc = await Division.findById(operator.division).select("timezone");
      const today = todayInTimezone(divisionDoc?.timezone);
      await Promise.all([
        RunCut.updateMany({ operator: operator._id }, { $set: { pulloutAddress: operator.pulloutAddress || "" } }),
        RunCutDay.updateMany(
          { operator: operator._id, date: { $gte: today } },
          { $set: { pulloutAddress: operator.pulloutAddress || "" } }
        ),
      ]);
    }
    const populated = await populatedOperator(Operator.findById(operator._id));
    res.json({ operator: populated });
  } catch (error) {
    if (!duplicateMessage(error, res)) throw error;
  }
};

export const deleteOperator = async (req, res) => {
  const operator = await Operator.findById(req.params.id);
  if (!operator) return res.status(404).json({ message: "Operator not found" });
  if (!canAccessDivision(req.user, operator.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const assigned = (await RunCut.exists({ operator: operator._id })) || (await RunCutDay.exists({ operator: operator._id }));
  if (assigned) {
    operator.active = false;
    await operator.save();
    return res.json({ message: "Driver removed from assignment lists and kept inactive for schedule history.", deactivated: true });
  }
  await operator.deleteOne();
  res.json({ message: "Driver removed" });
};
