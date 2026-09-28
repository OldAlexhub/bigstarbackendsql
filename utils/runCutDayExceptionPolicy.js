import { isOsrDisruptionType } from "./disruptionTypes.js";

export const exceptionPlanningWindowError = ({
  offset,
  assignmentWasUpdated,
  disruptionType,
  osrAdvanceDays,
}) => {
  if (isOsrDisruptionType(disruptionType)) {
    if (offset < 0 || offset > osrAdvanceDays) {
      return `OSRs can only be processed from today through ${osrAdvanceDays} day${osrAdvanceDays === 1 ? "" : "s"} ahead.`;
    }
    return null;
  }
  if (assignmentWasUpdated && (offset < 0 || offset > 1)) {
    return "Daily assignment changes and additional revenue routes are limited to today and tomorrow.";
  }
  return null;
};

// An OSR describes the workflow, not the operating state. Only an explicit
// status field may change whether the route operates.
export const exceptionStatus = ({ currentStatus, requestedStatus }) =>
  requestedStatus === undefined ? currentStatus : requestedStatus;
