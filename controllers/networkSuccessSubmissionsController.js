import crypto from "crypto";
import Division from "../models/Division.js";
import Route from "../models/Route.js";
import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import Operator from "../models/Operator.js";
import Provider from "../models/Provider.js";
import { queueOperationsRefresh } from "../utils/operationsReporting.js";
import RunCut from "../models/RunCut.js";
import NetworkSubmission from "../models/NetworkSubmission.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";
import NetworkRouteAlias from "../models/NetworkRouteAlias.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { parseVisionReport } from "../utils/networkSuccess/parseVisionReport.js";
import { parseEcolaneReports } from "../utils/networkSuccess/parseEcolaneReports.js";
import { parseSpareReport } from "../utils/networkSuccess/parseSpareReport.js";
import { parseRideCoReports } from "../utils/networkSuccess/parseRideCoReports.js";
import { aggregateResolvedRows } from "../utils/networkSuccess/aggregateRows.js";
import {
  divisionMatchScores,
  normalizeRouteCode,
  resolveRoute,
} from "../utils/networkSuccess/routeMatching.js";
import { normalizePersonName } from "../utils/networkSuccess/reportParsing.js";
import { resolveRoute as resolveOrCreateRouteByCode } from "../utils/resolveAssignment.js";
import { planReplacement } from "../utils/networkSuccess/replacementPlan.js";
import { buildPerformanceAnalysis } from "../utils/networkSuccess/performanceAnalysis.js";
import { runInTransaction } from "../utils/transaction.js";
import { httpError, respondToHttpError } from "../utils/httpError.js";

const issueRank = { blocker: 0, warning: 1, extra: 2, clean: 3 };
const fileMetadata = (file, kind) => ({
  kind,
  name: file.originalname,
  size: file.size,
  sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
});
const id = (value) => (value === null || value === undefined ? null : String(value._id || value));
const isoDate = (value) => new Date(value).toISOString().slice(0, 10);
const dateObject = (date) => new Date(`${date}T00:00:00.000Z`);

const submissionJson = (submission) => ({
  id: String(submission._id),
  source: submission.source,
  status: submission.status,
  files: submission.files,
  division: submission.division,
  divisionCandidates: submission.divisionCandidates,
  reportDates: submission.reportDates,
  blockedDates: submission.blockedDates,
  warnings: submission.warnings,
  counts: submission.counts,
  confirmedAt: submission.confirmedAt,
  reopenedFrom: submission.reopenedFrom,
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt,
  createdBy: submission.createdBy,
  confirmedBy: submission.confirmedBy,
});

const ensureSubmissionAccess = (req, submission) => {
  if (!submission) return { status: 404, message: "Submission not found" };
  if (req.user.role === "ELT") return null;
  if (submission.division && canAccessDivision(req.user, submission.division)) return null;
  if (String(submission.createdBy) === String(req.user._id)) return null;
  return { status: 403, message: "No access to this submission" };
};

const buildEnrichmentContext = async (division, rows) => {
  const dates = [...new Set(rows.map((row) => row.date))];
  const routeIds = [...new Set(rows.map((row) => String(row.routeId)).filter(Boolean))];
  if (!dates.length || !routeIds.length) return { runDays: new Map(), issues: new Map(), operators: [] };
  const dateValues = dates.map(dateObject);
  const [runCutDays, issues, operators, runCuts] = await Promise.all([
    RunCutDay.find({ division, route: { $in: routeIds }, date: { $in: dateValues } })
      .populate({ path: "operator", select: "name employeeId provider", populate: { path: "provider", select: "name" } })
      .lean(),
    DailyIssueLog.find({ division, route: { $in: routeIds }, date: { $in: dateValues } }).lean(),
    Operator.find({ division, active: true }).populate("provider", "name").lean(),
    RunCut.find({ division, route: { $in: routeIds } })
      .populate({ path: "operator", select: "name employeeId provider", populate: { path: "provider", select: "name" } })
      .lean(),
  ]);
  return {
    runDays: new Map(runCutDays.map((day) => [`${isoDate(day.date)}|${id(day.route)}`, day])),
    issues: issues.reduce((map, issue) => {
      const key = `${isoDate(issue.date)}|${id(issue.route)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(issue);
      return map;
    }, new Map()),
    operators,
    runCuts: new Map(runCuts.map((runCut) => [id(runCut.route), runCut])),
  };
};

const directoryOperator = (components, operators) => {
  for (const component of components) {
    if (!component.sourceOperator) continue;
    const key = normalizePersonName(component.sourceOperator);
    const match = operators.find((operator) => normalizePersonName(operator.name) === key);
    if (match) return match;
  }
  return null;
};

const specificClosureReason = (runDay, issues) => {
  if (runDay?.disruptionType) return runDay.disruptionType;
  if (runDay?.status === "suspended") return "Suspended";
  if (runDay?.status === "off") return "Off";
  if (["closed_suspended", "reallocated"].includes(runDay?.disposition)) return runDay.disposition;
  return issues.find((issue) => issue.disruptionType === "Route Closed")?.disruptionType || null;
};

export const enrichGroup = (group, context) => {
  const key = `${group.date}|${group.routeId}`;
  const runDay = context.runDays.get(key) || null;
  const issues = context.issues.get(key) || [];
  const masterRunCut = context.runCuts?.get(String(group.routeId)) || null;
  const fallbackOperator = directoryOperator(group.components, context.operators);
  const operator = masterRunCut?.operator || runDay?.operator || fallbackOperator || null;
  const provider = operator?.provider || null;
  const lateToFirst = runDay ? issues.filter((issue) => issue.disruptionType === "Late to First").length : null;
  const lateDeploy = runDay ? issues.filter((issue) => issue.disruptionType === "Late Deploy").length : null;
  const zeroClassification = group.zeroTrip.classification;
  const deploymentConflict =
    zeroClassification !== "operated" && runDay?.status === "active" && runDay?.disposition !== "closed_suspended";
  const closureReason = specificClosureReason(runDay, issues);
  const operationalOutcome =
    zeroClassification === "closed_cancelled"
      ? closureReason || "Closed/cancelled — unverified"
      : zeroClassification === "partially_closed"
        ? "Partially closed"
        : runDay?.disposition || (runDay?.status === "active" ? "Operated" : runDay?.status || "Operated");
  const warning = !runDay
    ? masterRunCut
      ? "No dated Deployment record; scheduled hours use the Master Run Cuts standing value, and late-event values remain blank."
      : "No dated Deployment record; unavailable scheduled and late-event values remain blank."
    : null;
  const assignmentWarning = !operator
    ? "Master Run Cuts has no operator assigned to this route."
    : null;
  const components = group.components.map((component) => ({
    ...component,
    operationalOutcome: component.zeroTrips
      ? closureReason || "Closed/cancelled — unverified"
      : runDay?.disposition || (runDay?.status === "active" ? "Operated" : runDay?.status || "Operated"),
  }));

  return {
    ...group,
    components,
    operationalOutcome,
    zeroTrip: { ...group.zeroTrip, deploymentConflict },
    deployment: {
      runCutDay: id(runDay),
      canonicalRoute: group.routeCode,
      routeType: group.routeType || null,
      operator: id(operator),
      operatorName: operator?.name || group.components.find((row) => row.sourceOperator)?.sourceOperator || null,
      provider: id(provider),
      providerName: provider?.name || null,
      scheduledServiceHours: runDay?.serviceHours ?? masterRunCut?.serviceHours ?? null,
      scheduledRevenueHours: runDay?.revenueHours ?? masterRunCut?.revenueHours ?? null,
      status: runDay?.status ?? null,
      disposition: runDay?.disposition ?? null,
      lateToFirst,
      lateDeploy,
      provenance: {
        metrics: "uploaded",
        route: "route_directory",
        operator: masterRunCut?.operator
          ? "master_run_cuts"
          : runDay?.operator
            ? "deployment"
            : fallbackOperator
              ? "operator_directory"
              : "unavailable",
        provider: masterRunCut?.operator?.provider
          ? "master_run_cuts"
          : provider
            ? "operator_directory"
            : "unavailable",
        scheduledHours: runDay ? "deployment" : masterRunCut ? "master_run_cuts" : "unavailable",
        status: runDay ? "deployment" : "unavailable",
        disposition: runDay ? "deployment" : "unavailable",
        lateEvents: runDay ? "deployment_issue_log" : "unavailable",
      },
      warning,
      assignmentWarning,
    },
  };
};

const previewRow = (row, routeResult, blocked, enrichment) => {
  const isExtraRevenueRoute = routeResult.method === "extra_revenue_route";
  const blocker = blocked || !routeResult.route;
  const warning =
    !blocker &&
    !isExtraRevenueRoute &&
    (enrichment?.deployment.warning ||
      enrichment?.zeroTrip.deploymentConflict ||
      row.zeroTrips ||
      routeResult.method === "safe_letter_difference");
  return {
    ...row,
    matchedRouteId: routeResult.route ? id(routeResult.route) : null,
    matchedRoute: routeResult.route?.code || null,
    routeType: routeResult.route?.type || null,
    matchMethod: routeResult.method,
    matchReason:
      routeResult.method === "normalized_exact"
        ? "Normalized exact match"
        : routeResult.method === "confirmed_alias"
          ? "Previously confirmed alias"
          : routeResult.method === "safe_letter_difference"
            ? "Unique letter insertion/deletion with unchanged digits"
            : routeResult.method === "ambiguous"
              ? "Multiple safe candidates; review required"
              : routeResult.method === "suggestion_only"
                ? "Close candidates are suggestions only"
                : isExtraRevenueRoute
                  ? "No existing route matched; added as a one-off extra revenue route"
                  : "No safe route match",
    suggestions: routeResult.suggestions || [],
    blockedDate: blocked,
    severity: blocker ? "blocker" : isExtraRevenueRoute ? "extra" : warning ? "warning" : "clean",
    operatorName: enrichment?.deployment.operatorName || row.sourceOperator || null,
    providerName: enrichment?.deployment.providerName || null,
    operationalOutcome: enrichment?.operationalOutcome || (row.zeroTrips ? "Closed/cancelled — unverified" : "Awaiting route match"),
    deployment: enrichment?.deployment || null,
    deploymentConflict: Boolean(enrichment?.zeroTrip.deploymentConflict),
  };
};

export const preprocessSubmission = async (req, res) => {
  const source = String(req.body.source || "").toLowerCase();
  if (!["vision", "ecolane", "spare", "rideco"].includes(source)) {
    return res.status(400).json({ message: "Choose Vision, Ecolane, Spare, or RideCo." });
  }
  const visionFile = req.files?.vision?.[0];
  const productivityFile = req.files?.productivity?.[0];
  const driverFile = req.files?.driverPerformance?.[0];
  const spareFile = req.files?.spare?.[0];
  const ridecoHoursFile = req.files?.ridecoHours?.[0];
  const ridecoOtpFile = req.files?.ridecoOtp?.[0];
  if (source === "vision" && !visionFile) return res.status(400).json({ message: "Upload one Vision workbook." });
  if (source === "vision" && (productivityFile || driverFile || spareFile || ridecoHoursFile || ridecoOtpFile)) {
    return res.status(400).json({ message: "Vision submissions accept only the Paratransit Operations workbook." });
  }
  if (source === "ecolane" && (!productivityFile || !driverFile)) {
    return res.status(400).json({ message: "Upload both Daily Run Productivity and Driver Performance workbooks." });
  }
  if (source === "ecolane" && (visionFile || spareFile || ridecoHoursFile || ridecoOtpFile)) {
    return res.status(400).json({ message: "Ecolane submissions accept only the two required Ecolane workbooks." });
  }
  if (source === "spare" && !spareFile) return res.status(400).json({ message: "Upload one Spare Daily Duty Performance file." });
  if (source === "spare" && (visionFile || productivityFile || driverFile || ridecoHoursFile || ridecoOtpFile)) {
    return res.status(400).json({ message: "Spare submissions accept only the Daily Duty Performance file." });
  }
  if (source === "rideco" && (!ridecoHoursFile || !ridecoOtpFile)) {
    return res.status(400).json({ message: "Upload both Shift Hours Mileage and OTP Report workbooks." });
  }
  if (source === "rideco" && (visionFile || productivityFile || driverFile || spareFile)) {
    return res.status(400).json({ message: "RideCo submissions accept only the two required RideCo workbooks." });
  }

  let parsed;
  try {
    if (source === "vision") parsed = parseVisionReport(visionFile.buffer);
    else if (source === "ecolane") parsed = parseEcolaneReports(productivityFile.buffer, driverFile.buffer);
    else if (source === "spare") parsed = parseSpareReport(spareFile.buffer);
    else parsed = parseRideCoReports(ridecoHoursFile.buffer, ridecoOtpFile.buffer);
  } catch (error) {
    return res.status(400).json({ message: error.message || "The workbook could not be parsed." });
  }

  const divisions = await Division.find({ ...divisionFilter(req.user), active: true }).sort({ code: 1 }).lean();
  const routes = await Route.find({ division: { $in: divisions.map((division) => division._id) }, active: true }).lean();
  const candidates = divisionMatchScores(parsed.rows, divisions, routes, parsed.costCenter);
  let files;
  if (source === "vision") files = [fileMetadata(visionFile, "vision")];
  else if (source === "ecolane") files = [fileMetadata(productivityFile, "productivity"), fileMetadata(driverFile, "driverPerformance")];
  else if (source === "spare") files = [fileMetadata(spareFile, "spare")];
  else files = [fileMetadata(ridecoHoursFile, "ridecoHours"), fileMetadata(ridecoOtpFile, "ridecoOtp")];
  const reportDates = [...new Set(parsed.rows.map((row) => row.date))].sort();
  const submission = await NetworkSubmission.create({
    source,
    status: "pending",
    files,
    divisionCandidates: candidates,
    parsedRows: parsed.rows,
    blockedDates: parsed.blockedDates,
    reportDates,
    warnings: parsed.warnings,
    createdBy: req.user._id,
    counts: {
      sourceRows: parsed.rows.length,
      zeroTripRows: parsed.rows.filter((row) => row.zeroTrips).length,
    },
  });
  res.status(201).json({ submission: submissionJson(submission) });
};

export const previewSubmission = async (req, res) => {
  const submission = await NetworkSubmission.findById(req.params.id);
  const accessError = ensureSubmissionAccess(req, submission);
  if (accessError) return res.status(accessError.status).json({ message: accessError.message });
  if (submission.status === "confirmed") return res.status(409).json({ message: "This submission is already confirmed." });
  const { division } = req.body;
  if (!division) return res.status(400).json({ message: "Confirm a division before matching." });
  if (!canAccessDivision(req.user, division)) return res.status(403).json({ message: "No access to this division" });

  const [routes, aliases] = await Promise.all([
    Route.find({ division, active: true }).sort({ code: 1 }).lean(),
    NetworkRouteAlias.find({ division, source: submission.source }).lean(),
  ]);
  const preliminary = submission.parsedRows.map((row) => ({ row, result: resolveRoute(row.sourceRoute, routes, aliases) }));

  // Spare has no persistent route roster of its own to match against, so a
  // route it reports that BigStar doesn't already recognize is most likely a
  // genuine one-off run — the same idea as Live Schedule's Add Revenue
  // Route — not a data-entry mismatch. Create it automatically instead of
  // blocking the reviewer to manually map or exclude it. An "ambiguous"
  // result is left alone either way: a matching route likely does exist,
  // just unclear which one, so that genuinely needs a human to pick.
  // Vision/Ecolane keep the existing manual-review requirement unchanged.
  if (submission.source === "spare") {
    for (const entry of preliminary) {
      if (entry.result.route || !["unmatched", "suggestion_only"].includes(entry.result.method)) continue;
      const created = await resolveOrCreateRouteByCode(division, entry.row.sourceRoute);
      if (!created) continue;
      if (!routes.some((route) => String(route._id) === String(created._id))) routes.push(created);
      entry.result = { route: created, method: "extra_revenue_route", suggestions: [] };
    }
  }

  const matchedForEnrichment = preliminary
    .filter(({ result }) => result.route)
    .map(({ row, result }) => ({ ...row, routeId: id(result.route), routeCode: result.route.code, routeType: result.route.type }));
  const context = await buildEnrichmentContext(division, matchedForEnrichment);
  const blockedDates = new Set(submission.blockedDates.map((item) => item.date));
  const rows = preliminary.map(({ row, result }) => {
    let enrichment = null;
    if (result.route) {
      const group = aggregateResolvedRows([
        { ...row, routeId: id(result.route), routeCode: result.route.code, routeType: result.route.type },
      ])[0];
      enrichment = enrichGroup(group, context);
    }
    return previewRow(row, result, blockedDates.has(row.date), enrichment);
  });
  rows.sort((a, b) => issueRank[a.severity] - issueRank[b.severity] || a.date.localeCompare(b.date) || a.sourceRoute.localeCompare(b.sourceRoute));

  const automaticMatches = rows.filter((row) => row.matchedRouteId && !row.blockedDate).length;
  const routeBlockers = rows.filter((row) => !row.matchedRouteId).length;
  submission.division = division;
  submission.status = "matched";
  submission.previewRows = rows;
  submission.counts.automaticMatches = automaticMatches;
  submission.counts.routeBlockers = routeBlockers;
  await submission.save();

  const existing = await NetworkKpiEntry.find({
    division,
    source: submission.source,
    date: { $in: submission.reportDates },
  }).select("date route").lean();
  res.json({
    submission: submissionJson(submission),
    rows,
    routes: routes.map((route) => ({ id: id(route), code: route.code, type: route.type })),
    existingKeys: existing.map((entry) => `${entry.date}|${id(entry.route)}`),
  });
};

export const confirmSubmission = async (req, res) => {
  let submission = await NetworkSubmission.findById(req.params.id);
  const accessError = ensureSubmissionAccess(req, submission);
  if (accessError) return res.status(accessError.status).json({ message: accessError.message });
  if (submission.status === "confirmed") return res.status(409).json({ message: "This submission is already confirmed." });
  if (!submission.division || !canAccessDivision(req.user, submission.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }

  const resolutions = new Map((req.body.resolutions || []).map((item) => [String(item.rowId), item]));
  const excludedDates = new Set((req.body.excludedDates || []).map(String));
  const requiredDateExclusions = submission.blockedDates.map((item) => item.date).filter((date) => !excludedDates.has(date));
  if (requiredDateExclusions.length) {
    return res.status(400).json({
      message: `Exclude incomplete Ecolane date(s) before saving: ${requiredDateExclusions.join(", ")}.`,
    });
  }

  const routes = await Route.find({ division: submission.division, active: true }).lean();
  const routeById = new Map(routes.map((route) => [id(route), route]));
  const previewById = new Map(submission.previewRows.map((row) => [String(row.id), row]));
  const accepted = [];
  const aliases = [];
  let excluded = 0;
  for (const row of submission.parsedRows) {
    if (excludedDates.has(row.date)) {
      excluded += 1;
      continue;
    }
    const resolution = resolutions.get(String(row.id));
    if (resolution?.exclude) {
      excluded += 1;
      continue;
    }
    const preview = previewById.get(String(row.id));
    const routeId = resolution?.routeId || preview?.matchedRouteId;
    const route = routeById.get(String(routeId));
    if (!route) {
      return res.status(400).json({ message: `Resolve or exclude route ${row.sourceRoute} on ${row.date} before saving.` });
    }
    const manuallyResolved = Boolean(resolution?.routeId && String(resolution.routeId) !== String(preview?.matchedRouteId));
    accepted.push({
      ...row,
      routeId: id(route),
      routeCode: route.code,
      routeType: route.type,
      matchMethod: manuallyResolved ? "manual" : preview?.matchMethod || "manual",
      manuallyResolved,
    });
    if (resolution?.routeId) aliases.push({ row, route });
  }
  if (!accepted.length) return res.status(400).json({ message: "At least one resolved row is required to save." });

  const aggregated = aggregateResolvedRows(accepted);
  const context = await buildEnrichmentContext(submission.division, aggregated);
  const enriched = aggregated.map((group) => enrichGroup(group, context));
  const acceptedDates = [...new Set(enriched.map((entry) => entry.date))];
  let created;
  let updated;
  let removedEntries;

  try {
    await runInTransaction(async () => {
    const currentSubmission = await NetworkSubmission.findOne({
      _id: submission._id,
      status: { $ne: "confirmed" },
    });
    if (!currentSubmission) throw httpError(409, "This submission is already confirmed.");
    submission = currentSubmission;
    const previous = await NetworkKpiEntry.find({
      division: submission.division,
      source: submission.source,
      date: { $in: acceptedDates },
    }).lean();
    const previousByKey = new Map(previous.map((entry) => [`${entry.date}|${id(entry.route)}`, entry]));
    const nextKeys = new Set(enriched.map((entry) => `${entry.date}|${entry.routeId}`));
    const replacement = planReplacement(previousByKey.keys(), nextKeys);
    created = replacement.created.length;
    updated = replacement.updated.length;
    const changeAudit = [];

  for (const entry of enriched) {
    const key = `${entry.date}|${entry.routeId}`;
    const before = previousByKey.get(key) || null;
    const payload = {
      division: submission.division,
      source: submission.source,
      date: entry.date,
      route: entry.routeId,
      submission: submission._id,
      sourceRouteCodes: entry.sourceRouteCodes,
      components: entry.components,
      metrics: entry.metrics,
      matching: {
        methods: [...new Set(entry.components.map((component) => component.matchMethod))],
        manuallyResolved: entry.components.some((component) => component.manuallyResolved),
      },
      operationalOutcome: entry.operationalOutcome,
      zeroTrip: entry.zeroTrip,
      deployment: entry.deployment,
      updatedBy: req.user._id,
    };
    const after = await NetworkKpiEntry.findOneAndUpdate(
      { division: submission.division, source: submission.source, date: entry.date, route: entry.routeId },
      payload,
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    ).lean();
    changeAudit.push({ action: before ? "updated" : "created", key, before, after });
  }

    const removedKeys = new Set(replacement.removed);
    removedEntries = previous.filter((entry) => removedKeys.has(`${entry.date}|${id(entry.route)}`));
    if (removedEntries.length) {
      await NetworkKpiEntry.deleteMany({ _id: { $in: removedEntries.map((entry) => entry._id) } });
      for (const entry of removedEntries) {
        changeAudit.push({ action: "removed", key: `${entry.date}|${id(entry.route)}`, before: entry, after: null });
      }
    }
    for (const { row, route } of aliases) {
      await NetworkRouteAlias.findOneAndUpdate(
        {
          division: submission.division,
          source: submission.source,
          normalizedSourceRoute: normalizeRouteCode(row.sourceRoute),
        },
        {
          division: submission.division,
          source: submission.source,
          normalizedSourceRoute: normalizeRouteCode(row.sourceRoute),
          sourceRoute: row.sourceRoute,
          route: route._id,
          confirmedBy: req.user._id,
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
      );
    }

    submission.status = "confirmed";
    submission.confirmedBy = req.user._id;
    submission.confirmedAt = new Date();
    submission.counts.created = created;
    submission.counts.updated = updated;
    submission.counts.removed = removedEntries.length;
    submission.counts.excluded = excluded;
    submission.counts.zeroTripRows = accepted.filter((row) => row.zeroTrips).length;
    submission.counts.incompleteEnrichment = enriched.filter(
      (entry) => entry.deployment.warning || entry.deployment.assignmentWarning
    ).length;
    submission.changeAudit = changeAudit;
    await submission.save();
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }
  for (const month of [...new Set(acceptedDates.map((date) => date.slice(0, 7)))]) {
    queueOperationsRefresh(submission.division, month);
  }
  res.json({ submission: submissionJson(submission), counts: submission.counts });
};

export const listSubmissions = async (req, res) => {
  const filter = req.user.role === "ELT"
    ? {}
    : { $or: [{ division: { $in: req.user.divisionAccess } }, { createdBy: req.user._id }] };
  filter.status = { $ne: "removed" };
  if (req.query.division) {
    if (!canAccessDivision(req.user, req.query.division)) return res.status(403).json({ message: "No access to this division" });
    filter.division = req.query.division;
  }
  if (req.query.source && ["vision", "ecolane", "spare", "rideco"].includes(req.query.source)) filter.source = req.query.source;
  const submissions = await NetworkSubmission.find(filter)
    .select("-parsedRows -previewRows -changeAudit")
    .populate("division", "code name")
    .populate("createdBy confirmedBy", "name")
    .sort({ createdAt: -1 })
    .limit(25)
    .lean();
  res.json({ submissions: submissions.map((submission) => ({ ...submission, id: id(submission) })) });
};

export const removeSubmission = async (req, res) => {
  const submission = await NetworkSubmission.findById(req.params.id);
  const accessError = ensureSubmissionAccess(req, submission);
  if (accessError) return res.status(accessError.status).json({ message: accessError.message });

  let activeEntries;
  try {
    await runInTransaction(async () => {
    const currentSubmission = await NetworkSubmission.findById(submission._id);
    if (!currentSubmission) {
      throw httpError(409, "This submission has already been removed.");
    }
    activeEntries = currentSubmission.status === "confirmed"
      ? await NetworkKpiEntry.find({ submission: currentSubmission._id }).lean()
      : [];
    if (activeEntries.length) await NetworkKpiEntry.deleteMany({ submission: currentSubmission._id });
    await NetworkSubmission.deleteOne({ _id: currentSubmission._id });
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }
  for (const month of [...new Set(activeEntries.map((entry) => entry.date.slice(0, 7)))]) {
    queueOperationsRefresh(submission.division, month);
  }

  res.json({
    message: activeEntries.length
      ? "Submission and its active Network Success records were permanently deleted. You can upload the corrected files now."
      : "Submission permanently deleted. You can upload the files again now.",
    removedEntries: activeEntries.length,
  });
};

export const reopenSubmission = async (req, res) => {
  let original = await NetworkSubmission.findById(req.params.id);
  const accessError = ensureSubmissionAccess(req, original);
  if (accessError) return res.status(accessError.status).json({ message: accessError.message });
  if (original.status === "removed") return res.status(409).json({ message: "Removed submissions cannot be reopened. Upload the workbook again instead." });
  if (!original.parsedRows?.length) return res.status(409).json({ message: "This submission has no retained parsed rows to reopen." });

  if (original.status !== "confirmed") {
    return res.json({ submission: submissionJson(original), reopened: false });
  }

  let revision;
  let created = false;
  try {
    await runInTransaction(async () => {
    const currentOriginal = await NetworkSubmission.findById(original._id);
    if (!currentOriginal || currentOriginal.status === "removed") {
      throw httpError(409, "Removed submissions cannot be reopened. Upload the workbook again instead.");
    }
    if (currentOriginal.status !== "confirmed") {
      throw httpError(409, "This submission is no longer confirmed.");
    }
    original = currentOriginal;
    revision = await NetworkSubmission.findOne({
      reopenedFrom: original._id,
      status: { $in: ["pending", "matched"] },
    });
    if (!revision) {
      revision = await NetworkSubmission.create({
        source: original.source,
        status: "pending",
        files: original.files.map((file) => file.toObject?.() || file),
        division: original.division,
        divisionCandidates: original.divisionCandidates,
        parsedRows: original.parsedRows,
        previewRows: [],
        blockedDates: original.blockedDates,
        reportDates: original.reportDates,
        warnings: original.warnings,
        createdBy: req.user._id,
        reopenedFrom: original._id,
        counts: {
          sourceRows: original.counts?.sourceRows || original.parsedRows.length,
          zeroTripRows: original.counts?.zeroTripRows || 0,
        },
      });
      original.changeAudit.push({
        action: "reopened_as_revision",
        changedAt: new Date(),
        changedBy: req.user._id,
        revision: revision._id,
      });
      await original.save();
      created = true;
    }
    });
  } catch (error) {
    return respondToHttpError(error, res);
  }

  return res.status(created ? 201 : 200).json({ submission: submissionJson(revision), reopened: true });
};

export const listEntries = async (req, res) => {
  const { division, source, from, to, provider } = req.query;
  if (!division) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, division)) return res.status(403).json({ message: "No access to this division" });
  const filter = { division };
  if (source && ["vision", "ecolane", "spare", "rideco"].includes(source)) filter.source = source;
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (provider) filter["deployment.providerName"] = { $regex: provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const entries = await NetworkKpiEntry.find(filter)
    .populate("route", "code type")
    .sort({ date: -1, route: 1 })
    .limit(2000)
    .lean();
  res.json({ entries });
};

export const withPerformanceAssignment = (entry, masterRunCut) => {
  if (entry.assignmentOverride) {
    return {
      ...entry,
      performanceAssignment: {
        operator: id(entry.assignmentOverride.operator),
        operatorName: entry.assignmentOverride.operatorName || null,
        provider: id(entry.assignmentOverride.provider),
        providerName: entry.assignmentOverride.providerName || null,
        source: "manual_override",
      },
    };
  }
  const masterOperator = masterRunCut?.operator || null;
  if (masterOperator) {
    return {
      ...entry,
      performanceAssignment: {
        operator: id(masterOperator),
        operatorName: masterOperator.name,
        provider: id(masterOperator.provider),
        providerName: masterOperator.provider?.name || null,
        source: "master_run_cuts",
      },
    };
  }
  return {
    ...entry,
    performanceAssignment: {
      operator: id(entry.deployment?.operator),
      operatorName: entry.deployment?.operatorName || null,
      provider: id(entry.deployment?.provider),
      providerName: entry.deployment?.providerName || null,
      source: "deployment_snapshot",
    },
  };
};

export const resolvePerformanceRunCut = (entry, runCuts) => {
  const entryRouteId = id(entry.route);
  const direct = runCuts.find((runCut) => id(runCut.route) === entryRouteId);
  if (direct) return direct;

  const routable = runCuts.filter((runCut) => runCut.route?.code);
  if (!routable.length) return null;
  const routes = routable.map((runCut) => runCut.route);
  const candidates = [
    entry.route?.code,
    entry.deployment?.canonicalRoute,
    ...(entry.sourceRouteCodes || []),
  ].filter(Boolean);
  for (const code of candidates) {
    const result = resolveRoute(code, routes);
    if (result.route) return routable.find((runCut) => id(runCut.route) === id(result.route)) || null;
  }
  return null;
};

export const getPerformance = async (req, res) => {
  const { division, source, from, to, provider } = req.query;
  if (!division) return res.status(400).json({ message: "division is required" });
  if (!canAccessDivision(req.user, division)) return res.status(403).json({ message: "No access to this division" });
  if (from && to && from > to) return res.status(400).json({ message: "From date must be on or before To date." });
  const filter = { division };
  if (source && ["vision", "ecolane", "spare", "rideco"].includes(source)) filter.source = source;
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const [entries, runCuts, oldest, newest] = await Promise.all([
    NetworkKpiEntry.find(filter).populate("route", "code type").sort({ date: 1, route: 1 }).lean(),
    RunCut.find({ division })
      .populate("route", "code type")
      .populate({ path: "operator", select: "name employeeId provider", populate: { path: "provider", select: "name" } })
      .lean(),
    NetworkKpiEntry.findOne({ division }).sort({ date: 1 }).select("date").lean(),
    NetworkKpiEntry.findOne({ division }).sort({ date: -1 }).select("date").lean(),
  ]);
  const assigned = entries.map((entry) => withPerformanceAssignment(entry, resolvePerformanceRunCut(entry, runCuts)));
  const providerNeedle = String(provider || "").trim().toLowerCase();
  const filteredEntries = providerNeedle
    ? assigned.filter((entry) => entry.performanceAssignment.providerName?.toLowerCase().includes(providerNeedle))
    : assigned;
  const providerNames = [...new Set([
    ...assigned.map((entry) => entry.performanceAssignment.providerName).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b));
  res.json({
    ...buildPerformanceAnalysis(filteredEntries),
    providerNames,
    hasProviderData: providerNames.length > 0,
    dateBounds: { from: oldest?.date || null, to: newest?.date || null },
    filters: { division, source: source || "all", from: from || null, to: to || null, provider: provider || "" },
  });
};

export const updatePerformanceAssignment = async (req, res) => {
  const entry = await NetworkKpiEntry.findById(req.params.id);
  if (!entry) return res.status(404).json({ message: "Network performance record not found" });
  if (!canAccessDivision(req.user, entry.division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  const before = entry.assignmentOverride?.toObject?.() || entry.assignmentOverride || null;
  if (req.body.useMasterRunCut) {
    entry.assignmentOverride = null;
    entry.assignmentAudit.push({ changedAt: new Date(), changedBy: req.user._id, before, after: null });
    entry.updatedBy = req.user._id;
    await entry.save();
    return res.json({ message: "Performance assignment returned to Master Run Cuts." });
  }

  const operatorId = req.body.operatorId || null;
  const requestedProviderId = req.body.providerId || null;
  const [operator, provider] = await Promise.all([
    operatorId ? Operator.findById(operatorId).populate("provider", "name") : null,
    requestedProviderId ? Provider.findById(requestedProviderId) : null,
  ]);
  if (operatorId && !operator) return res.status(400).json({ message: "Selected operator was not found." });
  if (operator && String(operator.division) !== String(entry.division)) {
    return res.status(400).json({ message: "Choose a driver from this division's Drivers roster." });
  }
  if (operator?.active === false) {
    return res.status(400).json({ message: "That driver is inactive. Choose an active driver." });
  }
  if (requestedProviderId && !provider) return res.status(400).json({ message: "Selected provider was not found." });
  const resolvedProvider = provider || (!Object.prototype.hasOwnProperty.call(req.body, "providerId") ? operator?.provider : null);
  const after = {
    operator: operator?._id || null,
    operatorName: operator?.name || null,
    provider: resolvedProvider?._id || null,
    providerName: resolvedProvider?.name || null,
    updatedBy: req.user._id,
    updatedAt: new Date(),
  };

  if (req.body.reuseAssignment) {
    if (!operator && requestedProviderId) {
      return res.status(400).json({ message: "Choose an operator before assigning a provider." });
    }
    try {
      await runInTransaction(async () => {
        const currentEntry = await NetworkKpiEntry.findById(entry._id);
        if (!currentEntry) throw httpError(404, "Network performance record not found");
        const runCut = await RunCut.findOne({ division: currentEntry.division, route: currentEntry.route });
        if (!runCut) throw httpError(400, "This route is not available in Master Run Cuts.");
        const beforeMaster = {
          operator: id(runCut.operator),
          provider: id(operator?.provider),
        };
        runCut.operator = operator?._id || null;
        runCut.pulloutAddress = operator?.pulloutAddress || "";
        runCut.updatedBy = req.user._id;
        if (operator && Object.prototype.hasOwnProperty.call(req.body, "providerId")) {
          operator.provider = resolvedProvider?._id || null;
          await operator.save();
        }
        await runCut.save();
        currentEntry.assignmentOverride = null;
        currentEntry.assignmentAudit.push({
          changedAt: after.updatedAt,
          changedBy: req.user._id,
          scope: "master_run_cuts",
          before: beforeMaster,
          after,
        });
        currentEntry.updatedBy = req.user._id;
        await currentEntry.save();
      });
    } catch (error) {
      return respondToHttpError(error, res);
    }
    return res.json({
      message: "Master Run Cut assignment saved. This operator/provider relationship will be reused automatically.",
      reused: true,
    });
  }

  entry.assignmentOverride = after;
  entry.assignmentAudit.push({ changedAt: after.updatedAt, changedBy: req.user._id, before, after });
  entry.updatedBy = req.user._id;
  await entry.save();
  res.json({ message: "Performance assignment override saved." });
};
