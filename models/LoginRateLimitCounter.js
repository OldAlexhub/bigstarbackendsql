import mongoose from "../db/sqlMongoose.js";

const loginRateLimitCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    totalHits: { type: Number, required: true, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

loginRateLimitCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("LoginRateLimitCounter", loginRateLimitCounterSchema);
