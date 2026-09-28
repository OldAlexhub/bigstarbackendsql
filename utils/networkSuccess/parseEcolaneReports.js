import {
  cellText,
  dateValue,
  findColumn,
  normalizePersonName,
  numberValue,
  percentageValue,
  readFirstSheet,
  splitRunAndOperator,
  workbookDateRange,
} from "./reportParsing.js";

const parseDriverPerformance = (buffer) => {
  const grid = readFirstSheet(buffer);
  const result = new Map();
  let headerCount = 0;

  for (let index = 0; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const driverCol = row.findIndex((value) => /^Driver$/i.test(cellText(value).trim()));
    if (driverCol < 0) continue;
    headerCount += 1;
    const ridesCol = findColumn(row, [/^Rides\s+per\s+Hour/i], "Driver Performance rides per hour");
    const otpCol = findColumn(row, [/^OTP\s*\(Trips\)$/i], "Driver Performance trip OTP");
    for (let r = index + 1; r < grid.length; r += 1) {
      const line = grid[r] || [];
      if (line.some((value) => /^Driver$/i.test(cellText(value).trim()))) break;
      const driver = cellText(line[driverCol]).trim();
      if (!driver || /^(Total|Date range:)/i.test(driver)) continue;
      const tpsh = numberValue(line[ridesCol + 2]) ?? numberValue(line[ridesCol]);
      const otpPct = percentageValue(line[otpCol]);
      if (tpsh === null && otpPct === null) continue;
      result.set(normalizePersonName(driver), { driver, tpsh, otpPct });
    }
  }
  if (!headerCount) throw new Error("This is not an Ecolane Driver Performance report: the Driver header was not found.");
  if (!result.size) throw new Error("The Driver Performance report contains no driver metrics.");
  return { byDriver: result, reportRange: workbookDateRange(grid) };
};

const parseProductivity = (buffer) => {
  const grid = readFirstSheet(buffer);
  const rows = [];
  let currentDate = null;
  let header = null;
  let headerCount = 0;

  for (let index = 0; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const runCol = row.findIndex((value) => /^Run$/i.test(cellText(value).trim()));
    const childHeader = grid[index + 1] || [];
    const compCol = childHeader.findIndex((value) => /^Comp$/i.test(cellText(value).trim()));
    if (runCol >= 0 && compCol >= 0) {
      const revenueCol = findColumn(row, [/^Revenue$/i], "Daily Run Productivity revenue time");
      header = { runCol, compCol, revenueCol };
      headerCount += 1;
      continue;
    }
    if (!header) continue;

    const rawRunCell = row[header.runCol];
    const rawRunText = cellText(rawRunCell).trim();
    const possibleDate =
      typeof rawRunCell === "number" || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawRunText)
        ? dateValue(rawRunCell)
        : null;
    if (possibleDate) {
      currentDate = possibleDate;
      continue;
    }
    const label = rawRunText;
    if (!label || !currentDate || !/^BST/i.test(label)) continue;
    const { route, operator } = splitRunAndOperator(label);
    const completedTrips = numberValue(row[header.compCol]);
    const revenueHours = numberValue(row[header.revenueCol]);
    if (completedTrips === null || revenueHours === null) continue;
    rows.push({
      id: `ecolane-${index + 1}`,
      sourceRow: index + 1,
      date: currentDate,
      sourceRoute: route,
      sourceOperator: operator,
      completedTrips,
      reportedServiceHours: null,
      reportedRevenueHours: revenueHours,
      tpsh: null,
      otpPct: null,
      zeroTrips: completedTrips === 0,
      sourceFields: {
        completedTrips: "Ecolane Daily Run Productivity Comp",
        reportedRevenueHours: "Ecolane Daily Run Productivity Revenue time",
      },
    });
  }
  if (!headerCount) throw new Error("This is not an Ecolane Daily Run Productivity report: the Run/Comp headers were not found.");
  if (!rows.length) throw new Error("The Daily Run Productivity report contains no run rows.");
  return { rows, reportRange: workbookDateRange(grid), repeatedHeaders: Math.max(0, headerCount - 1) };
};

export const parseEcolaneReports = (productivityBuffer, driverPerformanceBuffer) => {
  const productivity = parseProductivity(productivityBuffer);
  const performance = parseDriverPerformance(driverPerformanceBuffer);
  const warnings = [];
  const missingByDate = new Map();

  const rows = productivity.rows.map((row) => {
    const withinPerformanceRange =
      (!performance.reportRange.from || row.date >= performance.reportRange.from) &&
      (!performance.reportRange.to || row.date <= performance.reportRange.to);
    const driver = withinPerformanceRange
      ? performance.byDriver.get(normalizePersonName(row.sourceOperator))
      : null;
    if (!driver) {
      if (!missingByDate.has(row.date)) missingByDate.set(row.date, new Set());
      missingByDate.get(row.date).add(
        withinPerformanceRange ? row.sourceOperator || "Unknown operator" : "Driver Performance date range"
      );
      return { ...row, driverPerformanceMatched: false };
    }
    return {
      ...row,
      tpsh: driver.tpsh,
      otpPct: driver.otpPct,
      driverPerformanceMatched: true,
      sourceFields: {
        ...row.sourceFields,
        tpsh: "Ecolane Driver Performance Rides per Hour Act",
        otpPct: "Ecolane Driver Performance OTP (Trips)",
      },
    };
  });

  const blockedDates = [...missingByDate.entries()].map(([date, names]) => ({ date, missingOperators: [...names] }));
  for (const blocked of blockedDates) {
    warnings.push(`${blocked.date} is incomplete because ${blocked.missingOperators.join(", ")} did not match Driver Performance.`);
  }
  if (productivity.repeatedHeaders) {
    warnings.push(`${productivity.repeatedHeaders} repeated Daily Run Productivity header section(s) were handled.`);
  }
  return {
    rows,
    warnings,
    costCenter: null,
    reportRange: productivity.reportRange,
    performanceRange: performance.reportRange,
    blockedDates,
  };
};
