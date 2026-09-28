const round = (value, digits = 4) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

const weightedMetric = (components, field) => {
  const eligible = components.filter((row) => row.completedTrips > 0 && Number.isFinite(row[field]));
  const trips = eligible.reduce((sum, row) => sum + row.completedTrips, 0);
  return trips ? round(eligible.reduce((sum, row) => sum + row[field] * row.completedTrips, 0) / trips) : null;
};

export const aggregateResolvedRows = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.date}|${row.routeId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((components) => {
    const positive = components.filter((row) => row.completedTrips > 0);
    const zero = components.filter((row) => row.completedTrips === 0);
    const totalTrips = components.reduce((sum, row) => sum + row.completedTrips, 0);
    const serviceHours = components.map((row) => row.reportedServiceHours).filter(Number.isFinite);
    const revenueHours = components.map((row) => row.reportedRevenueHours).filter(Number.isFinite);
    return {
      date: components[0].date,
      routeId: components[0].routeId,
      routeCode: components[0].routeCode,
      routeType: components[0].routeType,
      sourceRouteCodes: [...new Set(components.map((row) => row.sourceRoute))],
      components,
      metrics: {
        completedTrips: totalTrips,
        reportedServiceHours: serviceHours.length ? round(serviceHours.reduce((a, b) => a + b, 0), 2) : null,
        reportedRevenueHours: revenueHours.length ? round(revenueHours.reduce((a, b) => a + b, 0), 2) : null,
        otpPct: weightedMetric(components, "otpPct"),
        tpsh: weightedMetric(components, "tpsh"),
      },
      zeroTrip: {
        zeroComponentCount: zero.length,
        classification: zero.length === components.length ? "closed_cancelled" : zero.length ? "partially_closed" : "operated",
      },
      hasPositiveComponents: positive.length > 0,
    };
  });
};
