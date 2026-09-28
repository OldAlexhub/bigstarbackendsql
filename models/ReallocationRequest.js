import mongoose from "../db/sqlMongoose.js";

const reallocationRequestSchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    runCut: { type: mongoose.Schema.Types.ObjectId, ref: "RunCut", required: true },
    involvedRunCuts: [{ type: mongoose.Schema.Types.ObjectId, ref: "RunCut", required: true }],
    route: { type: mongoose.Schema.Types.ObjectId, ref: "Route", required: true },
    routeCode: { type: String, required: true, trim: true },
    destinationRunCut: { type: mongoose.Schema.Types.ObjectId, ref: "RunCut", default: null },
    destinationRoute: { type: mongoose.Schema.Types.ObjectId, ref: "Route", default: null },
    destinationRouteCode: { type: String, trim: true, default: "" },
    destinationOriginalOperatorName: { type: String, trim: true, default: "" },
    destinationOriginalVehicleCode: { type: String, trim: true, default: "" },
    destinationOriginalPulloutAddress: { type: String, trim: true, default: "" },
    originalOperatorName: { type: String, trim: true, default: "" },
    originalVehicleCode: { type: String, trim: true, default: "" },
    originalPulloutAddress: { type: String, trim: true, default: "" },
    requestedOperatorName: { type: String, trim: true, maxlength: 120, default: "" },
    requestedVehicleCode: { type: String, trim: true, maxlength: 50, default: "" },
    requestedPulloutAddress: { type: String, trim: true, maxlength: 300, default: "" },
    effectiveDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "applied"],
      default: "pending",
    },
    open: { type: Boolean, default: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    requestedByName: { type: String, trim: true, default: "" },
    requestedByUsername: { type: String, trim: true, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedByName: { type: String, trim: true, default: "" },
    reviewedByUsername: { type: String, trim: true, default: "" },
    reviewedAt: { type: Date, default: null },
    appliedAt: { type: Date, default: null },
    applicationError: { type: String, trim: true, default: "" },
    networkSeenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

reallocationRequestSchema.index({ division: 1, status: 1, createdAt: -1 });
reallocationRequestSchema.index({ status: 1, networkSeenBy: 1 });
reallocationRequestSchema.index(
  { involvedRunCuts: 1 },
  {
    unique: true,
    partialFilterExpression: { open: true },
    name: "one_open_reallocation_per_involved_run_cut",
  }
);

export default mongoose.model("ReallocationRequest", reallocationRequestSchema);
