import mongoose from "../db/sqlMongoose.js";

const componentSchema = new mongoose.Schema(
  {
    sourceRow: Number,
    sourceRoute: String,
    sourceOperator: { type: String, default: null },
    completedTrips: { type: Number, required: true },
    reportedServiceHours: { type: Number, default: null },
    reportedRevenueHours: { type: Number, default: null },
    tpsh: { type: Number, default: null },
    otpPct: { type: Number, default: null },
    pickupOtpPct: { type: Number, default: null },
    dropoffOtpPct: { type: Number, default: null },
    zeroTrips: { type: Boolean, default: false },
    matchMethod: { type: String, default: null },
    manuallyResolved: { type: Boolean, default: false },
    operationalOutcome: { type: String, default: null },
    sourceFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const assignmentOverrideSchema = new mongoose.Schema(
  {
    operator: { type: mongoose.Schema.Types.ObjectId, ref: "Operator", default: null },
    operatorName: { type: String, default: null },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "Provider", default: null },
    providerName: { type: String, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false }
);

const networkKpiEntrySchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    source: { type: String, enum: ["vision", "ecolane", "spare", "rideco"], required: true },
    date: { type: String, required: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: "Route", required: true },
    submission: { type: mongoose.Schema.Types.ObjectId, ref: "NetworkSubmission", required: true },
    sourceRouteCodes: { type: [String], default: [] },
    components: { type: [componentSchema], default: [] },
    metrics: {
      completedTrips: { type: Number, required: true },
      reportedServiceHours: { type: Number, default: null },
      reportedRevenueHours: { type: Number, default: null },
      tpsh: { type: Number, default: null },
      otpPct: { type: Number, default: null },
    },
    matching: {
      methods: { type: [String], default: [] },
      manuallyResolved: { type: Boolean, default: false },
    },
    operationalOutcome: { type: String, required: true },
    zeroTrip: {
      zeroComponentCount: { type: Number, default: 0 },
      classification: { type: String, enum: ["operated", "closed_cancelled", "partially_closed"], required: true },
      deploymentConflict: { type: Boolean, default: false },
    },
    deployment: {
      runCutDay: { type: mongoose.Schema.Types.ObjectId, ref: "RunCutDay", default: null },
      canonicalRoute: { type: String, required: true },
      routeType: { type: String, default: null },
      operator: { type: mongoose.Schema.Types.ObjectId, ref: "Operator", default: null },
      operatorName: { type: String, default: null },
      provider: { type: mongoose.Schema.Types.ObjectId, ref: "Provider", default: null },
      providerName: { type: String, default: null },
      scheduledServiceHours: { type: Number, default: null },
      scheduledRevenueHours: { type: Number, default: null },
      status: { type: String, default: null },
      disposition: { type: String, default: null },
      lateToFirst: { type: Number, default: null },
      lateDeploy: { type: Number, default: null },
      provenance: { type: mongoose.Schema.Types.Mixed, default: {} },
      warning: { type: String, default: null },
      assignmentWarning: { type: String, default: null },
    },
    assignmentOverride: { type: assignmentOverrideSchema, default: null },
    assignmentAudit: { type: [mongoose.Schema.Types.Mixed], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

networkKpiEntrySchema.index(
  { division: 1, source: 1, date: 1, route: 1 },
  { unique: true, name: "uniq_network_kpi_entry" }
);
networkKpiEntrySchema.index({ division: 1, date: -1, source: 1 });

const NetworkKpiEntry = mongoose.model("NetworkKpiEntry", networkKpiEntrySchema);
export default NetworkKpiEntry;
