import { DISRUPTION_TYPES, OSR_DISRUPTION_TYPES } from "./disruptionTypes.js";

const pct = (value) =>
  value == null || !Number.isFinite(Number(value))
    ? ""
    : `${Math.round(Number(value) * 1000) / 10}%`;

const number = (value) =>
  value == null || !Number.isFinite(Number(value))
    ? ""
    : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

const text = (value) => String(value ?? "");

const OPERATION_FIELDS = [
  { key: "code", label: "Division Code", width: 14, format: text },
  { key: "name", label: "Division", width: 24, format: text },
  { key: "runCutFulfillmentPct", label: "Run Cut Fulfillment", width: 20, format: pct },
  { key: "plannedRevenueHourFulfillmentPct", label: "Planned Revenue Fulfillment", width: 26, format: pct },
  { key: "actualRevenueHourFulfillmentPct", label: "Actual Revenue Fulfillment", width: 25, format: pct },
  { key: "actualRevenueHours", label: "Actual Revenue Hours", width: 21, format: number },
  { key: "actualRevenueHoursPlanned", label: "Comparable Planned Hours", width: 25, format: number },
  { key: "actualRevenueComparableRouteDays", label: "Comparable Route Days", width: 23, format: number },
  { key: "revenueHoursScheduled", label: "Revenue Hours Scheduled", width: 24, format: number },
  { key: "revenueHoursCovered", label: "Revenue Hours Covered", width: 22, format: number },
  { key: "revenueHoursAtRisk", label: "Revenue Hours At Risk", width: 22, format: number },
  { key: "totalClosures", label: "Closures", width: 12, format: number },
  { key: "totalLateFirst", label: "Late to First", width: 15, format: number },
  { key: "totalLateDeploy", label: "Late Deploy", width: 15, format: number },
  { key: "unassignedRoutesCount", label: "Unassigned Routes", width: 18, format: number },
  { key: "issueCount", label: "Issues Logged", width: 15, format: number },
];

const ISSUE_FIELDS = [
  { key: "divisionCode", label: "Division Code", width: 14, format: text },
  { key: "divisionName", label: "Division", width: 24, format: text },
  { key: "date", label: "Service Date", width: 14, format: text },
  { key: "routeCode", label: "Route", width: 14, format: text },
  { key: "disruptionType", label: "Issue Type", width: 30, format: text },
  { key: "notes", label: "Notes", width: 52, format: text, pdfWeight: 2.8 },
];

const NETWORK_RAW_FIELDS = [
  { key: "divisionCode", label: "Division Code", width: 14, format: text },
  { key: "divisionName", label: "Division", width: 24, format: text },
  { key: "source", label: "Upload Source", width: 15, format: (value) => String(value || "").toUpperCase() },
  { key: "fileName", label: "Uploaded File", width: 34, format: text, pdfWeight: 1.8 },
  { key: "confirmedAt", label: "Confirmed At", width: 22, format: text },
  { key: "date", label: "Service Date", width: 14, format: text },
  { key: "sourceRow", label: "Source Row", width: 12, format: number },
  { key: "sourceRoute", label: "Source Route", width: 18, format: text },
  { key: "sourceOperator", label: "Source Operator", width: 24, format: text },
  { key: "matchedRoute", label: "Matched Route", width: 18, format: text },
  { key: "matchedOperator", label: "Matched Operator", width: 24, format: text },
  { key: "matchedProvider", label: "Matched Provider", width: 24, format: text },
  { key: "completedTrips", label: "Completed Trips", width: 17, format: number },
  { key: "reportedServiceHours", label: "Reported Service Hours", width: 23, format: number },
  { key: "reportedRevenueHours", label: "Reported Revenue Hours", width: 24, format: number },
  { key: "tpsh", label: "Uploaded TPSH", width: 16, format: number },
  { key: "otpPct", label: "Uploaded OTP", width: 16, format: pct },
  { key: "pickupOtpPct", label: "Pickup OTP", width: 16, format: pct },
  { key: "dropoffOtpPct", label: "Dropoff OTP", width: 16, format: pct },
  { key: "zeroTrips", label: "Zero Trips", width: 12, format: (value) => value ? "Yes" : "No" },
];

export const REPORT_SOURCES = {
  operations: {
    key: "operations",
    label: "Division performance",
    description: "One decision-ready row per division, built from operational fulfillment and exception data.",
    fields: OPERATION_FIELDS,
    defaultFields: [
      "name",
      "runCutFulfillmentPct",
      "actualRevenueHourFulfillmentPct",
      "revenueHoursAtRisk",
      "totalClosures",
      "totalLateFirst",
      "totalLateDeploy",
      "unassignedRoutesCount",
    ],
    defaultSort: "name",
  },
  issues: {
    key: "issues",
    label: "Issues and disruptions",
    description: "A detailed event register for investigation, follow-up, or client-ready records.",
    fields: ISSUE_FIELDS,
    defaultFields: ["divisionName", "date", "routeCode", "disruptionType", "notes"],
    defaultSort: "date",
  },
  network_raw: {
    key: "network_raw",
    label: "Network Success raw performance",
    description: "One row per confirmed source row from Vision, Ecolane, Spare, or RideCo, without rollups, scoring, or analysis.",
    fields: NETWORK_RAW_FIELDS,
    defaultFields: [
      "divisionName",
      "source",
      "date",
      "sourceRoute",
      "matchedOperator",
      "completedTrips",
      "tpsh",
      "otpPct",
    ],
    defaultSort: "date",
  },
};

export const ISSUE_FILTERS = [
  { value: "all", label: "All issue types" },
  { value: "closures", label: "Closures and unperformed duties" },
  { value: "osr", label: "Orion service requests" },
  { value: "late", label: "Late service events" },
  { value: "vehicle", label: "Vehicle and technical issues" },
  ...DISRUPTION_TYPES.map((value) => ({ value, label: value })),
];

const ISSUE_GROUPS = {
  closures: ["Unperformed Duty", "Route Closed"],
  osr: OSR_DISRUPTION_TYPES,
  late: ["Late to First", "Late to Zone", "Late Deploy", "Late Service Request Submission"],
  vehicle: ["Vehicle Breakdown", "Technical Malfunction"],
};

const safeString = (value, maxLength) => String(value || "").trim().slice(0, maxLength);

export const normalizeReportBuilderConfig = (query = {}) => {
  const source = REPORT_SOURCES[query.source] || REPORT_SOURCES.operations;
  const allowedFields = new Set(source.fields.map((field) => field.key));
  const requestedFields = String(query.fields || "")
    .split(",")
    .map((field) => field.trim())
    .filter((field) => allowedFields.has(field));
  const fields = requestedFields.length ? [...new Set(requestedFields)] : source.defaultFields;
  const sort = allowedFields.has(query.sort) ? query.sort : source.defaultSort;
  const issueFilterValues = new Set(ISSUE_FILTERS.map((option) => option.value));

  return {
    source: source.key,
    fields,
    search: safeString(query.search, 120),
    focus: ["all", "attention", "fulfillment", "revenue_risk", "closures"].includes(query.focus)
      ? query.focus
      : "all",
    issueType: issueFilterValues.has(query.issueType) ? query.issueType : "all",
    networkSource: ["all", "vision", "ecolane", "spare", "rideco"].includes(query.networkSource) ? query.networkSource : "all",
    sort,
    direction: query.direction === "desc" ? "desc" : "asc",
    title: safeString(query.title, 80) || (
      source.key === "issues"
        ? "Issue Detail Report"
        : source.key === "network_raw"
          ? "Network Success Raw Performance Data"
          : "Operations Scorecard"
    ),
  };
};

export const rawNetworkRowsFromEntries = (entries = [], divisions = []) => {
  const divisionById = new Map(divisions.map((division) => [String(division._id), division]));
  return entries.flatMap((entry) => {
    const division = divisionById.get(String(entry.division));
    const components = entry.components?.length
      ? entry.components
      : [{
        sourceRow: null,
        sourceRoute: entry.sourceRouteCodes?.join(", ") || "",
        sourceOperator: null,
        ...entry.metrics,
        zeroTrips: Number(entry.metrics?.completedTrips) === 0,
      }];
    const files = entry.submission?.files?.map((file) => file.name).filter(Boolean).join("; ") || "";
    const confirmedAt = entry.submission?.confirmedAt
      ? new Date(entry.submission.confirmedAt).toISOString()
      : "";

    return components.map((component) => ({
      divisionId: String(entry.division),
      divisionCode: division?.code || "",
      divisionName: division?.name || "",
      source: entry.source,
      fileName: files,
      confirmedAt,
      date: entry.date,
      sourceRow: component.sourceRow,
      sourceRoute: component.sourceRoute || "",
      sourceOperator: component.sourceOperator || "",
      matchedRoute: entry.deployment?.canonicalRoute || "",
      matchedOperator: entry.assignmentOverride?.operatorName || entry.deployment?.operatorName || "",
      matchedProvider: entry.assignmentOverride?.providerName || entry.deployment?.providerName || "",
      completedTrips: component.completedTrips,
      reportedServiceHours: component.reportedServiceHours,
      reportedRevenueHours: component.reportedRevenueHours,
      tpsh: component.tpsh,
      otpPct: component.otpPct,
      pickupOtpPct: component.pickupOtpPct,
      dropoffOtpPct: component.dropoffOtpPct,
      zeroTrips: Boolean(component.zeroTrips),
    }));
  });
};

const operationsNeedsAttention = (row) =>
  Number(row.revenueHoursAtRisk) > 0 ||
  Number(row.totalClosures) > 0 ||
  Number(row.totalLateFirst) > 0 ||
  Number(row.totalLateDeploy) > 0 ||
  Number(row.unassignedRoutesCount) > 0;

const filterOperations = (rows, focus) => {
  if (focus === "attention") return rows.filter(operationsNeedsAttention);
  if (focus === "fulfillment") {
    return rows.filter((row) => row.runCutFulfillmentPct != null && row.runCutFulfillmentPct < 0.97);
  }
  if (focus === "revenue_risk") return rows.filter((row) => Number(row.revenueHoursAtRisk) > 0);
  if (focus === "closures") return rows.filter((row) => Number(row.totalClosures) > 0);
  return rows;
};

const filterIssues = (rows, issueType) => {
  if (issueType === "all") return rows;
  const types = ISSUE_GROUPS[issueType] || [issueType];
  return rows.filter((row) => types.includes(row.disruptionType));
};

const searchableValue = (row) => Object.values(row).map((value) => String(value ?? "")).join(" ").toLowerCase();

const comparable = (value) => {
  if (value == null) return "";
  if (typeof value === "number") return value;
  return String(value).toLowerCase();
};

const sortRows = (rows, key, direction) => [...rows].sort((left, right) => {
  const a = comparable(left[key]);
  const b = comparable(right[key]);
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  const result = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true });
  return direction === "desc" ? -result : result;
});

export const buildReportDataset = (report, rawConfig = {}) => {
  const config = normalizeReportBuilderConfig(rawConfig);
  const source = REPORT_SOURCES[config.source];
  const divisionCodeById = new Map(
    (report.divisions || []).map((division) => [String(division.divisionId), division.code])
  );
  let rawRows;
  if (config.source === "issues") {
    rawRows = (report.issues || []).map((issue) => ({
      ...issue,
      divisionCode: divisionCodeById.get(String(issue.divisionId)) || "",
    }));
  } else if (config.source === "network_raw") {
    rawRows = [...(report.networkRows || [])];
  } else {
    rawRows = [...(report.divisions || [])];
  }

  if (config.source === "issues") rawRows = filterIssues(rawRows, config.issueType);
  else if (config.source === "operations") rawRows = filterOperations(rawRows, config.focus);
  else if (config.networkSource !== "all") {
    rawRows = rawRows.filter((row) => row.source === config.networkSource);
  }

  if (config.search) {
    const needle = config.search.toLowerCase();
    rawRows = rawRows.filter((row) => searchableValue(row).includes(needle));
  }

  rawRows = sortRows(rawRows, config.sort, config.direction);
  const fieldsByKey = new Map(source.fields.map((field) => [field.key, field]));
  const columns = config.fields.map((key) => {
    const field = fieldsByKey.get(key);
    return { key, label: field.label, width: field.width, pdfWeight: field.pdfWeight || 1 };
  });
  const rows = rawRows.map((rawRow) => Object.fromEntries(
    config.fields.map((key) => [key, fieldsByKey.get(key).format(rawRow[key])])
  ));

  return {
    config,
    source: { key: source.key, label: source.label, description: source.description },
    columns,
    rows,
    total: rows.length,
    divisionCount: new Set(
      rawRows.map((row) => row.divisionId || row.divisionName || row.name).filter(Boolean)
    ).size,
  };
};

export const reportBuilderMetadata = () => ({
  sources: Object.values(REPORT_SOURCES).map((source) => ({
    key: source.key,
    label: source.label,
    description: source.description,
    fields: source.fields.map(({ key, label }) => ({ key, label })),
    defaultFields: source.defaultFields,
    defaultSort: source.defaultSort,
  })),
  issueFilters: ISSUE_FILTERS,
});
