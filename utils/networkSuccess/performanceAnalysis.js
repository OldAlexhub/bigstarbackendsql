const round = (value, digits = 2) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);

const weighted = (entries, field) => {
  const eligible = entries.filter((entry) => entry.metrics.completedTrips > 0 && Number.isFinite(entry.metrics[field]));
  const trips = eligible.reduce((sum, entry) => sum + entry.metrics.completedTrips, 0);
  return trips
    ? round(eligible.reduce((sum, entry) => sum + entry.metrics[field] * entry.metrics.completedTrips, 0) / trips, 4)
    : null;
};

const assignment = (entry) => entry.performanceAssignment || {
  operatorName: entry.deployment?.operatorName || null,
  providerName: entry.deployment?.providerName || null,
  source: "deployment_snapshot",
};

const summarize = (entries) => ({
  routeDays: entries.length,
  trips: entries.reduce((sum, entry) => sum + (entry.metrics.completedTrips || 0), 0),
  serviceHours: round(entries.reduce((sum, entry) => sum + (entry.metrics.reportedServiceHours || 0), 0)),
  revenueHours: round(entries.reduce((sum, entry) => sum + (entry.metrics.reportedRevenueHours || 0), 0)),
  otpPct: weighted(entries, "otpPct"),
  tpsh: weighted(entries, "tpsh"),
  closed: entries.filter((entry) => entry.zeroTrip.classification === "closed_cancelled").length,
  partiallyClosed: entries.filter((entry) => entry.zeroTrip.classification === "partially_closed").length,
  lateToFirst: entries.reduce((sum, entry) => sum + (entry.deployment.lateToFirst || 0), 0),
  lateDeploy: entries.reduce((sum, entry) => sum + (entry.deployment.lateDeploy || 0), 0),
  lateEventCoverage: entries.filter((entry) => entry.deployment.lateToFirst !== null && entry.deployment.lateDeploy !== null).length,
  incompleteEnrichment: entries.filter(
    (entry) => !entry.deployment?.runCutDay || !assignment(entry).operatorName
  ).length,
  missingOperator: entries.filter((entry) => !assignment(entry).operatorName).length,
});

const groupEntries = (entries, keyFor) => {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyFor(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
};

const assignmentGapKey = (entry) => {
  const current = assignment(entry);
  if (current.operator) return `operator:${current.operator}`;
  return `route:${entry.route?._id || entry.route?.code || entry.deployment?.canonicalRoute || entry._id}`;
};

const buildAssignmentGaps = (entries) =>
  [...groupEntries(
    entries.filter((entry) => !assignment(entry).operatorName),
    assignmentGapKey
  ).values()]
    .map((rows) => {
      const first = rows[0];
      const current = assignment(first);
      const routes = [...new Set(rows.map((entry) => entry.route?.code || entry.deployment?.canonicalRoute).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return {
        id: String(first._id),
        route: routes[0] || "Unknown route",
        routes,
        affectedRouteDays: rows.length,
        operator: current.operatorName || null,
        operatorId: current.operator || null,
        provider: current.providerName || null,
        providerId: current.provider || null,
        missing: "operator",
        assignmentSource: current.source,
      };
    })
    .sort((a, b) => (a.missing === b.missing ? a.route.localeCompare(b.route, undefined, { numeric: true }) : a.missing === "operator" ? -1 : 1));

const buildInsights = (summary, providers) => {
  if (!summary.routeDays) return ["No confirmed Network Success records match these filters."];
  const insights = [];
  if (summary.otpPct !== null) insights.push(`Trip-weighted OTP is ${(summary.otpPct * 100).toFixed(1)}% across ${summary.trips.toLocaleString()} completed trips.`);
  else insights.push("OTP is unavailable for the selected records.");
  const closures = summary.closed + summary.partiallyClosed;
  insights.push(`${closures} of ${summary.routeDays} route-days show full or partial closure activity.`);
  if (summary.lateEventCoverage < summary.routeDays) {
    insights.push(`Late-event coverage is available for ${summary.lateEventCoverage} of ${summary.routeDays} route-days; uncovered values remain excluded from event totals.`);
  } else {
    insights.push(`${summary.lateToFirst + summary.lateDeploy} late-event issue${summary.lateToFirst + summary.lateDeploy === 1 ? "" : "s"} were recorded in Deployment.`);
  }
  const ranked = providers.filter((provider) => provider.otpPct !== null && provider.trips > 0);
  if (ranked.length >= 2) {
    const best = [...ranked].sort((a, b) => b.otpPct - a.otpPct)[0];
    const lowest = [...ranked].sort((a, b) => a.otpPct - b.otpPct)[0];
    insights.push(`${best.provider} has the strongest weighted OTP (${(best.otpPct * 100).toFixed(1)}%); ${lowest.provider} is lowest (${(lowest.otpPct * 100).toFixed(1)}%).`);
  }
  if (summary.missingOperator) insights.push(`${summary.missingOperator} route-day${summary.missingOperator === 1 ? " has" : "s have"} no operator assignment in Master Run Cuts.`);
  return insights;
};

export const buildPerformanceAnalysis = (entries) => {
  const summary = summarize(entries);
  const daily = [...groupEntries(entries, (entry) => entry.date).entries()]
    .map(([date, rows]) => ({ date, ...summarize(rows) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const providers = [...groupEntries(
    entries.filter((entry) => assignment(entry).providerName),
    (entry) => assignment(entry).providerName
  ).entries()]
    .map(([provider, rows]) => ({ provider, ...summarize(rows) }))
    .sort((a, b) => b.trips - a.trips || a.provider.localeCompare(b.provider));
  const attention = entries
    .map((entry) => {
      const reasons = [];
      if (entry.zeroTrip.deploymentConflict) reasons.push("Active Deployment conflict");
      if (entry.zeroTrip.classification === "closed_cancelled") reasons.push("Closed/cancelled");
      if (entry.zeroTrip.classification === "partially_closed") reasons.push("Partially closed");
      if (Number.isFinite(entry.metrics.otpPct) && entry.metrics.otpPct < 0.85) reasons.push("OTP below 85%");
      const late = (entry.deployment.lateToFirst || 0) + (entry.deployment.lateDeploy || 0);
      if (late) reasons.push(`${late} late event${late === 1 ? "" : "s"}`);
      if (!entry.deployment?.runCutDay) reasons.push("No dated Deployment enrichment");
      return {
        id: String(entry._id),
        date: entry.date,
        route: entry.route?.code || entry.deployment.canonicalRoute,
        source: entry.source,
        operator: assignment(entry).operatorName || "Unassigned",
        provider: assignment(entry).providerName || "Unassigned",
        assignmentSource: assignment(entry).source,
        hasAssignmentOverride: assignment(entry).source === "manual_override",
        trips: entry.metrics.completedTrips,
        otpPct: entry.metrics.otpPct,
        tpsh: entry.metrics.tpsh,
        outcome: entry.operationalOutcome,
        reasons,
        severity: entry.zeroTrip.deploymentConflict || entry.zeroTrip.classification === "closed_cancelled" ? "blocker" : reasons.length ? "warning" : "clean",
      };
    })
    .filter((entry) => entry.reasons.length)
    .sort(
      (a, b) =>
        ({ blocker: 0, warning: 1 }[a.severity] - { blocker: 0, warning: 1 }[b.severity]) ||
        a.date.localeCompare(b.date)
    );

  const records = entries.map((entry) => ({
    id: String(entry._id),
    date: entry.date,
    route: entry.route?.code || entry.deployment?.canonicalRoute,
    routeId: entry.route?._id ? String(entry.route._id) : null,
    source: entry.source,
    trips: entry.metrics.completedTrips,
    otpPct: entry.metrics.otpPct,
    tpsh: entry.metrics.tpsh,
    outcome: entry.operationalOutcome,
    operator: assignment(entry).operatorName || null,
    operatorId: assignment(entry).operator || null,
    provider: assignment(entry).providerName || null,
    providerId: assignment(entry).provider || null,
    assignmentSource: assignment(entry).source,
    hasAssignmentOverride: assignment(entry).source === "manual_override",
  }));

  return {
    summary,
    daily,
    providers,
    records,
    attention,
    assignmentGaps: buildAssignmentGaps(entries),
    hasProviderData: providers.length > 0,
    insights: buildInsights(summary, providers),
  };
};
