import mongoose from "../db/sqlMongoose.js";

const weeklyDivisionSummarySchema = new mongoose.Schema(
  {
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    weekStart: {
      type: Date,
      required: true,
    },
    revenueHoursScheduled: { type: Number, default: 0 },
    revenueHoursCovered: { type: Number, default: 0 },
    dutiesDeployed: { type: Number, default: 0 },
    dutiesScheduled: { type: Number, default: 0 },
    dutiesSuspended: { type: Number, default: 0 },
    dutiesUnassigned: { type: Number, default: 0 },
    volunteerDuties: { type: Number, default: 0 },
    standbyAvailable: { type: Number, default: 0 },
    standbyDeployed: { type: Number, default: 0 },
    coveragePct: { type: Number, default: 0 },
    finalized: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

weeklyDivisionSummarySchema.index({ division: 1, weekStart: 1 }, { unique: true });

const WeeklyDivisionSummary = mongoose.model("WeeklyDivisionSummary", weeklyDivisionSummarySchema);

export default WeeklyDivisionSummary;
