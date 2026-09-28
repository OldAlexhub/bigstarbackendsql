import Operator from "../models/Operator.js";
import RunCut from "../models/RunCut.js";
import RunCutDay from "../models/RunCutDay.js";
import { escapeRegex, normalizeName } from "./normalizeText.js";

const operatorKey = (value) => String(value?._id || value);

// Older installations stored drivers company-wide. Build the new
// division-owned roster from the current Master Run Cuts, preserving the
// existing operator record for its first division and cloning it only when
// the same legacy record was used by more than one division.
export const backfillAssignmentRosters = async () => {
  const runCuts = await RunCut.find({ operator: { $ne: null } })
    .select("division operator pulloutAddress")
    .lean();
  const byOperator = new Map();

  for (const runCut of runCuts) {
    const key = operatorKey(runCut.operator);
    if (!byOperator.has(key)) byOperator.set(key, new Map());
    const divisions = byOperator.get(key);
    const divisionKey = String(runCut.division);
    const current = divisions.get(divisionKey) || { division: runCut.division, pulloutAddress: "" };
    if (!current.pulloutAddress && runCut.pulloutAddress) current.pulloutAddress = runCut.pulloutAddress;
    divisions.set(divisionKey, current);
  }

  let updatedOperators = 0;
  let rewiredAssignments = 0;
  for (const [sourceId, divisionMap] of byOperator) {
    const source = await Operator.findById(sourceId);
    if (!source) continue;

    const assignments = [...divisionMap.values()].sort((a, b) => {
      if (String(a.division) === String(source.division)) return -1;
      if (String(b.division) === String(source.division)) return 1;
      return String(a.division).localeCompare(String(b.division));
    });

    for (const [index, assignment] of assignments.entries()) {
      const name = normalizeName(source.name);
      let target = await Operator.findOne({
        division: assignment.division,
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
      });

      if (!target && !source.division && index === 0) {
        source.division = assignment.division;
        source.name = name;
        if (!source.pulloutAddress) source.pulloutAddress = assignment.pulloutAddress;
        await source.save();
        target = source;
        updatedOperators += 1;
      } else if (!target && String(source.division) === String(assignment.division)) {
        target = source;
      } else if (!target) {
        target = await Operator.create({
          division: assignment.division,
          name,
          pulloutAddress: assignment.pulloutAddress || source.pulloutAddress || "",
          employeeId: source.employeeId,
          provider: source.provider,
          active: source.active,
        });
        updatedOperators += 1;
      }

      if (!target.pulloutAddress && assignment.pulloutAddress) {
        target.pulloutAddress = assignment.pulloutAddress;
        await target.save();
        updatedOperators += 1;
      }

      if (String(target._id) !== sourceId) {
        const [runCutResult, dayResult] = await Promise.all([
          RunCut.updateMany(
            { division: assignment.division, operator: source._id },
            { $set: { operator: target._id } }
          ),
          RunCutDay.updateMany(
            { division: assignment.division, operator: source._id },
            { $set: { operator: target._id } }
          ),
        ]);
        rewiredAssignments += (runCutResult.modifiedCount || 0) + (dayResult.modifiedCount || 0);
      }
    }

    const stillScheduled =
      (await RunCut.exists({ operator: source._id })) ||
      (await RunCutDay.exists({ operator: source._id }));
    if (!stillScheduled && source.division) {
      const canonical = await Operator.findOne({
        _id: { $ne: source._id },
        division: source.division,
        name: new RegExp(`^${escapeRegex(normalizeName(source.name))}$`, "i"),
      });
      if (canonical) {
        // Keep the legacy record available to historical issue/report
        // references while excluding it from the live division roster.
        await Operator.collection.updateOne({ _id: source._id }, { $unset: { division: "" } });
        updatedOperators += 1;
      }
    }
  }

  return { updatedOperators, rewiredAssignments };
};
