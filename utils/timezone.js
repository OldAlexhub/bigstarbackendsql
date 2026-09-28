// Every division operates in a real US timezone, all behind UTC — reading
// "today" straight off UTC calendar fields makes the app show tomorrow's
// date starting in the late afternoon/evening, division-local. This is the
// one place "today" gets computed correctly, in a specific division's local
// time, using the platform's built-in Intl (DST-aware, no dependency).
export const DEFAULT_TIMEZONE = "America/New_York";

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

// Returns a UTC-midnight Date representing the calendar day it currently is
// in `timezone` — the same shape every existing "today" consumer already
// expects (RunCutDay storage/queries, addDays, startOfWeek), so nothing
// downstream of a correctly-computed reference date needs to change.
export const todayInTimezone = (timezone = DEFAULT_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
};
