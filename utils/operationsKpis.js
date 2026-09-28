export const KPI_KEYS = [
  "run_cut_fulfillment",
  "core_revenue_fulfillment",
  "otp",
  "go_link_otp",
  "safety_score",
  "preventable_accident_ratio",
  "complaint_ratio",
  "standby_utilization",
  "tpsh",
];

export const KPI_DEFINITIONS = [
  { key: "run_cut_fulfillment", label: "Run Cut Fulfillment", format: "percent" },
  { key: "core_revenue_fulfillment", label: "Core Revenue Fulfillment", format: "percent" },
  { key: "otp", label: "On-Time Performance", format: "percent" },
  { key: "go_link_otp", label: "On-Time Performance (GO LINK)", format: "percent" },
  { key: "safety_score", label: "Safety Score", format: "number" },
  { key: "preventable_accident_ratio", label: "Preventable Accident Ratio", format: "ratio" },
  { key: "complaint_ratio", label: "Customer Complaint Ratio", format: "ratio" },
  { key: "standby_utilization", label: "STBY Utilization", format: "percent" },
  { key: "tpsh", label: "Trips per Service Hour", format: "ratio" },
];

export const KPI_BY_KEY = Object.fromEntries(KPI_DEFINITIONS.map((definition) => [definition.key, definition]));

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isCalendarMonth = (value) => MONTH_PATTERN.test(String(value || ""));

export const currentMonth = (date = new Date()) => date.toISOString().slice(0, 7);

export const monthStart = (month) => new Date(`${month}-01T00:00:00.000Z`);

export const monthEnd = (month) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0, 23, 59, 59, 999));
};

export const lastDayOfMonth = (month) => monthEnd(month).toISOString().slice(0, 10);

export const addMonths = (month, amount) => {
  const date = monthStart(month);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
};

export const monthsBetween = (from, to) => {
  const months = [];
  for (let cursor = from; cursor <= to; cursor = addMonths(cursor, 1)) months.push(cursor);
  return months;
};

export const monthInTimezone = (timezone, now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
};

export const normalizeDivisionCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const workbookTarget = (code, key) => {
  const normalized = normalizeDivisionCode(code);
  if (key === "core_revenue_fulfillment" && ["DIV2", "DIV12"].includes(normalized)) return 0.9;
  if (key === "otp") {
    if (["DIV6", "DIV11"].includes(normalized)) return 0.9;
    if (["DIV3", "DIV5"].includes(normalized)) return 0.92;
    return 0.95;
  }
  if (key === "safety_score" && (normalized.startsWith("DIV3") || normalized === "DIV10")) return 1;
  const targets = {
    run_cut_fulfillment: 0.97,
    core_revenue_fulfillment: 0.95,
    otp: 0.95,
    go_link_otp: 0.98,
    safety_score: 90,
    preventable_accident_ratio: 0.75,
    complaint_ratio: 2,
    standby_utilization: 0.85,
    tpsh: 1.25,
  };
  return targets[key];
};

export const defaultKpiSetting = (division, key) => {
  const normalized = normalizeDivisionCode(division?.code);
  const target = workbookTarget(division?.code, key);
  const lowerIsBetter = key === "preventable_accident_ratio" || key === "complaint_ratio"
    || (key === "safety_score" && target < 10);
  const redCutoff = key === "tpsh"
    ? 1.23
    : ["run_cut_fulfillment", "core_revenue_fulfillment", "otp", "go_link_otp", "standby_utilization"].includes(key)
      ? target - 0.02
      : lowerIsBetter
        ? target * 1.02
        : target * 0.98;
  const goLinkDivision = normalized === "DIV3GL" || normalized.includes("GOLINK");
  return {
    enabled: key === "go_link_otp" ? goLinkDivision : key === "otp" ? !goLinkDivision : true,
    direction: lowerIsBetter ? "lower" : "higher",
    target,
    redCutoff: Math.round(redCutoff * 10000) / 10000,
  };
};

export const baseStatus = (value, setting) => {
  if (!Number.isFinite(value) || !setting?.enabled) return "no_data";
  const { direction, target, redCutoff } = setting;
  if (direction === "lower") {
    if (value <= target) return "green";
    if (value <= redCutoff) return "yellow";
    return "red";
  }
  if (value >= target) return "green";
  if (value >= redCutoff) return "yellow";
  return "red";
};

export const statusWithCritical = (value, setting, previousBaseStatus) => {
  const status = baseStatus(value, setting);
  return status === "red" && previousBaseStatus === "red" ? "critical" : status;
};

export const roundKpi = (value, digits = 6) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
