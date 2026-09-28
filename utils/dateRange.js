const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const parseDateOnly = (value, label) => {
  const match = DATE_ONLY_PATTERN.exec(String(value || ""));
  if (!match) return { error: `${label} must be a valid date in YYYY-MM-DD format` };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { error: `${label} must be a valid date in YYYY-MM-DD format` };
  }

  return { date };
};

// Calendar-date filters are inclusive at both ends. Persisted Dates represent
// instants, so representing the upper bound as midnight at the start of the
// following day avoids dropping records on the selected "to" date that carry
// a non-midnight timestamp.
export const parseInclusiveDateRange = (from, to) => {
  const parsedFrom = parseDateOnly(from, "from");
  if (parsedFrom.error) return parsedFrom;

  const parsedTo = parseDateOnly(to, "to");
  if (parsedTo.error) return parsedTo;

  if (parsedFrom.date > parsedTo.date) {
    return { error: "from must be on or before to" };
  }

  const toExclusive = new Date(parsedTo.date);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  return {
    fromInclusive: parsedFrom.date,
    toExclusive,
  };
};
