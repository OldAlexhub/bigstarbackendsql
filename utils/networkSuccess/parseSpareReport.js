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

// Spare's Daily Duty Performance export is a flat one-row-per-route-per-day
// CSV (no repeated date headers to carry forward, no per-row operator, and no
// cost-center hint the way Vision's sheet has). readFirstSheet already parses
// CSV buffers via the same xlsx library used for the .xls/.xlsx sources, so
// this needs no CSV-specific plumbing. Spare also has no explicit TPSH
// column, so it's derived here from the completed-trips and scheduled-hours
// columns it does have, rather than left unavailable.
export const parseSpareReport = (buffer) => {
  const grid = readFirstSheet(buffer);
  const headerRow = findRow(grid, (row) =>
    row.some((value) => /^duty_report__duty_identifier$/i.test(cellText(value).trim()))
  );
  if (headerRow < 0) {
    throw new Error("This is not a Spare Daily Duty Performance report: the duty_report__duty_identifier column was not found.");
  }

  const header = grid[headerRow];
  const routeCol = findColumn(header, [/^duty_report__duty_identifier$/i], "duty identifier (route)");
  const dateCol = findColumn(header, [/^duty_report__start_requested_time_day$/i], "start requested time day (date)");
  const tripsCol = findColumn(header, [/^request__completed_count$/i], "completed count (trips)");
  const revenueHoursCol = findColumn(header, [/^duty_report__total_revenue_hours_sum$/i], "total revenue hours sum");
  const serviceHoursCol = findColumn(header, [/^duty_report__total_scheduled_hours_sum$/i], "total scheduled hours sum");
  const otpCol = findColumn(header, [/^request__relevant_otp_rate$/i], "relevant OTP rate");

  const rows = [];
  const warnings = [];
  for (let index = headerRow + 1; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const route = cellText(row[routeCol]).trim();
    const date = dateValue(row[dateCol]);
    if (!route || !date || /total/i.test(route)) continue;
    if (!/[0-9]/.test(route)) continue;

    const trips = numberValue(row[tripsCol]);
    const serviceHours = numberValue(row[serviceHoursCol]);
    const revenueHours = numberValue(row[revenueHoursCol]);
    const otpPct = percentageValue(row[otpCol]);
    if (trips === null || serviceHours === null || (trips > 0 && otpPct === null)) {
      warnings.push(`Row ${index + 1}: ${route} on ${date} has an unreadable required metric and was skipped.`);
      continue;
    }

    rows.push({
      id: `spare-${index + 1}`,
      sourceRow: index + 1,
      date,
      sourceRoute: route,
      sourceOperator: null,
      completedTrips: trips,
      reportedServiceHours: serviceHours,
      reportedRevenueHours: revenueHours,
      tpsh: serviceHours > 0 ? Math.round((trips / serviceHours) * 100) / 100 : null,
      otpPct,
      zeroTrips: trips === 0,
      sourceFields: {
        completedTrips: "Spare request__completed_count",
        reportedServiceHours: "Spare duty_report__total_scheduled_hours_sum",
        reportedRevenueHours: "Spare duty_report__total_revenue_hours_sum",
        otpPct: "Spare request__relevant_otp_rate",
        tpsh: "Spare request__completed_count ÷ duty_report__total_scheduled_hours_sum",
      },
    });
  }

  if (!rows.length) throw new Error("No Spare route rows were found in the file.");
  return { rows, warnings, costCenter: null, reportRange: workbookDateRange(grid), blockedDates: [] };
};
