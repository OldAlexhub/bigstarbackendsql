import mongoose from "../db/sqlMongoose.js";
import { DISRUPTION_TYPES } from "../utils/disruptionTypes.js";

const dailyIssueLogSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Route",
      default: null,
    },
    operator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Operator",
      default: null,
    },
    disruptionType: {
      type: String,
      enum: DISRUPTION_TYPES,
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    runCutDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RunCutDay",
      default: null,
    },
    autoSyncTag: {
      type: String,
      enum: ["status_suspended", "disruption_dropdown", null],
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

dailyIssueLogSchema.index({ division: 1, date: 1 });
dailyIssueLogSchema.index({ runCutDay: 1 });
dailyIssueLogSchema.index(
  { division: 1, date: 1, route: 1, operator: 1, disruptionType: 1 },
  {
    name: "uniq_issue_identity",
    unique: true,
  }
);

const DailyIssueLog = mongoose.model("DailyIssueLog", dailyIssueLogSchema);

export default DailyIssueLog;
