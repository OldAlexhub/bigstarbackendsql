import mongoose from "../db/sqlMongoose.js";
import SafetyEntry from "../models/SafetyEntry.js";
import SafetyScoreEntry from "../models/SafetyScoreEntry.js";
import Division from "../models/Division.js";
import OperationsKpiSetting from "../models/OperationsKpiSetting.js";
import { canAccessDivision } from "../middleware/access.js";
import { buildSafetyAnalytics } from "../utils/safetyAnalytics.js";
import { addMonths, baseStatus, statusWithCritical } from "../utils/operationsKpis.js";
import { ensureDefaultKpiSettings, queueOperationsRefresh } from "../utils/operationsReporting.js";

const monthPattern = /^\d{4}-\d{2}$/;

const isCalendarMonth = (value) => {
  if (!monthPattern.test(String(value || ""))) return false;
  const parsed = new Date(`${value}-01T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 7) === value;
};

const numberValue = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const countValue = (value) => {
  const parsed = numberValue(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const entryJson = (entry) => ({
  id: String(entry._id),
  division: entry.division,
  month: entry.month,
  miles: entry.miles,
  preventableAccidents: entry.preventableAccidents,
  nonPreventableAccidents: entry.nonPreventableAccidents,
  updatedAt: entry.updatedAt,
});

const scoreJson = (entry) => ({
  id: String(entry._id),
  division: entry.division,
  month: entry.month,
  score: entry.score,
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

const validateRange = (res, from, to) => {
  if (from && !isCalendarMonth(from)) {
    res.status(400).json({ message: "From must be a valid month." });
    return false;
  }
  if (to && !isCalendarMonth(to)) {
    res.status(400).json({ message: "To must be a valid month." });
    return false;
  }
  if (from && to && from > to) {
    res.status(400).json({ message: "From month must be on or before To month." });
    return false;
  }
  return true;
};

export const listSafetyEntries = async (req, res) => {
  const { division, from, to } = req.query;
  if (!validateDivision(req, res, division) || !validateRange(res, from, to)) return;
  const filter = { division };
  if (from || to) filter.month = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const entries = await SafetyEntry.find(filter).sort({ month: -1 }).limit(120).lean();
  res.json({ entries: entries.map(entryJson) });
};

export const saveSafetyEntry = async (req, res) => {
  const { division, month } = req.body;
  if (!validateDivision(req, res, division)) return;
  if (!isCalendarMonth(month)) return res.status(400).json({ message: "A valid service month is required." });

  const miles = numberValue(req.body.miles);
  const preventableAccidents = countValue(req.body.preventableAccidents);
  const nonPreventableAccidents = countValue(req.body.nonPreventableAccidents);
  if (miles === null) return res.status(400).json({ message: "Miles must be a number of zero or more." });
  if (preventableAccidents === null || nonPreventableAccidents === null) {
    return res.status(400).json({ message: "Accident counts must be whole numbers of zero or more." });
  }
  if (miles === 0 && (preventableAccidents > 0 || nonPreventableAccidents > 0)) {
    return res.status(400).json({ message: "Miles must be greater than zero when an accident count is reported." });
  }

  const existing = await SafetyEntry.findOne({ division, month });
  let entry;
  let created = false;
  if (existing) {
    existing.miles = miles;
    existing.preventableAccidents = preventableAccidents;
    existing.nonPreventableAccidents = nonPreventableAccidents;
    existing.updatedBy = req.user._id;
    entry = await existing.save();
  } else {
    entry = await SafetyEntry.create({
      division,
      month,
      miles,
      preventableAccidents,
      nonPreventableAccidents,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    created = true;
  }

  await entry.populate("division", "code name");
  queueOperationsRefresh(division, month);
  res.status(created ? 201 : 200).json({ entry: entryJson(entry), created });
};

export const deleteSafetyEntry = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "A valid safety entry is required." });
  }
  const entry = await SafetyEntry.findById(req.params.id);
  if (!entry) return res.status(404).json({ message: "Safety entry not found." });
  if (!canAccessDivision(req.user, entry.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const { division, month } = entry;
  await entry.deleteOne();
  queueOperationsRefresh(division, month);
  res.json({ message: "Safety entry removed." });
};

export const listSafetyScores = async (req, res) => {
  const { division, from, to } = req.query;
  if (!validateDivision(req, res, division) || !validateRange(res, from, to)) return;
  const filter = { division };
  if (from || to) filter.month = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const entries = await SafetyScoreEntry.find(filter).sort({ month: -1 }).limit(120).lean();
  res.json({ entries: entries.map(scoreJson) });
};

export const saveSafetyScore = async (req, res) => {
  const { division, month } = req.body;
  if (!validateDivision(req, res, division)) return;
  if (!isCalendarMonth(month)) return res.status(400).json({ message: "A valid service month is required." });
  const score = numberValue(req.body.score);
  if (score === null) return res.status(400).json({ message: "Safety score must be a number of zero or more." });
  const existing = await SafetyScoreEntry.findOne({ division, month });
  let entry;
  let created = false;
  if (existing) {
    existing.score = score;
    existing.updatedBy = req.user._id;
    entry = await existing.save();
  } else {
    entry = await SafetyScoreEntry.create({ division, month, score, createdBy: req.user._id, updatedBy: req.user._id });
    created = true;
  }
  await entry.populate("division", "code name");
  queueOperationsRefresh(division, month);
  res.status(created ? 201 : 200).json({ entry: scoreJson(entry), created });
};

export const deleteSafetyScore = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "A valid safety score is required." });
  const entry = await SafetyScoreEntry.findById(req.params.id);
  if (!entry) return res.status(404).json({ message: "Safety score not found." });
  if (!canAccessDivision(req.user, entry.division)) return res.status(403).json({ message: "No access to this division" });
  const { division, month } = entry;
  await entry.deleteOne();
  queueOperationsRefresh(division, month);
  res.json({ message: "Safety score removed." });
};

export const getSafetyAnalytics = async (req, res) => {
  const { division, from, to } = req.query;
  if (!validateDivision(req, res, division) || !validateRange(res, from, to)) return;
  const filter = { division };
  if (from || to) filter.month = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const [entries, scores, oldest, newest, oldestScore, newestScore, divisionDoc] = await Promise.all([
    SafetyEntry.find(filter).sort({ month: 1 }).lean(),
    SafetyScoreEntry.find(filter).sort({ month: 1 }).lean(),
    SafetyEntry.findOne({ division }).sort({ month: 1 }).select("month").lean(),
    SafetyEntry.findOne({ division }).sort({ month: -1 }).select("month").lean(),
    SafetyScoreEntry.findOne({ division }).sort({ month: 1 }).select("month").lean(),
    SafetyScoreEntry.findOne({ division }).sort({ month: -1 }).select("month").lean(),
    Division.findById(division),
  ]);

  await ensureDefaultKpiSettings(divisionDoc ? [divisionDoc] : []);
  const settings = await OperationsKpiSetting.find({
    division,
    kpiKey: "safety_score",
    effectiveMonth: { $lte: to || newestScore?.month || "9999-12" },
  }).sort({ effectiveMonth: 1 }).lean();
  const effectiveSetting = (month) => {
    let selected = null;
    for (const setting of settings) {
      if (setting.effectiveMonth <= month) selected = setting;
      else break;
    }
    return selected;
  };
  let previousScoreBaseStatus = null;
  let previousScoreMonth = null;
  const scoreMonthly = scores.map((entry) => {
    const setting = effectiveSetting(entry.month);
    const scoreBaseStatus = setting ? baseStatus(entry.score, setting) : "no_data";
    const isConsecutive = previousScoreMonth && addMonths(previousScoreMonth, 1) === entry.month;
    const status = setting ? statusWithCritical(entry.score, setting, isConsecutive ? previousScoreBaseStatus : null) : "no_data";
    previousScoreBaseStatus = scoreBaseStatus;
    previousScoreMonth = entry.month;
    return {
      ...scoreJson(entry),
      target: setting?.target ?? null,
      redCutoff: setting?.redCutoff ?? null,
      direction: setting?.direction ?? null,
      status,
    };
  });
  const latestScore = scoreMonthly.at(-1) || null;
  const scoreAverage = scoreMonthly.length
    ? Math.round((scoreMonthly.reduce((sum, entry) => sum + entry.score, 0) / scoreMonthly.length) * 100) / 100
    : null;

  const bounds = [oldest?.month, newest?.month, oldestScore?.month, newestScore?.month].filter(Boolean).sort();

  res.json({
    ...buildSafetyAnalytics(entries),
    safetyScores: {
      summary: { average: scoreAverage, latest: latestScore, reportedMonths: scoreMonthly.length },
      monthly: scoreMonthly,
    },
    monthBounds: { from: bounds[0] || null, to: bounds.at(-1) || null },
    filters: { division, from: from || null, to: to || null },
  });
};
