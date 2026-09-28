const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const ratePerThousand = (count, trips) => (trips > 0 ? round((count / trips) * 1000) : null);

export const buildCustomerServiceAnalytics = (entries, networkEntries) => {
  const tripsByMonth = new Map();
  for (const entry of networkEntries) {
    const trips = Number(entry.metrics?.completedTrips) || 0;
    const month = entry.date?.slice(0, 7);
    if (month) tripsByMonth.set(month, (tripsByMonth.get(month) || 0) + trips);
  }

  const monthly = entries
    .map((entry) => {
      const complaints = Number(entry.complaints) || 0;
      const compliments = Number(entry.compliments) || 0;
      const trips = tripsByMonth.get(entry.month) || 0;
      return {
        id: String(entry._id),
        month: entry.month,
        complaints,
        compliments,
        trips,
        complaintRatePer1000: ratePerThousand(complaints, trips),
        complimentRatePer1000: ratePerThousand(compliments, trips),
        hasTripData: trips > 0,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  const matched = monthly.filter((month) => month.hasTripData);
  const complaints = monthly.reduce((sum, month) => sum + month.complaints, 0);
  const compliments = monthly.reduce((sum, month) => sum + month.compliments, 0);
  const matchedComplaints = matched.reduce((sum, month) => sum + month.complaints, 0);
  const matchedCompliments = matched.reduce((sum, month) => sum + month.compliments, 0);
  const trips = matched.reduce((sum, month) => sum + month.trips, 0);

  return {
    summary: {
      complaints,
      compliments,
      trips,
      complaintRatePer1000: ratePerThousand(matchedComplaints, trips),
      complimentRatePer1000: ratePerThousand(matchedCompliments, trips),
      reportedMonths: monthly.length,
      matchedMonths: matched.length,
      missingTripMonths: monthly.length - matched.length,
    },
    monthly,
  };
};
