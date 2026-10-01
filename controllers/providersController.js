import Provider from "../models/Provider.js";
import Operator from "../models/Operator.js";
import { canAccessDivision } from "../middleware/access.js";
import { isGlobalAdmin } from "../utils/roles.js";

export const listProviders = async (req, res) => {
  const requestedDivision = req.query.division;
  if (requestedDivision && !canAccessDivision(req.user, requestedDivision)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  let filter = {};
  if (requestedDivision || !isGlobalAdmin(req.user)) {
    const division = requestedDivision || { $in: req.user.divisionAccess };
    const providerIds = await Operator.distinct("provider", {
      division,
      provider: { $ne: null },
    });
    filter = { _id: { $in: providerIds } };
  }

  const providers = await Provider.find(filter).sort({ name: 1 });
  res.json({ providers });
};

export const createProvider = async (req, res) => {
  const { name, manager } = req.body;
  const provider = await Provider.create({ name, manager });
  res.status(201).json({ provider });
};

export const updateProvider = async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ message: "Provider not found" });
  const { name, manager, active } = req.body;
  if (name !== undefined) provider.name = name;
  if (manager !== undefined) provider.manager = manager;
  if (active !== undefined) provider.active = active;
  await provider.save();
  res.json({ provider });
};

export const deleteProvider = async (req, res) => {
  const provider = await Provider.findByIdAndDelete(req.params.id);
  if (!provider) return res.status(404).json({ message: "Provider not found" });
  res.json({ message: "Provider deleted" });
};
