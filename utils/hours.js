export const DAYS_OF_WEEK = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const RUN_CUT_STATUSES = ["active", "unassigned", "suspended", "off", "add_rte"];
export const NON_OPERATING_RUN_CUT_STATUSES = ["unassigned", "suspended", "off"];
export const isOperatingAssignmentStatus = (status) => !NON_OPERATING_RUN_CUT_STATUSES.includes(status);

const round2 = (n) => Math.round(n * 100) / 100;

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const computeHours = ({ startTime, endTime, status, breakMinutes, revenueRatio }) => {
  if (status === "off" || !startTime || !endTime) {
    return { serviceHours: 0, revenueHours: 0 };
  }

  let minutes = toMinutes(endTime) - toMinutes(startTime);
  if (minutes <= 0) minutes += 24 * 60;
  minutes -= breakMinutes;

  const serviceHours = Math.max(minutes, 0) / 60;
  const revenueHours = serviceHours * revenueRatio;

  return { serviceHours: round2(serviceHours), revenueHours: round2(revenueHours) };
};

export const isCovered = (status) => status === "active" || status === "add_rte";
