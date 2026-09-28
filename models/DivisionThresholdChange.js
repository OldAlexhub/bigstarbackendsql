import mongoose from "../db/sqlMongoose.js";

// A dated history of a division's break minutes / revenue ratio, so a
// change can be scheduled to start on a future date (or applied
// immediately) without rewriting what was true on any day that already
// happened. getEffectiveThresholds (server/utils/thresholds.js) always
// resolves the entry whose effectiveDate is the latest one on or before
// the date being calculated for.
const divisionThresholdChangeSchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    effectiveDate: { type: Date, required: true },
    breakMinutes: { type: Number, required: true },
    revenueRatio: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

divisionThresholdChangeSchema.index({ division: 1, effectiveDate: 1 }, { unique: true });

export default mongoose.model("DivisionThresholdChange", divisionThresholdChangeSchema);
