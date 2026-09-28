import { reconcileAllClosedOperationsMonths } from "../utils/operationsReporting.js";

export const scheduleOperationsReconciliation = () => {
  reconcileAllClosedOperationsMonths().catch(() => console.error("Operations reconciliation failed."));
  return setInterval(() => {
    reconcileAllClosedOperationsMonths().catch(() => console.error("Operations reconciliation failed."));
  }, 24 * 60 * 60 * 1000);
};
