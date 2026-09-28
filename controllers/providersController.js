import Provider from "../models/Provider.js";

export const listProviders = async (req, res) => {
  const providers = await Provider.find().sort({ name: 1 });
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
