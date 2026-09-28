import DailyIssueLog from "../models/DailyIssueLog.js";

const objectIdString = (value) => String(value?._id || value || "");

const identityKey = ({ division, date, route, operator, disruptionType }) =>
  [
    objectIdString(division),
    new Date(date).toISOString(),
    objectIdString(route),
    objectIdString(operator),
    disruptionType,
  ].join("|");

const identityFilter = ({ runCutDay, disruptionType }) => ({
  division: runCutDay.division,
  date: runCutDay.date,
  route: runCutDay.route,
  operator: runCutDay.operator || null,
  disruptionType,
});

const desiredIssuesFor = (runCutDay) => {
  const desired = new Map();
  const statusDisruptionType =
    runCutDay.status === "suspended"
      ? "Unperformed Duty"
      : runCutDay.status === "off"
      ? "Route Closed"
      : null;

  // Status takes precedence as the retained provenance tag when status and
  // the disruption dropdown resolve to the same visible issue identity.
  if (statusDisruptionType) {
    desired.set(statusDisruptionType, { disruptionType: statusDisruptionType, tag: "status_suspended" });
  }
  if (runCutDay.disruptionType && !desired.has(runCutDay.disruptionType)) {
    desired.set(runCutDay.disruptionType, {
      disruptionType: runCutDay.disruptionType,
      tag: "disruption_dropdown",
    });
  }

  return [...desired.values()];
};

const isDuplicateKeyOnlyError = (error) => {
  const writeErrors = error?.writeErrors || error?.result?.getWriteErrors?.() || [];
  const writeConcernErrors = error?.writeConcernErrors || error?.result?.getWriteConcernErrors?.() || [];
  if (writeConcernErrors.length) return false;
  if (writeErrors.length) return writeErrors.every((writeError) => writeError.code === 11000);
  return error?.code === 11000;
};

const syncAutoIssues = async (runCutDays, userId, canRetry) => {
  const plans = runCutDays.map((runCutDay) => ({
    runCutDay,
    desired: desiredIssuesFor(runCutDay),
  }));
  const identities = plans.flatMap(({ runCutDay, desired }) =>
    desired.map(({ disruptionType }) => identityFilter({ runCutDay, disruptionType }))
  );

  // Manual entries are authoritative. Discover them before building the
  // generated writes so matching automatic rows are removed instead of
  // recreated under a different source tag.
  const manualIssues = identities.length
    ? await DailyIssueLog.find({ autoSyncTag: null, $or: identities })
        .select("division date route operator disruptionType")
        .lean()
    : [];
  const manualKeys = new Set(manualIssues.map(identityKey));
  const ops = [];

  for (const { runCutDay, desired } of plans) {
    const desiredTypes = desired.map(({ disruptionType }) => disruptionType);
    ops.push({
      deleteMany: {
        filter: {
          runCutDay: runCutDay._id,
          autoSyncTag: { $ne: null },
          ...(desiredTypes.length ? { disruptionType: { $nin: desiredTypes } } : {}),
        },
      },
    });

    const notes = [
      ...new Set(
        [runCutDay.clientNotes, runCutDay.disruptionNotes]
          .map((value) => value?.trim())
          .filter(Boolean)
      ),
    ].join(" — ");

    for (const { disruptionType, tag } of desired) {
      const identity = identityFilter({ runCutDay, disruptionType });
      if (manualKeys.has(identityKey(identity))) {
        ops.push({
          deleteMany: {
            filter: {
              runCutDay: runCutDay._id,
              autoSyncTag: { $ne: null },
              disruptionType,
            },
          },
        });
        continue;
      }

      ops.push({
        updateOne: {
          filter: {
            runCutDay: runCutDay._id,
            autoSyncTag: { $ne: null },
            disruptionType,
          },
          update: {
            $set: {
              ...identity,
              notes,
              createdBy: userId,
              runCutDay: runCutDay._id,
              autoSyncTag: tag,
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (!ops.length) return;

  try {
    await DailyIssueLog.bulkWrite(ops, { ordered: false });
  } catch (error) {
    // Rebuild the batch once after a uniqueness race. This is important when
    // the winning concurrent write is manual: the fresh lookup sees it and
    // replaces the automatic upsert with a cleanup operation.
    if (!canRetry || !isDuplicateKeyOnlyError(error)) throw error;
    await syncAutoIssues(runCutDays, userId, false);
  }
};

// Keeps Deployment's Issue Log synchronized with a live RunCutDay while
// producing at most one row for each visible issue identity. Status and the
// disruption dropdown may both describe the same event; those sources are
// collapsed before writing, and an existing manual record always wins.
export const syncAutoIssuesBulk = async (runCutDays, userId) =>
  syncAutoIssues(runCutDays, userId, true);
