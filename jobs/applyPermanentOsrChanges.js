import { applyDuePermanentOsrChanges } from "../utils/permanentOsrChanges.js";

const APPLY_INTERVAL_MS = 15 * 60 * 1000;

export const schedulePermanentOsrApplications = () => {
  applyDuePermanentOsrChanges().catch(() => console.error("Permanent OSR application failed."));
  return setInterval(() => {
    applyDuePermanentOsrChanges().catch(() => console.error("Permanent OSR application failed."));
  }, APPLY_INTERVAL_MS);
};
