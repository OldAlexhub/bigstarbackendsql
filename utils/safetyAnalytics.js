const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const ratePerHundredThousand = (accidents, miles) =>
  miles > 0 ? round((accidents / miles) * 100000) : null;

export const buildSafetyAnalytics = (entries) => {
  const monthly = entries
    .map((entry) => {
      const miles = Number(entry.miles) || 0;
      const preventableAccidents = Number(entry.preventableAccidents) || 0;
      const nonPreventableAccidents = Number(entry.nonPreventableAccidents) || 0;
      return {
        id: String(entry._id),
        month: entry.month,
        miles,
        preventableAccidents,
        nonPreventableAccidents,
        preventableRatePer100000: ratePerHundredThousand(preventableAccidents, miles),
        nonPreventableRatePer100000: ratePerHundredThousand(nonPreventableAccidents, miles),
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  const miles = monthly.reduce((sum, month) => sum + month.miles, 0);
  const preventableAccidents = monthly.reduce((sum, month) => sum + month.preventableAccidents, 0);
  const nonPreventableAccidents = monthly.reduce((sum, month) => sum + month.nonPreventableAccidents, 0);

  return {
    summary: {
      miles: round(miles),
      preventableAccidents,
      nonPreventableAccidents,
      preventableRatePer100000: ratePerHundredThousand(preventableAccidents, miles),
      nonPreventableRatePer100000: ratePerHundredThousand(nonPreventableAccidents, miles),
      reportedMonths: monthly.length,
      zeroMileMonths: monthly.filter((month) => month.miles === 0).length,
    },
    monthly,
  };
};
