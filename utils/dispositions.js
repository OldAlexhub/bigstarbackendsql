export const STANDBY_DISPOSITION = "deployed_stby";
export const CLOSED_SUSPENDED_DISPOSITION = "closed_suspended";

export const DISPOSITION_TYPES = [
  "deployed_on_time",
  "deployed_late",
  STANDBY_DISPOSITION,
  "reallocated",
  CLOSED_SUSPENDED_DISPOSITION,
];

// A suspended live-day status owns its matching outcome. Keeping a distinct
// source lets changing the status back clear only the automatic outcome,
// without erasing a disposition that dispatch selected manually.
export const syncDispositionWithStatus = (runCutDay, status) => {
  if (status === "suspended") {
    runCutDay.disposition = CLOSED_SUSPENDED_DISPOSITION;
    runCutDay.dispositionSource = "status";
    runCutDay.dispositionStandbyDay = null;
    return true;
  }

  if (runCutDay.dispositionSource === "status") {
    runCutDay.disposition = null;
    runCutDay.dispositionSource = null;
    runCutDay.dispositionStandbyDay = null;
    return true;
  }

  return false;
};

// The same invariant applies in the other direction: choosing the
// Closed/Suspended outcome makes Suspended the live-day status and lets the
// status own the disposition from then on.
export const syncStatusWithDisposition = (runCutDay, disposition) => {
  if (disposition !== CLOSED_SUSPENDED_DISPOSITION) return false;

  runCutDay.status = "suspended";
  syncDispositionWithStatus(runCutDay, "suspended");
  return true;
};

// Decides what pullout address a standby deploying onto a route should
// supply, before calling activateRouteWithStandbyCoverage. Most divisions
// want the standby's own address (the caller's default). A division that
// opted to keep its routes' own addresses (Settings ->
// pulloutAddressRules.standbyKeepsRouteAddress) instead keeps whatever the
// covered day already has, falling back to the route's standing Master Run
// Cut pullout when the day has none at all (e.g. today is Unassigned) —
// otherwise "keep the route's own address" would just mean "leave it
// blank," never showing an address at all.
export const resolveStandbyPulloutAddress = ({
  divisionKeepsRouteAddress,
  standbyPulloutAddress,
  coveredPulloutAddress,
  masterPulloutAddress,
}) => {
  if (!divisionKeepsRouteAddress) return standbyPulloutAddress;
  if (coveredPulloutAddress) return undefined;
  return masterPulloutAddress || undefined;
};

// Three fields (pulloutAddress, operator, vehicle) can each be temporarily
// taken over by whichever standby is covering this route, the same way:
// snapshot what was there under "<field>BeforeStandby" the first time this
// exact standby takes it, mark ownership under "<field>StandbyDay", and note
// whether that prior value was itself an override. Refreshing the same
// standby's own coverage does not re-snapshot (so a second activate call
// doesn't clobber the pre-coverage value with the standby's own).
const STANDBY_OWNED_FIELDS = {
  pulloutAddress: { emptyValue: "" },
  operator: { emptyValue: null },
  vehicle: { emptyValue: null },
};

const applyStandbyOwnedField = (runCutDay, standbyRunCutDayId, field, newValue) => {
  if (newValue === undefined) return;
  const { emptyValue } = STANDBY_OWNED_FIELDS[field];
  const standbyDayField = `${field}StandbyDay`;
  const alreadyOwnedByThisStandby = String(runCutDay[standbyDayField] || "") === String(standbyRunCutDayId);
  if (!alreadyOwnedByThisStandby) {
    runCutDay[`${field}BeforeStandby`] = runCutDay[field] ?? emptyValue;
    runCutDay[`${field}OverrideBeforeStandby`] = Boolean(runCutDay.overrides?.[field]);
  }
  runCutDay[field] = newValue ?? emptyValue;
  runCutDay[standbyDayField] = standbyRunCutDayId;
  if (runCutDay.overrides) runCutDay.overrides[field] = true;
};

const restoreStandbyOwnedField = (runCutDay, standbyRunCutDayId, field) => {
  const { emptyValue } = STANDBY_OWNED_FIELDS[field];
  const standbyDayField = `${field}StandbyDay`;
  if (String(runCutDay[standbyDayField] || "") !== String(standbyRunCutDayId)) return false;

  runCutDay[field] = runCutDay[`${field}BeforeStandby`] ?? emptyValue;
  if (runCutDay.overrides) {
    runCutDay.overrides[field] = Boolean(runCutDay[`${field}OverrideBeforeStandby`]);
  }
  runCutDay[standbyDayField] = null;
  runCutDay[`${field}BeforeStandby`] = emptyValue;
  runCutDay[`${field}OverrideBeforeStandby`] = false;
  return true;
};

// Covering a route with standby means that duty is operating. Keep the
// route's status and final outcome aligned in the same update, and supply
// whichever of pulloutAddress/operator/vehicle the caller passes (a field
// left undefined is not touched at all — see resolveStandbyPulloutAddress
// for why a division can ask pulloutAddress to be skipped this way).
export const activateRouteWithStandbyCoverage = (
  runCutDay,
  standbyRunCutDayId,
  { pulloutAddress, operator, vehicle } = {}
) => {
  const alreadyOwnsRouteState =
    String(runCutDay.routeStateStandbyDay || "") === String(standbyRunCutDayId);
  if (!alreadyOwnsRouteState) {
    runCutDay.routeStateStandbyDay = standbyRunCutDayId;
    runCutDay.statusBeforeStandby = runCutDay.status;
    runCutDay.statusOverrideBeforeStandby = Boolean(runCutDay.overrides?.status);
    runCutDay.serviceHoursBeforeStandby = runCutDay.serviceHours ?? 0;
    runCutDay.revenueHoursBeforeStandby = runCutDay.revenueHours ?? 0;
    runCutDay.dispositionBeforeStandby = runCutDay.disposition || null;
    runCutDay.dispositionSourceBeforeStandby = runCutDay.dispositionSource || null;
    runCutDay.dispositionStandbyDayBeforeStandby = runCutDay.dispositionStandbyDay || null;
  }

  runCutDay.status = "active";
  runCutDay.disposition = STANDBY_DISPOSITION;
  runCutDay.dispositionSource = "standby";
  runCutDay.dispositionStandbyDay = standbyRunCutDayId;

  applyStandbyOwnedField(runCutDay, standbyRunCutDayId, "pulloutAddress", pulloutAddress);
  applyStandbyOwnedField(runCutDay, standbyRunCutDayId, "operator", operator);
  applyStandbyOwnedField(runCutDay, standbyRunCutDayId, "vehicle", vehicle);
};

export const removeStandbyCoverageFromRoute = (runCutDay, standbyRunCutDayId) => {
  let changed = false;
  const standbyOwnsRouteState =
    String(runCutDay.routeStateStandbyDay || "") === String(standbyRunCutDayId);
  const standbyOwnsDisposition =
    runCutDay.disposition === STANDBY_DISPOSITION &&
    runCutDay.dispositionSource === "standby" &&
    String(runCutDay.dispositionStandbyDay || "") === String(standbyRunCutDayId);

  if (standbyOwnsRouteState) {
    runCutDay.status = runCutDay.statusBeforeStandby;
    if (runCutDay.overrides) {
      runCutDay.overrides.status = Boolean(runCutDay.statusOverrideBeforeStandby);
    }
    runCutDay.serviceHours = runCutDay.serviceHoursBeforeStandby ?? 0;
    runCutDay.revenueHours = runCutDay.revenueHoursBeforeStandby ?? 0;
    // Disposition is only reverted here if the standby still owns it — a
    // dispatcher can manually change or clear a standby-set disposition
    // (see updateRunCutDayException) without removing the coverage itself,
    // and that manual choice must survive the coverage being removed later.
    if (standbyOwnsDisposition) {
      runCutDay.disposition = runCutDay.dispositionBeforeStandby || null;
      runCutDay.dispositionSource = runCutDay.dispositionSourceBeforeStandby || null;
      runCutDay.dispositionStandbyDay = runCutDay.dispositionStandbyDayBeforeStandby || null;
    }

    runCutDay.routeStateStandbyDay = null;
    runCutDay.statusBeforeStandby = null;
    runCutDay.statusOverrideBeforeStandby = false;
    runCutDay.serviceHoursBeforeStandby = null;
    runCutDay.revenueHoursBeforeStandby = null;
    runCutDay.dispositionBeforeStandby = null;
    runCutDay.dispositionSourceBeforeStandby = null;
    runCutDay.dispositionStandbyDayBeforeStandby = null;
    changed = true;
  } else if (standbyOwnsDisposition) {
    runCutDay.disposition = null;
    runCutDay.dispositionSource = null;
    runCutDay.dispositionStandbyDay = null;
    changed = true;
  }

  changed = restoreStandbyOwnedField(runCutDay, standbyRunCutDayId, "pulloutAddress") || changed;
  changed = restoreStandbyOwnedField(runCutDay, standbyRunCutDayId, "operator") || changed;
  changed = restoreStandbyOwnedField(runCutDay, standbyRunCutDayId, "vehicle") || changed;

  return changed;
};
