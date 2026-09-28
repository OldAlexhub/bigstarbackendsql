import mongoose from "../db/sqlMongoose.js";

const networkSubmissionSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ["vision", "ecolane", "spare", "rideco"], required: true },
    status: { type: String, enum: ["pending", "matched", "confirmed", "failed", "removed"], default: "pending" },
    files: [
      {
        _id: false,
        kind: { type: String, required: true },
        name: { type: String, required: true },
        size: { type: Number, required: true },
        sha256: { type: String, required: true },
      },
    ],
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", default: null },
    divisionCandidates: { type: [mongoose.Schema.Types.Mixed], default: [] },
    parsedRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    previewRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    blockedDates: { type: [mongoose.Schema.Types.Mixed], default: [] },
    reportDates: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    confirmedAt: { type: Date, default: null },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    removedAt: { type: Date, default: null },
    reopenedFrom: { type: mongoose.Schema.Types.ObjectId, ref: "NetworkSubmission", default: null },
    counts: {
      sourceRows: { type: Number, default: 0 },
      automaticMatches: { type: Number, default: 0 },
      routeBlockers: { type: Number, default: 0 },
      zeroTripRows: { type: Number, default: 0 },
      created: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      removed: { type: Number, default: 0 },
      excluded: { type: Number, default: 0 },
      incompleteEnrichment: { type: Number, default: 0 },
    },
    changeAudit: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

networkSubmissionSchema.index({ createdAt: -1 });
networkSubmissionSchema.index({ division: 1, source: 1, confirmedAt: -1 });
networkSubmissionSchema.index({ reopenedFrom: 1, status: 1 });

const NetworkSubmission = mongoose.model("NetworkSubmission", networkSubmissionSchema);
export default NetworkSubmission;
