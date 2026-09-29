import PermanentOsrChange from "../models/PermanentOsrChange.js";
import RunCut from "../models/RunCut.js";
import { addMonths } from "./operationsKpis.js";
import { queueOperationsRefresh } from "./operationsReporting.js";
import { applyRunCutEdit } from "./runCutEdits.js";
import { todayInTimezone } from "./timezone.js";
import { runInTransaction } from "./transaction.js";
import { httpError } from "./httpError.js";

export const isPermanentOsrDue = (change) =>
  new Date(change.effectiveDate) <= todayInTimezone(change.division?.timezone);

export const scheduledPermanentOsrBody = (change) => {
  const body = {};
  for (const field of change.editableFields || []) {
    if (field === "operator") body.operatorId = change.operator;
    else if (field === "vehicle") body.vehicleId = change.vehicle;
    else if (field === "status") body.status = change.runCutStatus;
    else body[field] = change[field];
  }
  return body;
};

const monthForDate = (date) => {
  const value = new Date(date);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const applyPermanentOsrChange = async (changeId) => {
  let divisionId = null;
  let effectiveDate = null;
  let applied = false;

  await runInTransaction(async () => {
    const change = await PermanentOsrChange.findOne({
      _id: changeId,
      applicationStatus: "scheduled",
    }).populate("division", "timezone");
    if (!change) throw httpError(409, "This permanent OSR has already been applied or is unavailable.");
    if (!isPermanentOsrDue(change)) return;

    divisionId = change.division?._id || change.division;
    effectiveDate = change.effectiveDate;
    const runCut = await RunCut.findById(change.runCut);
    if (!runCut || String(runCut.division) !== String(divisionId)) {
      throw httpError(409, "The Master Run Cut for this permanent OSR is no longer available.");
    }

    await applyRunCutEdit(runCut, scheduledPermanentOsrBody(change), change.requestedBy, {
      replaceDayOverrides: true,
    });
    change.applicationStatus = "applied";
    change.appliedAt = new Date();
    change.applicationError = "";
    await change.save();
    applied = true;
  });

  if (applied && divisionId) {
    const month = monthForDate(effectiveDate);
    queueOperationsRefresh(divisionId, month);
    queueOperationsRefresh(divisionId, addMonths(month, 1));
  }
  return applied;
};

export const applyDuePermanentOsrChanges = async () => {
  const scheduled = await PermanentOsrChange.find({ applicationStatus: "scheduled" }).populate(
    "division",
    "timezone active"
  );
  let applied = 0;

  for (const change of scheduled) {
    if (change.division?.active === false || !isPermanentOsrDue(change)) continue;
    try {
      if (await applyPermanentOsrChange(change._id)) applied += 1;
    } catch {
      await PermanentOsrChange.updateOne(
        { _id: change._id, applicationStatus: "scheduled" },
        { $set: { applicationError: "Automatic application failed." } }
      );
      console.error(`Permanent OSR ${change._id} could not be applied.`);
    }
  }

  return applied;
};
