import CorrectiveActionPlan from "../models/CorrectiveActionPlan.js";
import mongoose from "../db/sqlMongoose.js";
import CustomerServiceEntry from "../models/CustomerServiceEntry.js";
import Division from "../models/Division.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import OperationsKpiResult from "../models/OperationsKpiResult.js";
import OperationsKpiSetting from "../models/OperationsKpiSetting.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import SafetyEntry from "../models/SafetyEntry.js";
import SafetyScoreEntry from "../models/SafetyScoreEntry.js";
import Settings from "../models/Settings.js";
import {
  KPI_BY_KEY,
  KPI_DEFINITIONS,
  addMonths,
  baseStatus,
  defaultKpiSetting,
  lastDayOfMonth,
  monthInTimezone,
  monthStart,
  monthsBetween,
  roundKpi,
  statusWithCritical,
} from "./operationsKpis.js";

const id = (value) => String(value?._id || value || "");
const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const ratio = (numerator, denominator, scale = 1) =>
  denominator > 0 ? roundKpi((numerator / denominator) * scale) : null;

const groupByDivisionMonth = (rows, monthFor = (row) => row.month) => {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${id(row.division)}|${monthFor(row)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
};

const oneByDivisionMonth = (rows) => {
  const result = new Map();
  for (const row of rows) result.set(`${id(row.division)}|${row.month}`, row);
  return result;
};

const sourceResult = (value, numerator = null, denominator = null) => ({
  value: roundKpi(value),
  numerator: finite(numerator),
  denominator: finite(denominator),
});

export const calculateMetricValues = ({ runCutDays = [], networkEntries = [], safety, safetyScore, customer, plannedRevenueByRoute = new Map() }) => {
  let dutiesScheduled = 0;
  let dutiesDeployed = 0;
  let standbyAvailable = 0;
  let standbyDeployed = 0;

  for (const day of runCutDays) {
    if (day.route?.type === "standby") {
      if (day.status === "active") {
        standbyAvailable += 1;
        if (day.deployed) standbyDeployed += 1;
      }
      continue;
    }
    if (day.status !== "off") dutiesScheduled += 1;
    if (day.status === "active") dutiesDeployed += 1;
  }

  let revenueActual = 0;
  let revenuePlanned = 0;
  let otpWeighted = 0;
  let otpTrips = 0;
  let tpshTrips = 0;
  let tpshHours = 0;
  let completedTrips = 0;

  for (const entry of networkEntries) {
    const trips = Math.max(0, finite(entry.metrics?.completedTrips) || 0);
    completedTrips += trips;

    const actualRevenue = finite(entry.metrics?.reportedRevenueHours);
    const routePlan = plannedRevenueByRoute.get(id(entry.route));
    const snapshotPlan = finite(entry.deployment?.scheduledRevenueHours);
    const plan = finite(routePlan) ?? snapshotPlan;
    if (actualRevenue !== null && plan !== null) {
      revenueActual += actualRevenue;
      revenuePlanned += plan;
    }

    const otp = finite(entry.metrics?.otpPct);
    if (trips > 0 && otp !== null) {
      otpWeighted += otp * trips;
      otpTrips += trips;
    }

    const reportedHours = finite(entry.metrics?.reportedServiceHours);
    const entryTpsh = finite(entry.metrics?.tpsh);
    const usableHours = reportedHours > 0 ? reportedHours : trips > 0 && entryTpsh > 0 ? trips / entryTpsh : null;
    if (usableHours > 0) {
      tpshTrips += trips;
      tpshHours += usableHours;
    }
  }

  const miles = finite(safety?.miles);
  const preventable = finite(safety?.preventableAccidents);
  const complaints = finite(customer?.complaints);
  const score = finite(safetyScore?.score);

  return {
    run_cut_fulfillment: sourceResult(ratio(dutiesDeployed, dutiesScheduled), dutiesDeployed, dutiesScheduled),
    core_revenue_fulfillment: sourceResult(ratio(revenueActual, revenuePlanned), revenueActual, revenuePlanned),
    otp: sourceResult(ratio(otpWeighted, otpTrips), otpWeighted, otpTrips),
    go_link_otp: sourceResult(ratio(otpWeighted, otpTrips), otpWeighted, otpTrips),
    safety_score: sourceResult(score),
    preventable_accident_ratio: sourceResult(
      miles > 0 && preventable !== null ? ratio(preventable, miles, 100000) : null,
      preventable,
      miles
    ),
    complaint_ratio: sourceResult(
      complaints !== null && completedTrips > 0 ? ratio(complaints, completedTrips, 1000) : null,
      complaints,
      completedTrips
    ),
    standby_utilization: sourceResult(ratio(standbyDeployed, standbyAvailable), standbyDeployed, standbyAvailable),
    tpsh: sourceResult(ratio(tpshTrips, tpshHours), tpshTrips, tpshHours),
  };
};

export const ensureDefaultKpiSettings = async (divisions) => {
  if (!divisions.length) return;
  const operations = [];
  for (const division of divisions) {
    for (const definition of KPI_DEFINITIONS) {
      const defaults = defaultKpiSetting(division, definition.key);
      operations.push({
        updateOne: {
          filter: { division: division._id, kpiKey: definition.key, effectiveMonth: "2000-01" },
          update: { $setOnInsert: { ...defaults, assignedManager: null } },
          upsert: true,
        },
      });
    }
  }
  if (operations.length) await OperationsKpiSetting.bulkWrite(operations, { ordered: false });
};

const settingsLookup = (settings) => {
  const grouped = new Map();
  for (const setting of settings) {
    const key = `${id(setting.division)}|${setting.kpiKey}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(setting);
  }
  for (const rows of grouped.values()) rows.sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  return (divisionId, kpiKey, month) => {
    const rows = grouped.get(`${divisionId}|${kpiKey}`) || [];
    let selected = null;
    for (const row of rows) {
      if (row.effectiveMonth <= month) selected = row;
      else break;
    }
    return selected;
  };
};

const rangeAggregate = (monthly, setting) => {
  const available = monthly.filter((result) => Number.isFinite(result.value));
  if (!available.length || !setting?.enabled) return { value: null, status: "no_data" };
  const withDenominator = available.filter((result) => Number.isFinite(result.denominator) && result.denominator > 0 && Number.isFinite(result.numerator));
  let value;
  if (withDenominator.length === available.length) {
    const numerator = withDenominator.reduce((sum, result) => sum + result.numerator, 0);
    const denominator = withDenominator.reduce((sum, result) => sum + result.denominator, 0);
    const scale = setting.kpiKey === "preventable_accident_ratio" ? 100000 : setting.kpiKey === "complaint_ratio" ? 1000 : 1;
    value = ratio(numerator, denominator, scale);
  } else {
    value = roundKpi(available.reduce((sum, result) => sum + result.value, 0) / available.length);
  }
  return { value, status: baseStatus(value, setting) };
};

const resultSetting = (setting) => ({
  enabled: setting.enabled,
  direction: setting.direction,
  target: setting.target,
  redCutoff: setting.redCutoff,
  effectiveMonth: setting.effectiveMonth,
  assignedManager: setting.assignedManager?._id || setting.assignedManager || null,
});

// A closed month is a CAP candidate once it's Red/Critical, on or after the activation
// month, and not already covered by a prior recovered episode for that same or a later
// month. Used both to surface "CAP needed" on the Tracker/Dashboard (without creating
// anything) and to re-validate a manager's request to open one.
export const findCapTriggerMonth = ({ monthlyResults, activationMonth, latestCap }) => {
  const recoveredMonth = latestCap?.status === "recovered" ? latestCap.recoveryCandidate?.month : null;
  const candidates = (monthlyResults || [])
    .filter((result) => result.closed && result.month >= activationMonth && (!recoveredMonth || result.month > recoveredMonth))
    .filter((result) => result.status === "red" || result.status === "critical")
    .sort((a, b) => a.month.localeCompare(b.month));
  return candidates[0] || null;
};

export const reconcileCapForResult = async (result, activationMonth) => {
  if (!result.closed || result.month < activationMonth) return null;
  const isRed = result.status === "red" || result.status === "critical";
  const active = await CorrectiveActionPlan.findOne({
    division: result.division,
    kpiKey: result.kpiKey,
    activeEpisode: true,
  });

  if (active && result.month < active.latestMonth) return active;

  if (isRed) {
    // Reconciliation only updates a CAP that a manager has already opened. It never
    // auto-creates one for a newly red/critical month; see findCapTriggerMonth / the
    // POST /caps endpoint for the manager-initiated path.
    if (!active) return null;
    const reopening = active.status === "recovery_ready";
    active.latestMonth = result.month;
    active.latestValue = result.value;
    active.latestKpiStatus = result.status;
    if (reopening) {
      active.status = "open";
      active.recoveryCandidate = { month: null, value: null, date: null };
      active.audit.push({ action: "recovery_candidate_revoked", details: { month: result.month, status: result.status } });
    }
    await active.save();
    return active;
  }

  if (!active) return null;
  active.latestMonth = result.month;
  active.latestValue = result.value;
  active.latestKpiStatus = result.status;
  if (result.status === "green") {
    const nextCandidate = { month: result.month, value: result.value, date: new Date(`${lastDayOfMonth(result.month)}T12:00:00.000Z`) };
    const changed = active.status !== "recovery_ready" || active.recoveryCandidate?.month !== result.month;
    active.status = "recovery_ready";
    active.recoveryCandidate = nextCandidate;
    if (changed) active.audit.push({ action: "recovery_detected", details: { month: result.month, value: result.value } });
  } else if (active.status === "recovery_ready") {
    active.status = "open";
    active.recoveryCandidate = { month: null, value: null, date: null };
    active.audit.push({ action: "recovery_candidate_revoked", details: { month: result.month, status: result.status } });
  }
  await active.save();
  return active;
};

export const computeOperationsRange = async ({ divisions, from, to, reconcileCaps = true }) => {
  if (!divisions.length) return { months: monthsBetween(from, to), divisions: [], results: [] };
  await ensureDefaultKpiSettings(divisions);
  const requestedMonths = monthsBetween(from, to);
  const internalFrom = addMonths(from, -1);
  const internalMonths = monthsBetween(internalFrom, to);
  const divisionIds = divisions.map((division) => division._id);
  const fromDate = monthStart(internalFrom);
  const toDate = new Date(`${lastDayOfMonth(to)}T23:59:59.999Z`);

  const [runCutDays, networkEntries, safetyEntries, safetyScores, customerEntries, runCuts, kpiSettings] = await Promise.all([
    RunCutDay.find({ division: { $in: divisionIds }, date: { $gte: fromDate, $lte: toDate } }).populate("route", "type").lean(),
    NetworkKpiEntry.find({ division: { $in: divisionIds }, date: { $gte: `${internalFrom}-01`, $lte: lastDayOfMonth(to) } })
      .select("division date route metrics deployment.scheduledRevenueHours").lean(),
    SafetyEntry.find({ division: { $in: divisionIds }, month: { $gte: internalFrom, $lte: to } }).lean(),
    SafetyScoreEntry.find({ division: { $in: divisionIds }, month: { $gte: internalFrom, $lte: to } }).lean(),
    CustomerServiceEntry.find({ division: { $in: divisionIds }, month: { $gte: internalFrom, $lte: to } }).lean(),
    RunCut.find({ division: { $in: divisionIds } }).select("division route revenueHours").lean(),
    OperationsKpiSetting.find({ division: { $in: divisionIds }, effectiveMonth: { $lte: to } }).lean(),
  ]);

  const runDaysByMonth = groupByDivisionMonth(runCutDays, (row) => new Date(row.date).toISOString().slice(0, 7));
  const networkByMonth = groupByDivisionMonth(networkEntries, (row) => row.date.slice(0, 7));
  const safetyByMonth = oneByDivisionMonth(safetyEntries);
  const scoreByMonth = oneByDivisionMonth(safetyScores);
  const customerByMonth = oneByDivisionMonth(customerEntries);
  const getSetting = settingsLookup(kpiSettings);
  const plannedByDivision = new Map();
  for (const runCut of runCuts) {
    const divisionId = id(runCut.division);
    if (!plannedByDivision.has(divisionId)) plannedByDivision.set(divisionId, new Map());
    if (Number.isFinite(runCut.revenueHours)) plannedByDivision.get(divisionId).set(id(runCut.route), runCut.revenueHours);
  }

  const allResults = [];
  const output = [];
  for (const division of divisions) {
    const divisionId = id(division);
    const previousBaseByKpi = new Map();
    const resultsByKpi = new Map(KPI_DEFINITIONS.map((definition) => [definition.key, []]));
    for (const month of internalMonths) {
      const key = `${divisionId}|${month}`;
      const values = calculateMetricValues({
        runCutDays: runDaysByMonth.get(key) || [],
        networkEntries: networkByMonth.get(key) || [],
        safety: safetyByMonth.get(key),
        safetyScore: scoreByMonth.get(key),
        customer: customerByMonth.get(key),
        plannedRevenueByRoute: plannedByDivision.get(divisionId) || new Map(),
      });
      for (const definition of KPI_DEFINITIONS) {
        const setting = getSetting(divisionId, definition.key, month);
        if (!setting) continue;
        const source = values[definition.key];
        const base = baseStatus(source.value, setting);
        const status = statusWithCritical(source.value, setting, previousBaseByKpi.get(definition.key));
        previousBaseByKpi.set(definition.key, base);
        const result = {
          division: division._id,
          kpiKey: definition.key,
          month,
          value: source.value,
          numerator: source.numerator,
          denominator: source.denominator,
          status,
          baseStatus: base,
          closed: month < monthInTimezone(division.timezone),
          setting: resultSetting(setting),
          recalculatedAt: new Date(),
        };
        allResults.push(result);
        if (month >= from) resultsByKpi.get(definition.key).push(result);
      }
    }

    const kpis = KPI_DEFINITIONS.map((definition) => {
      const monthly = resultsByKpi.get(definition.key);
      const latestSetting = getSetting(divisionId, definition.key, to);
      return {
        ...definition,
        enabled: monthly.some((result) => result.setting.enabled),
        setting: latestSetting ? resultSetting(latestSetting) : null,
        monthly,
        range: latestSetting ? rangeAggregate(monthly, { ...latestSetting, kpiKey: definition.key }) : { value: null, status: "no_data" },
      };
    }).filter((kpi) => kpi.enabled);
    output.push({ division: { id: divisionId, code: division.code, name: division.name, timezone: division.timezone }, kpis });
  }

  if (allResults.length) {
    await OperationsKpiResult.bulkWrite(allResults.map((result) => ({
      updateOne: {
        filter: { division: result.division, kpiKey: result.kpiKey, month: result.month },
        update: { $set: result },
        upsert: true,
      },
    })), { ordered: false });
  }

  if (reconcileCaps) {
    const singleton = await Settings.getSingleton();
    if (!singleton.operationsReportingStartMonth) {
      singleton.operationsReportingStartMonth = new Date().toISOString().slice(0, 7);
      await singleton.save();
    }
    const eligible = allResults
      .filter((result) => result.month >= from && result.closed)
      .sort((a, b) => a.month.localeCompare(b.month));
    for (const result of eligible) await reconcileCapForResult(result, singleton.operationsReportingStartMonth);
  }

  return { months: requestedMonths, divisions: output, results: allResults.filter((result) => result.month >= from) };
};

export const refreshDivisionMonth = async (divisionId, month) => {
  const division = await Division.findById(divisionId);
  if (!division) return;
  await computeOperationsRange({ divisions: [division], from: month, to: month, reconcileCaps: true });
};

export const queueOperationsRefresh = (divisionId, month) => {
  if (!mongoose.isValidObjectId(divisionId) || !month) return;
  setTimeout(() => {
    refreshDivisionMonth(divisionId, month).catch(() => console.error("Operations KPI refresh failed."));
  }, 0);
};

export const queueOperationsRangeRefresh = (divisionId, from) => {
  if (!mongoose.isValidObjectId(divisionId) || !from) return;
  setTimeout(async () => {
    try {
      const division = await Division.findById(divisionId);
      if (!division) return;
      const to = monthInTimezone(division.timezone);
      if (from <= to) await computeOperationsRange({ divisions: [division], from, to, reconcileCaps: true });
    } catch {
      console.error("Operations KPI range refresh failed.");
    }
  }, 0);
};

export const reconcileAllClosedOperationsMonths = async () => {
  const divisions = await Division.find({ active: true });
  if (!divisions.length) return;
  const singleton = await Settings.getSingleton();
  if (!singleton.operationsReportingStartMonth) {
    singleton.operationsReportingStartMonth = new Date().toISOString().slice(0, 7);
    await singleton.save();
  }
  const latestClosedByTimezone = divisions.map((division) => addMonths(monthInTimezone(division.timezone), -1));
  const latest = latestClosedByTimezone.sort().at(-1);
  if (latest < singleton.operationsReportingStartMonth) return;
  await computeOperationsRange({
    divisions,
    from: singleton.operationsReportingStartMonth,
    to: latest,
    reconcileCaps: true,
  });
};

export const kpiDefinition = (key) => KPI_BY_KEY[key] || { key, label: key, format: "number" };
