import mongoose from "../db/sqlMongoose.js";

const retentionCleanupLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true, default: Date.now },
    recordsDeleted: { type: Number, required: true, min: 0, default: 0 },
    recordsCleaned: { type: Number, required: true, min: 0, default: 0 },
    errors: { type: [String], default: [] },
    success: { type: Boolean, required: true },
  },
  { versionKey: false, suppressReservedKeysWarning: true }
);

retentionCleanupLogSchema.index({ timestamp: -1 });

export default mongoose.model("RetentionCleanupLog", retentionCleanupLogSchema);
