import mongoose from "../db/sqlMongoose.js";
import { KPI_KEYS } from "../utils/operationsKpis.js";

const updateSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const auditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    changedAt: { type: Date, default: Date.now },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const correctiveActionPlanSchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    kpiKey: { type: String, enum: KPI_KEYS, required: true },
    triggerMonth: { type: String, required: true },
    firstEnteredAt: { type: Date, default: Date.now, immutable: true },
    valueAtCapDate: { type: Number, required: true },
    targetAtCap: { type: Number, required: true },
    redCutoffAtCap: { type: Number, required: true },
    directionAtCap: { type: String, enum: ["higher", "lower"], required: true },
    varianceAtCap: { type: Number, required: true },
    latestMonth: { type: String, required: true },
    latestValue: { type: Number, default: null },
    latestKpiStatus: { type: String, enum: ["no_data", "green", "yellow", "red", "critical"], required: true },
    status: { type: String, enum: ["open", "recovery_ready", "recovered"], default: "open" },
    activeEpisode: { type: Boolean, default: true },
    assignedManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rootCause: { type: String, trim: true, default: "" },
    correctiveAction: { type: String, trim: true, default: "" },
    ownerUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    ownerName: { type: String, trim: true, default: "" },
    plannedRecoveryDate: { type: Date, default: null },
    recoveryCandidate: {
      month: { type: String, default: null },
      value: { type: Number, default: null },
      date: { type: Date, default: null },
    },
    valueAtRecovery: { type: Number, default: null },
    dateRecoveryMet: { type: Date, default: null },
    recoveredAt: { type: Date, default: null },
    recoveredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updates: { type: [updateSchema], default: [] },
    audit: { type: [auditSchema], default: [] },
  },
  { timestamps: true }
);

correctiveActionPlanSchema.index(
  { division: 1, kpiKey: 1, triggerMonth: 1 },
  { unique: true, name: "uniq_cap_trigger_episode" }
);
correctiveActionPlanSchema.index(
  { division: 1, kpiKey: 1, activeEpisode: 1 },
  { unique: true, partialFilterExpression: { activeEpisode: true }, name: "uniq_active_cap_episode" }
);
correctiveActionPlanSchema.index({ assignedManager: 1, status: 1, latestMonth: -1 });

export default mongoose.model("CorrectiveActionPlan", correctiveActionPlanSchema);
