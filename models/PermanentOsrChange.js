import mongoose from "../db/sqlMongoose.js";
import { DAYS_OF_WEEK, RUN_CUT_STATUSES } from "../utils/hours.js";
import { DISRUPTION_TYPES } from "../utils/disruptionTypes.js";

const permanentOsrChangeSchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    runCut: { type: mongoose.Schema.Types.ObjectId, ref: "RunCut", required: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: "Route", required: true },
    routeCode: { type: String, trim: true, required: true },
    effectiveDate: { type: Date, required: true },
    editableFields: [{ type: String, required: true }],
    daysOfWeek: [{ type: String, enum: DAYS_OF_WEEK }],
    operator: { type: mongoose.Schema.Types.ObjectId, ref: "Operator", default: null },
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },
    pulloutAddress: { type: String, trim: true, default: "" },
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
    runCutStatus: { type: String, enum: RUN_CUT_STATUSES, default: "active" },
    clientNotes: { type: String, trim: true, default: "" },
    disruptionType: { type: String, enum: [...DISRUPTION_TYPES, null], default: null },
    disruptionNotes: { type: String, trim: true, required: true },
    applicationStatus: {
      type: String,
      enum: ["scheduled", "applied"],
      default: "scheduled",
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    appliedAt: { type: Date, default: null },
    applicationError: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

permanentOsrChangeSchema.index({ division: 1, effectiveDate: 1, applicationStatus: 1 });
permanentOsrChangeSchema.index(
  { runCut: 1 },
  {
    unique: true,
    partialFilterExpression: { applicationStatus: "scheduled" },
    name: "one_scheduled_permanent_osr_per_run_cut",
  }
);

export default mongoose.model("PermanentOsrChange", permanentOsrChangeSchema);
