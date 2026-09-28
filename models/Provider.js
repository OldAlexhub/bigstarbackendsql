import mongoose from "../db/sqlMongoose.js";

const providerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    manager: {
      type: String,
      trim: true,
      default: "",
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const Provider = mongoose.model("Provider", providerSchema);

export default Provider;
