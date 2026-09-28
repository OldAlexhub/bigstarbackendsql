import mongoose from "../db/sqlMongoose.js";

// One row per action taken in Deployment (Live Schedule / Issue Log) — an
// append-only trail so a deleted extra run or a deleted issue still leaves a
// trace of who did it and when, which the underlying doc alone can't
// provide once it's gone. username/name are snapshotted at write time so the
// log stays readable even if the user's account is later renamed.
const deploymentActivityLogSchema = new mongoose.Schema(
  {
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    username: {
      type: String,
      default: "",
    },
    name: {
      type: String,
      default: "",
    },
    action: {
      type: String,
      required: true,
    },
    summary: {
      type: String,
      required: true,
    },
    // Populated only for actions with a structured before/after to show (so
    // far just a Permanent OSR) — one entry per field that changed, letting
    // a report list "from -> to" per field instead of parsing the summary
    // text. route/reason are snapshotted alongside for the same reports.
    route: {
      type: String,
      trim: true,
      default: "",
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    changes: {
      type: [
        {
          field: { type: String, trim: true },
          from: { type: String, trim: true, default: "" },
          to: { type: String, trim: true, default: "" },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

deploymentActivityLogSchema.index({ division: 1, createdAt: -1 });

const DeploymentActivityLog = mongoose.model("DeploymentActivityLog", deploymentActivityLogSchema);

export default DeploymentActivityLog;
