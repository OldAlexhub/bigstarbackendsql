import { applyDueReallocations } from "../utils/reallocationRequests.js";

const APPLY_INTERVAL_MS = 15 * 60 * 1000;

export const scheduleReallocationApplications = () => {
  applyDueReallocations().catch(() => console.error("Reallocation application failed."));
  return setInterval(() => {
    applyDueReallocations().catch(() => console.error("Reallocation application failed."));
  }, APPLY_INTERVAL_MS);
};
