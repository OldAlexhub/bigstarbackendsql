import {
  cellText,
  dateValue,
  findColumn,
  findRow,
  normalizePersonName,
  numberValue,
  percentageValue,
  readFirstSheet,
  readNamedSheet,
} from "./reportParsing.js";

const keyFor = (date, route) => `${date}|${cellText(route).trim().toUpperCase()}`;

const reportRange = (rows) => {
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  return { from: dates[0] || null, to: dates.at(-1) || null };
};

const parseShiftHours = (buffer) => {
  const grid = readFirstSheet(buffer);
  const headerRow = findRow(grid, (row) => {
    const labels = new Set(row.map((value) => cellText(value).trim().toLowerCase()));
    return labels.has("date") && labels.has("shift") && labels.has("total online hours") && labels.has("vehicle revenue hours");
  });
  if (headerRow < 0) {
    throw new Error("This is not a RideCo Shift Hours Mileage report: the Date, Shift, Total Online Hours, and Vehicle Revenue Hours columns were not found.");
  }

  const header = grid[headerRow];
  const programCol = findColumn(header, [/^Program$/i], "Program");
  const dateCol = findColumn(header, [/^Date$/i], "Date");
  const routeCol = findColumn(header, [/^Shift$/i], "Shift");
  const operatorCol = findColumn(header, [/^Full Name$/i, /^Driver$/i], "driver name");
  const serviceHoursCol = findColumn(header, [/^Total Online Hours$/i], "Total Online Hours");
  const revenueHoursCol = findColumn(header, [/^Vehicle Revenue Hours$/i], "Vehicle Revenue Hours");

  let currentProgram = null;
  let currentDate = null;
  const rows = [];
  for (let index = headerRow + 1; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const program = cellText(row[programCol]).trim();
    const date = dateValue(row[dateCol]);
    if (program) currentProgram = program;
    if (date) currentDate = date;
    const sourceRoute = cellText(row[routeCol]).trim();
    if (!sourceRoute || !currentDate || /^total$/i.test(sourceRoute)) continue;
    rows.push({
      sourceRow: index + 1,
      date: currentDate,
      sourceRoute,
      sourceOperator: cellText(row[operatorCol]).trim() || null,
      reportedServiceHours: numberValue(row[serviceHoursCol]),
      reportedRevenueHours: numberValue(row[revenueHoursCol]),
      program: currentProgram,
    });
  }
  if (!rows.length) throw new Error("The RideCo Shift Hours Mileage report contains no shift rows.");
  return rows;
};

const combinedOtp = (pickupOtpPct, dropoffOtpPct) => {
  const available = [pickupOtpPct, dropoffOtpPct].filter(Number.isFinite);
  if (!available.length) return null;
  return available.reduce((sum, value) => sum + value, 0) / available.length;
};

export const parseRideCoReports = (shiftHoursBuffer, otpBuffer) => {
  const hoursRows = parseShiftHours(shiftHoursBuffer);
  const grid = readNamedSheet(otpBuffer, ["By Shifts", "By Shift"], "RideCo By Shifts");
  const headerRow = findRow(grid, (row) => {
    const labels = new Set(row.map((value) => cellText(value).trim().toLowerCase()));
    return labels.has("agenda day") && labels.has("shift label") && labels.has("completed rides");
  });
  if (headerRow < 0) {
    throw new Error("This is not a RideCo OTP report: the By Shifts headers were not found.");
  }

  const header = grid[headerRow];
  const providerCol = findColumn(header, [/^Provider$/i], "Provider");
  const dateCol = findColumn(header, [/^Agenda Day$/i], "Agenda Day");
  const routeCol = findColumn(header, [/^Shift Label$/i], "Shift Label");
  const pickupOtpCol = findColumn(header, [/^Pickup OTP \(%\)$/i], "Pickup OTP (%)");
  const dropoffOtpCol = findColumn(header, [/^Dropoff OTP \(%\)$/i], "Dropoff OTP (%)");
  const tripsCol = findColumn(header, [/^Completed Rides$/i], "Completed Rides");
  const operatorCol = findColumn(header, [/^Driver Name$/i], "Driver Name");

  const hoursByRouteDay = new Map();
  for (const row of hoursRows) {
    const key = keyFor(row.date, row.sourceRoute);
    if (!hoursByRouteDay.has(key)) hoursByRouteDay.set(key, []);
    hoursByRouteDay.get(key).push(row);
  }

  let currentProvider = null;
  let currentDate = null;
  let unmatchedHours = 0;
  let ambiguousHours = 0;
  const usedHoursRows = new Set();
  const warnings = [];
  const rows = [];
  for (let index = headerRow + 1; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const provider = cellText(row[providerCol]).trim();
    const date = dateValue(row[dateCol]);
    if (provider) currentProvider = provider;
    if (date) currentDate = date;
    const sourceRoute = cellText(row[routeCol]).trim();
    if (!sourceRoute || !currentDate || /^total$/i.test(sourceRoute)) continue;

    const completedTrips = numberValue(row[tripsCol]);
    if (completedTrips === null) {
      warnings.push(`OTP row ${index + 1}: ${sourceRoute} on ${currentDate} has an unreadable Completed Rides value and was skipped.`);
      continue;
    }

    const sourceOperator = cellText(row[operatorCol]).trim() || null;
    const candidates = hoursByRouteDay.get(keyFor(currentDate, sourceRoute)) || [];
    const operatorKey = normalizePersonName(sourceOperator);
    const operatorMatches = operatorKey
      ? candidates.filter((candidate) => normalizePersonName(candidate.sourceOperator) === operatorKey)
      : [];
    let hours = null;
    if (operatorMatches.length === 1) hours = operatorMatches[0];
    else if (!operatorMatches.length && candidates.length === 1) hours = candidates[0];
    else if (operatorMatches.length > 1 || candidates.length > 1) ambiguousHours += 1;
    else unmatchedHours += 1;
    if (hours) usedHoursRows.add(hours.sourceRow);

    const pickupOtpPct = percentageValue(row[pickupOtpCol]);
    const dropoffOtpPct = percentageValue(row[dropoffOtpCol]);
    const tpsh = hours?.reportedServiceHours > 0
      ? Math.round((completedTrips / hours.reportedServiceHours) * 100) / 100
      : null;
    const otpPct = combinedOtp(pickupOtpPct, dropoffOtpPct);
    if (completedTrips > 0 && tpsh === null) {
      warnings.push(`OTP row ${index + 1}: ${sourceRoute} on ${currentDate} has no matched positive Total Online Hours value, so TPSH is unavailable.`);
    }
    if (completedTrips > 0 && otpPct === null) {
      warnings.push(`OTP row ${index + 1}: ${sourceRoute} on ${currentDate} has no readable pickup or dropoff OTP value.`);
    }

    rows.push({
      id: `rideco-${index + 1}`,
      sourceRow: index + 1,
      date: currentDate,
      sourceRoute,
      sourceOperator: sourceOperator || hours?.sourceOperator || null,
      completedTrips,
      reportedServiceHours: hours?.reportedServiceHours ?? null,
      reportedRevenueHours: hours?.reportedRevenueHours ?? null,
      tpsh,
      otpPct,
      pickupOtpPct,
      dropoffOtpPct,
      zeroTrips: completedTrips === 0,
      sourceFields: {
        completedTrips: "RideCo OTP Report By Shifts Completed Rides",
        reportedServiceHours: "RideCo Shift Hours Mileage Total Online Hours",
        reportedRevenueHours: "RideCo Shift Hours Mileage Vehicle Revenue Hours",
        tpsh: "RideCo Completed Rides / Shift Hours Mileage Total Online Hours",
        otpPct: "Mean of RideCo By Shifts Pickup OTP (%) and Dropoff OTP (%)",
        pickupOtpPct: "RideCo OTP Report By Shifts Pickup OTP (%)",
        dropoffOtpPct: "RideCo OTP Report By Shifts Dropoff OTP (%)",
      },
    });
  }

  if (!rows.length) throw new Error("The RideCo OTP report contains no shift rows.");
  if (unmatchedHours) {
    warnings.push(`${unmatchedHours} RideCo OTP shift row(s) did not match a Shift Hours Mileage row; reported hours remain unavailable.`);
  }
  if (ambiguousHours) {
    warnings.push(`${ambiguousHours} RideCo OTP shift row(s) matched multiple Shift Hours Mileage rows; reported hours remain unavailable.`);
  }
  const unusedHours = hoursRows.filter((row) => !usedHoursRows.has(row.sourceRow)).length;
  if (unusedHours) {
    warnings.push(`${unusedHours} Shift Hours Mileage row(s) had no matching OTP shift row and were not imported.`);
  }

  return {
    rows,
    warnings,
    costCenter: currentProvider || hoursRows.find((row) => row.program)?.program || null,
    reportRange: reportRange(rows),
    blockedDates: [],
  };
};
