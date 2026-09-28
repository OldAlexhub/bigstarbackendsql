import mongoose from "../db/sqlMongoose.js";
import CustomerServiceEntry from "../models/CustomerServiceEntry.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import { canAccessDivision } from "../middleware/access.js";
import { buildCustomerServiceAnalytics } from "../utils/customerServiceAnalytics.js";
import { queueOperationsRefresh } from "../utils/operationsReporting.js";

const monthPattern = /^\d{4}-\d{2}$/;

const isCalendarMonth = (value) => {
  if (!monthPattern.test(String(value || ""))) return false;
  const parsed = new Date(`${value}-01T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 7) === value;
};

const lastDayOfMonth = (month) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
};

const countValue = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const entryJson = (entry) => ({
  id: String(entry._id),
  division: entry.division,
  month: entry.month,
  complaints: entry.complaints,
  compliments: entry.compliments,
  updatedAt: entry.updatedAt,
});

const validateDivision = (req, res, division) => {
  if (!division || !mongoose.isValidObjectId(division)) {
    res.status(400).json({ message: "A valid division is required." });
    return false;
  }
  if (!canAccessDivision(req.user, division)) {
    res.status(403).json({ message: "No access to this division" });
    return false;
  }
  return true;
};

export const listCustomerServiceEntries = async (req, res) => {
  const { division, from, to } = req.query;
  if (!validateDivision(req, res, division)) return;
  if (from && !isCalendarMonth(from)) return res.status(400).json({ message: "From must be a valid month." });
  if (to && !isCalendarMonth(to)) return res.status(400).json({ message: "To must be a valid month." });
  if (from && to && from > to) return res.status(400).json({ message: "From month must be on or before To month." });

  const filter = { division };
  if (from || to) filter.month = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const entries = await CustomerServiceEntry.find(filter).sort({ month: -1 }).limit(120).lean();
  res.json({ entries: entries.map(entryJson) });
};

export const saveCustomerServiceEntry = async (req, res) => {
  const { division, month } = req.body;
  if (!validateDivision(req, res, division)) return;
  if (!isCalendarMonth(month)) return res.status(400).json({ message: "A valid service month is required." });
  const complaints = countValue(req.body.complaints);
  const compliments = countValue(req.body.compliments);
  if (complaints === null || compliments === null) {
    return res.status(400).json({ message: "Complaints and compliments must be whole numbers of zero or more." });
  }

  const existing = await CustomerServiceEntry.findOne({ division, month });
  let entry;
  let created = false;
  if (existing) {
    existing.complaints = complaints;
    existing.compliments = compliments;
    existing.updatedBy = req.user._id;
    entry = await existing.save();
  } else {
    entry = await CustomerServiceEntry.create({
      division,
      month,
      complaints,
      compliments,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    created = true;
  }

  await entry.populate("division", "code name");
  queueOperationsRefresh(division, month);
  res.status(created ? 201 : 200).json({ entry: entryJson(entry), created });
};

export const deleteCustomerServiceEntry = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "A valid customer service entry is required." });
  }
  const entry = await CustomerServiceEntry.findById(req.params.id);
  if (!entry) return res.status(404).json({ message: "Customer service entry not found." });
  if (!canAccessDivision(req.user, entry.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const { division, month } = entry;
  await entry.deleteOne();
  queueOperationsRefresh(division, month);
  res.json({ message: "Customer service entry removed." });
};

export const getCustomerServiceAnalytics = async (req, res) => {
  const { division, from, to } = req.query;
  if (!validateDivision(req, res, division)) return;
  if (from && !isCalendarMonth(from)) return res.status(400).json({ message: "From must be a valid month." });
  if (to && !isCalendarMonth(to)) return res.status(400).json({ message: "To must be a valid month." });
  if (from && to && from > to) return res.status(400).json({ message: "From month must be on or before To month." });

  const filter = { division };
  if (from || to) filter.month = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const [entries, oldest, newest] = await Promise.all([
    CustomerServiceEntry.find(filter).sort({ month: 1 }).lean(),
    CustomerServiceEntry.findOne({ division }).sort({ month: 1 }).select("month").lean(),
    CustomerServiceEntry.findOne({ division }).sort({ month: -1 }).select("month").lean(),
  ]);
  const months = entries.map((entry) => entry.month);
  const networkEntries = months.length
    ? await NetworkKpiEntry.find({
        division,
        date: { $gte: `${months[0]}-01`, $lte: lastDayOfMonth(months[months.length - 1]) },
      }).select("date metrics.completedTrips").lean()
    : [];

  res.json({
    ...buildCustomerServiceAnalytics(entries, networkEntries),
    monthBounds: { from: oldest?.month || null, to: newest?.month || null },
    filters: { division, from: from || null, to: to || null },
  });
};
