import Vehicle from "../models/Vehicle.js";
import Division from "../models/Division.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { normalizeCode } from "../utils/normalizeText.js";
import { todayInTimezone } from "../utils/timezone.js";

export const listVehicles = async (req, res) => {
  if (req.query.division) {
    if (!canAccessDivision(req.user, req.query.division)) {
      return res.status(403).json({ message: "No access to this division" });
    }
    const vehicles = await Vehicle.find({
      division: req.query.division,
      ...(req.query.active === "1" && { active: true }),
    })
      .sort({ code: 1 })
      .populate("division", "code name");
    return res.json({ vehicles });
  }

  const accessibleDivisionIds = await Division.find({
    ...divisionFilter(req.user),
    active: { $ne: false },
  }).distinct("_id");
  const vehicles = await Vehicle.find({
    division: { $in: accessibleDivisionIds },
    ...(req.query.active === "1" && { active: true }),
  })
    .sort({ code: 1 })
    .populate("division", "code name");
  res.json({ vehicles });
};

export const createVehicle = async (req, res) => {
  const { division } = req.body;
  const code = normalizeCode(req.body.code);
  if (!canAccessDivision(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (!code) return res.status(400).json({ message: "Vehicle number is required." });
  try {
    const inactive = await Vehicle.findOne({ division, code, active: false });
    if (inactive) {
      inactive.active = true;
      await inactive.save();
      const vehicle = await Vehicle.findById(inactive._id).populate("division", "code name");
      return res.status(201).json({ vehicle });
    }
    const created = await Vehicle.create({ division, code });
    const vehicle = await Vehicle.findById(created._id).populate("division", "code name");
    res.status(201).json({ vehicle });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "That vehicle is already in this division's roster." });
    }
    throw error;
  }
};

export const updateVehicle = async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
  if (!canAccessDivision(req.user, vehicle.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const { code, division, active } = req.body;
  if (division !== undefined && String(division) !== String(vehicle.division)) {
    if (!canAccessDivision(req.user, division)) {
      return res.status(403).json({ message: "No access to the selected division" });
    }
    const currentDivision = await Division.findById(vehicle.division).select("timezone");
    const today = todayInTimezone(currentDivision?.timezone);
    const assigned =
      (await RunCut.exists({ vehicle: vehicle._id })) ||
      (await RunCutDay.exists({ vehicle: vehicle._id, date: { $gte: today } }));
    if (assigned) {
      return res.status(409).json({ message: "Unassign this vehicle from Master Run Cuts before changing divisions." });
    }
    vehicle.division = division;
  }
  if (code !== undefined) {
    const normalized = normalizeCode(code);
    if (!normalized) return res.status(400).json({ message: "Vehicle number is required." });
    vehicle.code = normalized;
  }
  if (active !== undefined) vehicle.active = active;
  try {
    await vehicle.save();
    const populated = await Vehicle.findById(vehicle._id).populate("division", "code name");
    res.json({ vehicle: populated });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "That vehicle is already in this division's roster." });
    }
    throw error;
  }
};

export const deleteVehicle = async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
  if (!canAccessDivision(req.user, vehicle.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const assigned = (await RunCut.exists({ vehicle: vehicle._id })) || (await RunCutDay.exists({ vehicle: vehicle._id }));
  if (assigned) {
    vehicle.active = false;
    await vehicle.save();
    return res.json({ message: "Vehicle removed from assignment lists and kept for schedule history.", deactivated: true });
  }
  await vehicle.deleteOne();
  res.json({ message: "Vehicle removed" });
};
