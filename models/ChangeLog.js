import mongoose from "../db/sqlMongoose.js";

const changeLogSchema = new mongoose.Schema({
  entityType: {
    type: String,
    required: true,
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  field: {
    type: String,
    required: true,
  },
  oldValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  newValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  changedAt: {
    type: Date,
    default: Date.now,
  },
});

changeLogSchema.index({ entityType: 1, entityId: 1, changedAt: -1 });

const ChangeLog = mongoose.model("ChangeLog", changeLogSchema);

export default ChangeLog;
