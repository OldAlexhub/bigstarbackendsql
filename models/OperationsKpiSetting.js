import mongoose from "../db/sqlMongoose.js";
import { KPI_KEYS } from "../utils/operationsKpis.js";

const operationsKpiSettingSchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    kpiKey: { type: String, enum: KPI_KEYS, required: true },
    effectiveMonth: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    direction: { type: String, enum: ["higher", "lower"], required: true },
    target: { type: Number, required: true },
    redCutoff: { type: Number, required: true },
    assignedManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

operationsKpiSettingSchema.index(
  { division: 1, kpiKey: 1, effectiveMonth: 1 },
  { unique: true, name: "uniq_operations_kpi_setting_period" }
);
operationsKpiSettingSchema.index({ division: 1, kpiKey: 1, effectiveMonth: -1 });

export default mongoose.model("OperationsKpiSetting", operationsKpiSettingSchema);
