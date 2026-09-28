import { runRetentionCleanup } from "../services/dataRetention.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const runScheduledCleanup = () => {
  runRetentionCleanup().catch(() => console.error("Daily data retention cleanup failed."));
};

export const scheduleDataRetentionCleanup = () => {
  runScheduledCleanup();
  return setInterval(runScheduledCleanup, ONE_DAY_MS);
};

