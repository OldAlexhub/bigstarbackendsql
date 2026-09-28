import Settings from "../models/Settings.js";
import RetentionCleanupLog from "../models/RetentionCleanupLog.js";
import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import WeeklyDivisionSummary from "../models/WeeklyDivisionSummary.js";
import CustomerServiceEntry from "../models/CustomerServiceEntry.js";
import SafetyEntry from "../models/SafetyEntry.js";
import SafetyScoreEntry from "../models/SafetyScoreEntry.js";
import OperationsKpiResult from "../models/OperationsKpiResult.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import DeploymentActivityLog from "../models/DeploymentActivityLog.js";
import ChangeLog from "../models/ChangeLog.js";
import TeamPost from "../models/TeamPost.js";
import NetworkSubmission from "../models/NetworkSubmission.js";

export const DEFAULT_RETENTION_COLLECTIONS = {
  operationalHistory: [
    { name: "RunCutDay", model: RunCutDay, field: "date", format: "date" },
    { name: "DailyIssueLog", model: DailyIssueLog, field: "date", format: "date" },
    { name: "WeeklyDivisionSummary", model: WeeklyDivisionSummary, field: "weekStart", format: "date" },
    { name: "CustomerServiceEntry", model: CustomerServiceEntry, field: "month", format: "month" },
    { name: "SafetyEntry", model: SafetyEntry, field: "month", format: "month" },
    { name: "SafetyScoreEntry", model: SafetyScoreEntry, field: "month", format: "month" },
    { name: "OperationsKpiResult", model: OperationsKpiResult, field: "month", format: "month" },
    { name: "NetworkKpiEntry", model: NetworkKpiEntry, field: "date", format: "day" },
  ],
  auditLogs: [
    { name: "DeploymentActivityLog", model: DeploymentActivityLog, field: "createdAt", format: "date" },
    { name: "ChangeLog", model: ChangeLog, field: "changedAt", format: "date" },
    { name: "RetentionCleanupLog", model: RetentionCleanupLog, field: "timestamp", format: "date" },
  ],
  teamPosts: [
    { name: "TeamPost", model: TeamPost, field: "createdAt", format: "date" },
  ],
  networkSubmissionStaging: [
    { name: "NetworkSubmission", model: NetworkSubmission, field: "createdAt", format: "date", action: "clean" },
  ],
};

export const RETENTION_COLLECTION_NAMES = Object.values(DEFAULT_RETENTION_COLLECTIONS)
  .flat()
  .map(({ name }) => name);

export const retentionCutoff = (policy, now = new Date()) => {
  if (!policy || policy.unit === "indefinite") return null;
  const value = Number(policy.value);
  if (!Number.isInteger(value) || value < 1) return null;

  const cutoff = new Date(now);
  if (policy.unit === "days") {
    cutoff.setUTCDate(cutoff.getUTCDate() - value);
    return cutoff;
  }

  const originalDay = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  if (policy.unit === "months") cutoff.setUTCMonth(cutoff.getUTCMonth() - value);
  else if (policy.unit === "years") cutoff.setUTCFullYear(cutoff.getUTCFullYear() - value);
  else return null;
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(originalDay, lastDay));
  return cutoff;
};

const formattedCutoff = (cutoff, format) => {
  if (format === "month") return cutoff.toISOString().slice(0, 7);
  if (format === "day") return cutoff.toISOString().slice(0, 10);
  return cutoff;
};

const stagingFields = [
  "divisionCandidates",
  "parsedRows",
  "previewRows",
  "blockedDates",
  "warnings",
  "changeAudit",
];

const cleanNetworkSubmissionStaging = (target, cutoff) => target.model.updateMany(
  {
    [target.field]: { $lt: cutoff },
    $or: stagingFields.map((field) => ({ [`${field}.0`]: { $exists: true } })),
  },
  { $set: Object.fromEntries(stagingFields.map((field) => [field, []])) }
);

export const runRetentionCleanup = async ({
  now = new Date(),
  SettingsModel = Settings,
  CleanupLogModel = RetentionCleanupLog,
  collections = DEFAULT_RETENTION_COLLECTIONS,
} = {}) => {
  const settings = await SettingsModel.getSingleton();
  const result = {
    timestamp: now,
    recordsDeleted: 0,
    recordsCleaned: 0,
    errors: [],
    success: true,
  };

  if (settings.dataRetention?.enabled) {
    for (const [policyKey, targets] of Object.entries(collections)) {
      const cutoff = retentionCutoff(settings.dataRetention?.[policyKey], now);
      if (!cutoff) continue;

      for (const target of targets) {
        try {
          if (target.action === "clean") {
            const cleaned = await cleanNetworkSubmissionStaging(target, cutoff);
            result.recordsCleaned += cleaned.modifiedCount || 0;
          } else {
            const deleted = await target.model.deleteMany({
              [target.field]: { $lt: formattedCutoff(cutoff, target.format) },
            });
            result.recordsDeleted += deleted.deletedCount || 0;
          }
        } catch {
          result.errors.push(`${target.name} cleanup failed.`);
        }
      }
    }
  }

  result.success = result.errors.length === 0;
  await CleanupLogModel.create(result);
  return result;
};

