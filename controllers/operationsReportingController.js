import mongoose from "../db/sqlMongoose.js";
import CorrectiveActionPlan from "../models/CorrectiveActionPlan.js";
import Division from "../models/Division.js";
import OperationsKpiResult from "../models/OperationsKpiResult.js";
import Settings from "../models/Settings.js";
import User from "../models/User.js";
import { canAccessDivision, divisionFilter } from "../middleware/access.js";
import { KPI_BY_KEY, isCalendarMonth, monthsBetween, roundKpi } from "../utils/operationsKpis.js";
import { computeOperationsRange, findCapTriggerMonth } from "../utils/operationsReporting.js";

const validRange = (res, from, to, maxMonths = 12) => {
  if (!isCalendarMonth(from) || !isCalendarMonth(to)) {
    res.status(400).json({ message: "From and to must be valid months." });
    return false;
  }
  if (from > to) {
    res.status(400).json({ message: "From month must be on or before To month." });
    return false;
  }
  if (monthsBetween(from, to).length > maxMonths) {
    res.status(400).json({ message: `Select no more than ${maxMonths} months.` });
    return false;
  }
  return true;
};

const accessibleDivisions = async (req, requested) => {
  const filter = { ...divisionFilter(req.user), active: true };
  if (requested) {
    if (!mongoose.isValidObjectId(requested) || !canAccessDivision(req.user, requested)) return null;
    filter._id = requested;
  }
  return Division.find(filter).sort({ code: 1 });
};

const capJson = (cap, user) => {
  const assignedId = String(cap.assignedManager?._id || cap.assignedManager || "");
  const ownerId = String(cap.ownerUser?._id || cap.ownerUser || "");
  const canEdit = user.role === "ELT" || assignedId === String(user._id);
  return {
    id: String(cap._id),
    division: cap.division,
    kpiKey: cap.kpiKey,
    kpiLabel: KPI_BY_KEY[cap.kpiKey]?.label || cap.kpiKey,
    kpiFormat: KPI_BY_KEY[cap.kpiKey]?.format,
    triggerMonth: cap.triggerMonth,
    firstEnteredAt: cap.firstEnteredAt,
    valueAtCapDate: cap.valueAtCapDate,
    targetAtCap: cap.targetAtCap,
    redCutoffAtCap: cap.redCutoffAtCap,
    directionAtCap: cap.directionAtCap,
    varianceAtCap: cap.varianceAtCap,
    latestMonth: cap.latestMonth,
    latestValue: cap.latestValue,
    latestKpiStatus: cap.latestKpiStatus,
    status: cap.status,
    assignedManager: cap.assignedManager,
    rootCause: cap.rootCause,
    correctiveAction: cap.correctiveAction,
    ownerUser: cap.ownerUser,
    ownerName: cap.ownerName,
    plannedRecoveryDate: cap.plannedRecoveryDate,
    recoveryCandidate: cap.recoveryCandidate,
    valueAtRecovery: cap.valueAtRecovery,
    dateRecoveryMet: cap.dateRecoveryMet,
    recoveredAt: cap.recoveredAt,
    recoveredBy: cap.recoveredBy,
    updates: cap.updates,
    audit: cap.audit,
    canEdit,
    canAddNote: canEdit || ownerId === String(user._id),
    createdAt: cap.createdAt,
    updatedAt: cap.updatedAt,
  };
};

const populateCap = (query) => query
  .populate("division", "code name timezone")
  .populate("assignedManager", "name role")
  .populate("ownerUser", "name role")
  .populate("recoveredBy", "name role")
  .populate("updates.author", "name role");

const attachCaps = async (report) => {
  const divisionIds = report.divisions.map((item) => item.division.id);
  const [activeCaps, allCaps, singleton] = await Promise.all([
    CorrectiveActionPlan.find({ division: { $in: divisionIds }, activeEpisode: true }).select("division kpiKey status").lean(),
    CorrectiveActionPlan.find({ division: { $in: divisionIds } }).select("division kpiKey status triggerMonth recoveryCandidate.month").sort({ triggerMonth: 1 }).lean(),
    Settings.getSingleton(),
  ]);
  const capByKey = new Map(activeCaps.map((cap) => [`${cap.division}|${cap.kpiKey}`, { id: String(cap._id), status: cap.status }]));
  const latestCapByKey = new Map();
  for (const cap of allCaps) latestCapByKey.set(`${cap.division}|${cap.kpiKey}`, cap);
  const activationMonth = singleton.operationsReportingStartMonth;

  return {
    ...report,
    divisions: report.divisions.map((item) => ({
      ...item,
      kpis: item.kpis.map((kpi) => {
        const key = `${item.division.id}|${kpi.key}`;
        const cap = capByKey.get(key) || null;
        let capNeeded = null;
        if (!cap) {
          const candidate = findCapTriggerMonth({
            monthlyResults: kpi.monthly,
            activationMonth,
            latestCap: latestCapByKey.get(key),
          });
          if (candidate) {
            capNeeded = {
              division: item.division.id,
              kpiKey: kpi.key,
              triggerMonth: candidate.month,
              value: candidate.value,
              target: candidate.setting.target,
              variance: roundKpi(candidate.value - candidate.setting.target),
              status: candidate.status,
            };
          }
        }
        return { ...kpi, cap, capNeeded };
      }),
    })),
  };
};

export const getTracker = async (req, res) => {
  const { from, to, division } = req.query;
  if (!validRange(res, from, to)) return;
  const divisions = await accessibleDivisions(req, division);
  if (!divisions) return res.status(403).json({ message: "No access to this division" });
  const report = await computeOperationsRange({ divisions, from, to, reconcileCaps: true });
  res.json(await attachCaps(report));
};

export const getMonthlyDashboard = async (req, res) => {
  const { month, division } = req.query;
  if (!isCalendarMonth(month)) return res.status(400).json({ message: "A valid month is required." });
  const divisions = await accessibleDivisions(req, division);
  if (!divisions) return res.status(403).json({ message: "No access to this division" });
  const report = await computeOperationsRange({ divisions, from: month, to: month, reconcileCaps: true });
  res.json(await attachCaps(report));
};

export const listCaps = async (req, res) => {
  const divisions = await accessibleDivisions(req, req.query.division);
  if (!divisions) return res.status(403).json({ message: "No access to this division" });
  const { from, to } = req.query;
  if (from && !isCalendarMonth(from)) return res.status(400).json({ message: "From must be a valid month." });
  if (to && !isCalendarMonth(to)) return res.status(400).json({ message: "To must be a valid month." });
  if (from && to && from > to) return res.status(400).json({ message: "From month must be on or before To month." });
  const filter = { division: { $in: divisions.map((division) => division._id) } };
  if (req.query.status === "active" || !req.query.status) filter.status = { $in: ["open", "recovery_ready"] };
  else if (["open", "recovery_ready", "recovered"].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.mine === "1") filter.assignedManager = req.user._id;
  const [oldest, newest, singleton] = await Promise.all([
    CorrectiveActionPlan.findOne(filter).sort({ triggerMonth: 1 }).select("triggerMonth").lean(),
    CorrectiveActionPlan.findOne(filter).sort({ triggerMonth: -1 }).select("triggerMonth").lean(),
    Settings.getSingleton(),
  ]);
  const effectiveFrom = from || oldest?.triggerMonth || singleton.operationsReportingStartMonth;
  const effectiveTo = to || newest?.triggerMonth || new Date().toISOString().slice(0, 7);
  filter.triggerMonth = { $gte: effectiveFrom, $lte: effectiveTo };
  const caps = await populateCap(CorrectiveActionPlan.find(filter).sort({ status: 1, triggerMonth: -1, latestMonth: -1, createdAt: -1 }));
  res.json({
    caps: caps.map((cap) => capJson(cap, req.user)),
    activationMonth: singleton.operationsReportingStartMonth,
    monthBounds: { from: oldest?.triggerMonth || null, to: newest?.triggerMonth || null },
    filters: { from: effectiveFrom, to: effectiveTo },
  });
};

const hasOperationsReportingAccess = (user, divisionId) =>
  user.role === "ELT" || (user.sections.includes("operations_reporting") && canAccessDivision(user, divisionId));

export const openCap = async (req, res) => {
  const { division, kpiKey, triggerMonth } = req.body;
  if (!mongoose.isValidObjectId(division) || !hasOperationsReportingAccess(req.user, division)) {
    return res.status(403).json({ message: "No access to this division" });
  }
  if (!KPI_BY_KEY[kpiKey]) return res.status(400).json({ message: "Choose a valid KPI." });
  if (!isCalendarMonth(triggerMonth)) return res.status(400).json({ message: "A valid trigger month is required." });

  const existingActive = await CorrectiveActionPlan.findOne({ division, kpiKey, activeEpisode: true });
  if (existingActive) return res.status(409).json({ message: "A CAP is already open for this KPI." });

  const result = await OperationsKpiResult.findOne({ division, kpiKey, month: triggerMonth }).lean();
  if (!result) return res.status(409).json({ message: "No KPI result was found for this month." });

  const [singleton, latestCap] = await Promise.all([
    Settings.getSingleton(),
    CorrectiveActionPlan.findOne({ division, kpiKey }).sort({ triggerMonth: -1 }).select("status recoveryCandidate.month").lean(),
  ]);
  const candidate = findCapTriggerMonth({
    monthlyResults: [result],
    activationMonth: singleton.operationsReportingStartMonth,
    latestCap,
  });
  if (!candidate) return res.status(409).json({ message: "This month is no longer eligible to open a CAP." });

  const cap = await CorrectiveActionPlan.create({
    division,
    kpiKey,
    triggerMonth: candidate.month,
    valueAtCapDate: candidate.value,
    targetAtCap: candidate.setting.target,
    redCutoffAtCap: candidate.setting.redCutoff,
    directionAtCap: candidate.setting.direction,
    varianceAtCap: roundKpi(candidate.value - candidate.setting.target),
    latestMonth: candidate.month,
    latestValue: candidate.value,
    latestKpiStatus: candidate.status,
    assignedManager: candidate.setting.assignedManager || null,
    audit: [{ action: "opened_by_manager", changedBy: req.user._id, details: { month: candidate.month, status: candidate.status } }],
  });
  const populated = await populateCap(CorrectiveActionPlan.findById(cap._id));
  res.status(201).json({ cap: capJson(populated, req.user) });
};

export const getCapReport = async (req, res) => {
  const divisions = await accessibleDivisions(req, req.query.division);
  if (!divisions) return res.status(403).json({ message: "No access to this division" });
  const { from, to } = req.query;
  if (from && !isCalendarMonth(from)) return res.status(400).json({ message: "From must be a valid month." });
  if (to && !isCalendarMonth(to)) return res.status(400).json({ message: "To must be a valid month." });
  if (from && to && from > to) return res.status(400).json({ message: "From month must be on or before To month." });
  const filter = { division: { $in: divisions.map((division) => division._id) } };
  if (["open", "recovery_ready", "recovered"].includes(req.query.status)) filter.status = req.query.status;
  const [oldest, newest, singleton] = await Promise.all([
    CorrectiveActionPlan.findOne(filter).sort({ triggerMonth: 1 }).select("triggerMonth").lean(),
    CorrectiveActionPlan.findOne(filter).sort({ triggerMonth: -1 }).select("triggerMonth").lean(),
    Settings.getSingleton(),
  ]);
  const effectiveFrom = from || oldest?.triggerMonth || singleton.operationsReportingStartMonth;
  const effectiveTo = to || newest?.triggerMonth || new Date().toISOString().slice(0, 7);
  filter.triggerMonth = { $gte: effectiveFrom, $lte: effectiveTo };
  const caps = await populateCap(CorrectiveActionPlan.find(filter).sort({ triggerMonth: -1 }));
  const rows = caps.map((cap) => capJson(cap, req.user));
  const summary = {
    total: rows.length,
    open: rows.filter((row) => row.status === "open").length,
    recoveryReady: rows.filter((row) => row.status === "recovery_ready").length,
    recovered: rows.filter((row) => row.status === "recovered").length,
  };
  const durations = rows
    .filter((row) => row.status === "recovered" && row.recoveredAt && row.firstEnteredAt)
    .map((row) => (new Date(row.recoveredAt) - new Date(row.firstEnteredAt)) / 86400000);
  summary.avgDaysToRecover = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
  res.json({
    caps: rows,
    summary,
    monthBounds: { from: oldest?.triggerMonth || null, to: newest?.triggerMonth || null },
    filters: { from: effectiveFrom, to: effectiveTo },
  });
};

export const listCapNeeded = async (req, res) => {
  const divisions = await accessibleDivisions(req, req.query.division);
  if (!divisions) return res.status(403).json({ message: "No access to this division" });
  const divisionIds = divisions.map((division) => division._id);
  const divisionById = new Map(divisions.map((division) => [String(division._id), division]));

  const [redResults, activeCaps, allCaps, singleton] = await Promise.all([
    OperationsKpiResult.find({ division: { $in: divisionIds }, closed: true, status: { $in: ["red", "critical"] } }).sort({ month: 1 }).lean(),
    CorrectiveActionPlan.find({ division: { $in: divisionIds }, activeEpisode: true }).select("division kpiKey").lean(),
    CorrectiveActionPlan.find({ division: { $in: divisionIds } }).select("division kpiKey status recoveryCandidate.month triggerMonth").sort({ triggerMonth: 1 }).lean(),
    Settings.getSingleton(),
  ]);

  const activeSet = new Set(activeCaps.map((cap) => `${cap.division}|${cap.kpiKey}`));
  const latestCapByKey = new Map();
  for (const cap of allCaps) latestCapByKey.set(`${cap.division}|${cap.kpiKey}`, cap);

  const resultsByKey = new Map();
  for (const result of redResults) {
    const key = `${result.division}|${result.kpiKey}`;
    if (!resultsByKey.has(key)) resultsByKey.set(key, []);
    resultsByKey.get(key).push(result);
  }

  const needed = [];
  for (const [key, monthlyResults] of resultsByKey) {
    if (activeSet.has(key)) continue;
    const [divisionId, kpiKey] = key.split("|");
    const candidate = findCapTriggerMonth({
      monthlyResults,
      activationMonth: singleton.operationsReportingStartMonth,
      latestCap: latestCapByKey.get(key),
    });
    if (!candidate) continue;
    const division = divisionById.get(divisionId);
    needed.push({
      division: divisionId,
      divisionCode: division?.code,
      divisionName: division?.name,
      kpiKey,
      kpiLabel: KPI_BY_KEY[kpiKey]?.label || kpiKey,
      kpiFormat: KPI_BY_KEY[kpiKey]?.format,
      triggerMonth: candidate.month,
      value: candidate.value,
      target: candidate.setting.target,
      variance: roundKpi(candidate.value - candidate.setting.target),
      status: candidate.status,
    });
  }
  needed.sort((a, b) => a.triggerMonth.localeCompare(b.triggerMonth) || String(a.divisionCode).localeCompare(String(b.divisionCode)));
  res.json({ needed });
};

export const listCapPeople = async (req, res) => {
  const divisions = await accessibleDivisions(req, req.query.division);
  if (!divisions) return res.status(403).json({ message: "No access to this division" });
  const divisionIds = divisions.map((division) => division._id);
  const users = await User.find({
    active: true,
    $or: [
      { role: "ELT" },
      { divisionAccess: { $in: divisionIds }, sections: "operations_reporting" },
    ],
  }).select("name role divisionAccess").sort({ name: 1 }).lean();
  res.json({ users: users.map((user) => ({ id: String(user._id), name: user.name, role: user.role, divisionAccess: user.divisionAccess })) });
};

const getCapForUser = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ message: "A valid CAP is required." });
    return null;
  }
  const cap = await CorrectiveActionPlan.findById(req.params.id);
  if (!cap) {
    res.status(404).json({ message: "CAP not found." });
    return null;
  }
  if (!canAccessDivision(req.user, cap.division)) {
    res.status(403).json({ message: "No access to this division" });
    return null;
  }
  return cap;
};

const canEditCap = (user, cap) => user.role === "ELT" || String(cap.assignedManager || "") === String(user._id);

export const updateCap = async (req, res) => {
  const cap = await getCapForUser(req, res);
  if (!cap) return;
  if (!canEditCap(req.user, cap)) return res.status(403).json({ message: "Only the assigned manager or ELT may update this CAP." });

  const changed = {};
  const before = {};
  for (const [field, bodyKey = field] of [
    ["rootCause"],
    ["correctiveAction"],
    ["ownerName"],
  ]) {
    if (req.body[bodyKey] !== undefined) {
      before[field] = cap[field];
      cap[field] = String(req.body[bodyKey] || "").trim();
      changed[field] = cap[field];
    }
  }
  if (req.body.plannedRecoveryDate !== undefined) {
    before.plannedRecoveryDate = cap.plannedRecoveryDate;
    const plannedDate = req.body.plannedRecoveryDate ? new Date(`${req.body.plannedRecoveryDate}T12:00:00.000Z`) : null;
    if (plannedDate && Number.isNaN(plannedDate.getTime())) return res.status(400).json({ message: "Planned recovery date is invalid." });
    cap.plannedRecoveryDate = plannedDate;
    changed.plannedRecoveryDate = cap.plannedRecoveryDate;
  }
  if (req.body.ownerUser !== undefined) {
    if (req.body.ownerUser && !mongoose.isValidObjectId(req.body.ownerUser)) return res.status(400).json({ message: "Choose a valid action owner." });
    before.ownerUser = cap.ownerUser;
    cap.ownerUser = req.body.ownerUser || null;
    if (cap.ownerUser) {
      const owner = await User.findOne({
        _id: cap.ownerUser,
        active: true,
        $or: [{ role: "ELT" }, { sections: "operations_reporting" }],
      });
      if (!owner) return res.status(400).json({ message: "The selected action owner is unavailable." });
      if (owner.role !== "ELT" && !owner.divisionAccess.some((value) => String(value) === String(cap.division))) {
        return res.status(400).json({ message: "The selected action owner does not have access to this division." });
      }
      if (!cap.ownerName) cap.ownerName = owner.name;
    }
    changed.ownerUser = cap.ownerUser;
  }
  if (req.body.assignedManager !== undefined) {
    if (req.user.role !== "ELT") return res.status(403).json({ message: "Only ELT may reassign a CAP." });
    if (req.body.assignedManager && !mongoose.isValidObjectId(req.body.assignedManager)) return res.status(400).json({ message: "Choose a valid manager." });
    if (req.body.assignedManager) {
      const manager = await User.findOne({ _id: req.body.assignedManager, active: true });
      if (!manager || (manager.role !== "ELT" && (!manager.sections.includes("operations_reporting") || !manager.divisionAccess.some((value) => String(value) === String(cap.division))))) {
        return res.status(400).json({ message: "The selected manager needs Operations Reporting access to this division." });
      }
    }
    before.assignedManager = cap.assignedManager;
    cap.assignedManager = req.body.assignedManager || null;
    changed.assignedManager = cap.assignedManager;
  }
  if (Object.keys(changed).length) cap.audit.push({ action: "details_updated", changedBy: req.user._id, details: { before, after: changed } });
  await cap.save();
  const populated = await populateCap(CorrectiveActionPlan.findById(cap._id));
  res.json({ cap: capJson(populated, req.user) });
};

export const addCapNote = async (req, res) => {
  const cap = await getCapForUser(req, res);
  if (!cap) return;
  const canNote = canEditCap(req.user, cap) || String(cap.ownerUser || "") === String(req.user._id);
  if (!canNote) return res.status(403).json({ message: "Only the assigned manager, action owner, or ELT may add updates." });
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ message: "Enter an update or note." });
  cap.updates.push({ text, author: req.user._id });
  cap.audit.push({ action: "note_added", changedBy: req.user._id });
  await cap.save();
  const populated = await populateCap(CorrectiveActionPlan.findById(cap._id));
  res.status(201).json({ cap: capJson(populated, req.user) });
};

export const confirmCapRecovery = async (req, res) => {
  const cap = await getCapForUser(req, res);
  if (!cap) return;
  if (!canEditCap(req.user, cap)) return res.status(403).json({ message: "Only the assigned manager or ELT may confirm recovery." });
  if (cap.status !== "recovery_ready" || !cap.recoveryCandidate?.month) {
    return res.status(409).json({ message: "This CAP does not have a current target-meeting result to confirm." });
  }
  if (!cap.rootCause || !cap.correctiveAction || (!cap.ownerUser && !cap.ownerName) || !cap.plannedRecoveryDate) {
    return res.status(400).json({ message: "Complete the root cause, corrective action, owner, and planned recovery date first." });
  }
  if (!cap.updates.length) return res.status(400).json({ message: "Add at least one update or note before confirming recovery." });
  const value = req.body.valueAtRecovery === undefined ? cap.recoveryCandidate.value : Number(req.body.valueAtRecovery);
  if (!Number.isFinite(value)) return res.status(400).json({ message: "Value at recovery must be a number." });
  const date = req.body.dateRecoveryMet
    ? new Date(`${req.body.dateRecoveryMet}T12:00:00.000Z`)
    : cap.recoveryCandidate.date;
  if (Number.isNaN(new Date(date).getTime())) return res.status(400).json({ message: "Date recovery met is invalid." });
  cap.valueAtRecovery = value;
  cap.dateRecoveryMet = date;
  cap.recoveredAt = new Date();
  cap.recoveredBy = req.user._id;
  cap.status = "recovered";
  cap.activeEpisode = false;
  cap.audit.push({ action: "recovery_confirmed", changedBy: req.user._id, details: { value, date } });
  await cap.save();
  const populated = await populateCap(CorrectiveActionPlan.findById(cap._id));
  res.json({ cap: capJson(populated, req.user) });
};

export const cancelCap = async (req, res) => {
  const cap = await getCapForUser(req, res);
  if (!cap) return;
  if (!canEditCap(req.user, cap)) return res.status(403).json({ message: "Only the assigned manager or ELT may cancel this CAP." });
  if (cap.status !== "open") {
    return res.status(409).json({ message: "Only an open CAP that hasn't reached recovery can be canceled." });
  }
  await CorrectiveActionPlan.deleteOne({ _id: cap._id });
  res.status(204).end();
};
