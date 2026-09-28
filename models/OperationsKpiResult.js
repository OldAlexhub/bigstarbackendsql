import mongoose from "../db/sqlMongoose.js";
import { KPI_KEYS } from "../utils/operationsKpis.js";

const operationsKpiResultSchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    kpiKey: { type: String, enum: KPI_KEYS, required: true },
    month: { type: String, required: true },
    value: { type: Number, default: null },
    numerator: { type: Number, default: null },
    denominator: { type: Number, default: null },
    status: { type: String, enum: ["no_data", "green", "yellow", "red", "critical"], required: true },
    baseStatus: { type: String, enum: ["no_data", "green", "yellow", "red"], required: true },
    closed: { type: Boolean, required: true },
    setting: {
      enabled: Boolean,
      direction: { type: String, enum: ["higher", "lower"] },
      target: Number,
      redCutoff: Number,
      effectiveMonth: String,
      assignedManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    recalculatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

operationsKpiResultSchema.index(
  { division: 1, kpiKey: 1, month: 1 },
  { unique: true, name: "uniq_operations_kpi_result" }
);
operationsKpiResultSchema.index({ month: -1, division: 1 });

export default mongoose.model("OperationsKpiResult", operationsKpiResultSchema);
