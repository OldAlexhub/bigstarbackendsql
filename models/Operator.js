import mongoose from "../db/sqlMongoose.js";
import { normalizeName } from "../utils/normalizeText.js";

const operatorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      set: normalizeName,
    },
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    pulloutAddress: {
      type: String,
      trim: true,
      default: "",
      maxlength: 300,
    },
    employeeId: {
      type: String,
      trim: true,
      default: null,
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      default: null,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

operatorSchema.index(
  { division: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { division: { $type: "objectId" } },
    name: "one_operator_name_per_division",
  }
);

const Operator = mongoose.model("Operator", operatorSchema);

export default Operator;
