// New records use the correct Orion terminology. The legacy value remains
// accepted so historical OSRs can still be read, filtered, and saved.
export const OSR_DISRUPTION_TYPE = "OSR (Orion Service Request)";
export const LEGACY_OSR_DISRUPTION_TYPE = "OSR (Out of Service Request)";
export const OSR_DISRUPTION_TYPES = [OSR_DISRUPTION_TYPE, LEGACY_OSR_DISRUPTION_TYPE];
export const isOsrDisruptionType = (value) => OSR_DISRUPTION_TYPES.includes(value);

export const DISRUPTION_TYPES = [
  "Adverse Operational Behavior",
  "Hotline Misuse",
  "Unperformed Duty",
  "Route Closed",
  OSR_DISRUPTION_TYPE,
  LEGACY_OSR_DISRUPTION_TYPE,
  "Late to First",
  "Late to Zone",
  "Incorrect Service Request",
  "Late Service Request Submission",
  "Non-Deployment Issue",
  "Unreported Swap-Operator",
  "Unreported Swap-Vehicle",
  "Vehicle Breakdown",
  "Technical Malfunction",
  "Phone Login",
  "Late Deploy",
];
