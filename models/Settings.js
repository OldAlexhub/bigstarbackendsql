import mongoose from "../db/sqlMongoose.js";

export const RETENTION_UNITS = ["days", "months", "years", "indefinite"];

const retentionPeriod = (defaultValue) => ({
  value: {
    type: Number,
    min: 1,
    max: 10000,
    validate: {
      validator: Number.isInteger,
      message: "Retention values must be whole numbers",
    },
    default: defaultValue,
  },
  unit: {
    type: String,
    enum: RETENTION_UNITS,
    default: "years",
  },
});

const settingsSchema = new mongoose.Schema(
  {
    osrAdvanceDays: {
      type: Number,
      min: 0,
      max: 7,
      validate: {
        validator: Number.isInteger,
        message: "OSR advance days must be a whole number",
      },
      default: 7,
    },
    scheduleHistoryLookbackWeeks: {
      type: Number,
      min: 1,
      max: 12,
      validate: {
        validator: Number.isInteger,
        message: "Schedule History lookback weeks must be a whole number",
      },
      default: 6,
    },
    operationsReportingStartMonth: {
      type: String,
      default: () => new Date().toISOString().slice(0, 7),
    },
    dataRetention: {
      enabled: { type: Boolean, default: false },
      operationalHistory: retentionPeriod(7),
      auditLogs: retentionPeriod(7),
      teamPosts: retentionPeriod(3),
      networkSubmissionStaging: retentionPeriod(1),
    },
  },
  { timestamps: true }
);

settingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  } else if (!doc.operationsReportingStartMonth || doc.$isDefault?.("operationsReportingStartMonth")) {
    doc.operationsReportingStartMonth = new Date().toISOString().slice(0, 7);
    await doc.save();
  }
  return doc;
};

const Settings = mongoose.model("Settings", settingsSchema);

export default Settings;
