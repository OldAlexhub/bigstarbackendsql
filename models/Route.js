import mongoose from "../db/sqlMongoose.js";

const routeSchema = new mongoose.Schema(
  {
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    type: {
      type: String,
      enum: ["standard", "standby"],
      default: "standard",
    },
  },
  { timestamps: true }
);

routeSchema.index({ division: 1, code: 1 }, { unique: true });

const Route = mongoose.model("Route", routeSchema);

export default Route;
