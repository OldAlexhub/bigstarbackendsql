import mongoose from "../db/sqlMongoose.js";

const apiAccessTokenSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    tokenHash: { type: String, required: true, unique: true, select: false },
    tokenPrefix: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

apiAccessTokenSchema.index({ user: 1, revokedAt: 1 });
apiAccessTokenSchema.index({ expiresAt: 1 });

export default mongoose.model("ApiAccessToken", apiAccessTokenSchema);
