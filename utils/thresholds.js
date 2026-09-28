import DivisionThresholdChange from "../models/DivisionThresholdChange.js";

export const loadThresholdHistory = (divisionId) =>
  DivisionThresholdChange.find({ division: divisionId }).sort({ effectiveDate: -1 }).lean();

export const thresholdDateKey = (date) => new Date(date).toISOString().slice(0, 10);

export const parseThresholdDate = (value) => {
  const dateKey = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || thresholdDateKey(date) !== dateKey ? null : date;
};

// history must already be sorted newest-first (loadThresholdHistory does
// this). Picks the latest entry effective on or before `date`. A future
// entry never applies to an earlier date, and a date older than every
// recorded entry uses `fallback` (the division's own pre-history value)
// instead of guessing from whatever entry happens to exist.
export const resolveThresholdsFromHistory = (history, date, fallback) => {
  const entry = history.find((item) => item.effectiveDate <= date);
  return entry ? { breakMinutes: entry.breakMinutes, revenueRatio: entry.revenueRatio } : fallback;
};

export const getEffectiveThresholds = async (division, date) => {
  const history = await loadThresholdHistory(division._id);
  return resolveThresholdsFromHistory(history, date, {
    breakMinutes: division.thresholds.breakMinutes,
    revenueRatio: division.thresholds.revenueRatio,
  });
};
