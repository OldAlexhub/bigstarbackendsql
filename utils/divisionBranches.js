import Division from "../models/Division.js";

const DIVISION_3_SHARED_STANDBY_CODES = ["DIV_3", "DIV_3_GL", "DIV_3_SB"];

// Division 3 ADA and GoLink use the same existing standby pool. Resolve the
// pool by the canonical imported division codes so no standby records need to
// be moved, copied, or linked by a data migration.
export const getBranchGroupDivisionIds = async (divisionId) => {
  const division = await Division.findById(divisionId).select("_id code active");
  if (!division || division.active === false) return [];

  if (DIVISION_3_SHARED_STANDBY_CODES.includes(division.code)) {
    return Division.find({
      active: { $ne: false },
      code: { $in: DIVISION_3_SHARED_STANDBY_CODES },
    }).distinct("_id");
  }

  return [division._id];
};
