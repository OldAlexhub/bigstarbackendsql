import mongoose from "../db/sqlMongoose.js";
import { DAYS_OF_WEEK, RUN_CUT_STATUSES } from "../utils/hours.js";
import { DISRUPTION_TYPES } from "../utils/disruptionTypes.js";

const runCutSchema = new mongoose.Schema(
  {
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Route",
      required: true,
    },
    daysOfWeek: {
      type: [String],
      enum: DAYS_OF_WEEK,
      default: [],
    },
    operator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Operator",
      default: null,
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },
    pulloutAddress: {
      type: String,
      trim: true,
      default: "",
    },
    startTime: {
      type: String,
      default: null,
    },
    endTime: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: RUN_CUT_STATUSES,
      default: "active",
    },
    serviceHours: {
      type: Number,
      default: 0,
    },
    revenueHours: {
      type: Number,
      default: 0,
    },
    clientNotes: {
      type: String,
      trim: true,
      default: "",
    },
    disruptionType: {
      type: String,
      enum: [...DISRUPTION_TYPES, null],
      default: null,
    },
    disruptionNotes: {
      type: String,
      trim: true,
      default: "",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// A canonical route can have more than one non-overlapping assignment.
// Route remains the single reporting identity; each RunCut is one schedule.
runCutSchema.index({ division: 1, route: 1 });
runCutSchema.index({ operator: 1 });
runCutSchema.index({ vehicle: 1 });

const RunCut = mongoose.model("RunCut", runCutSchema);

export default RunCut;
