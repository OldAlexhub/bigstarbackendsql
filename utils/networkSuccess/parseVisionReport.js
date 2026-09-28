import {
  cellText,
  dateValue,
  findColumn,
  findRow,
  numberValue,
  percentageValue,
  readFirstSheet,
  workbookDateRange,
} from "./reportParsing.js";

export const parseVisionReport = (buffer) => {
  const grid = readFirstSheet(buffer);
  const headerRow = findRow(grid, (row) => row.some((value) => /^Date$/i.test(cellText(value).trim())));
  if (headerRow < 0) throw new Error("This is not a Vision Paratransit Operations report: the Date header was not found.");

  const header = grid[headerRow];
  const dateCol = findColumn(header, [/^Date$/i], "Date");
  const routeCol = findColumn(header, [/^Run\/Route$/i, /^Route$/i, /^Rt$/i], "Run/Route");
  const tripsCol = findColumn(header, [/^Total\s+Prov(?:ided)?$/i], "Total Provided trips");
  const otpCol = findColumn(header, [/^OTP\s*%$/i], "OTP %");
  const serviceHoursCol = findColumn(header, [/^Service$/i], "Service Hours", { preferLast: true });
  const revenueHoursCol = header.reduce((match, value, index) => (
    /^(?:Reven|Revenue|Revenue\s+Hours?|Rev\s+Hours?)$/i.test(cellText(value).trim()) ? index : match
  ), null);
  const productivityCol = findColumn(header, [/^Trips\/\s*SvcHr$/i], "Trips per Service Hour");

  let currentDate = null;
  const rows = [];
  const warnings = [];
  for (let index = headerRow + 1; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const parsedDate = dateValue(row[dateCol]);
    if (parsedDate) currentDate = parsedDate;
    const route = cellText(row[routeCol]).trim();
    if (!route || !currentDate || /total/i.test(route)) continue;
    if (!/[0-9]/.test(route)) continue;

    const trips = numberValue(row[tripsCol]);
    const serviceHours = numberValue(row[serviceHoursCol]);
    const revenueHours = revenueHoursCol === null ? null : numberValue(row[revenueHoursCol]);
    const productivity = numberValue(row[productivityCol]);
    const otpPct = percentageValue(row[otpCol]);
    if (trips === null || serviceHours === null || (trips > 0 && otpPct === null)) {
      warnings.push(`Row ${index + 1}: ${route} on ${currentDate} has an unreadable required metric and was skipped.`);
      continue;
    }
    rows.push({
      id: `vision-${index + 1}`,
      sourceRow: index + 1,
      date: currentDate,
      sourceRoute: route,
      sourceOperator: null,
      completedTrips: trips,
      reportedServiceHours: serviceHours,
      reportedRevenueHours: revenueHours,
      tpsh: productivity,
      otpPct,
      zeroTrips: trips === 0,
      sourceFields: {
        completedTrips: "Vision Total Prov",
        reportedServiceHours: "Vision Service Hours",
        ...(revenueHoursCol === null ? {} : { reportedRevenueHours: "Vision Revenue Hours" }),
        tpsh: "Vision Trips/SvcHr",
        otpPct: "Vision OTP %",
      },
    });
  }

  if (!rows.length) throw new Error("No Vision route rows were found in the workbook.");
  if (revenueHoursCol === null) {
    warnings.push("The Vision report does not contain a Revenue Hours column, so Actual Revenue Hour Fulfillment will be unavailable for these rows.");
  }
  const costCenterText = grid.flat().map(cellText).find((value) => /Cost\s+Center:/i.test(value)) || "";
  const costCenter = costCenterText.match(/Cost\s+Center:\s*([^\n]*?)(?:\s+Id:|$)/i)?.[1]?.trim() || null;
  return { rows, warnings, costCenter, reportRange: workbookDateRange(grid), blockedDates: [] };
};
