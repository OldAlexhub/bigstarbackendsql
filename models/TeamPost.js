import mongoose from "../db/sqlMongoose.js";

export const POST_SECTIONS = ["network_success", "deployment"];

const teamPostSchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    fromSection: { type: String, enum: POST_SECTIONS, required: true },
    toSection: { type: String, enum: POST_SECTIONS, required: true },
    purpose: { type: String, required: true, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    body: { type: String, required: true, trim: true, maxlength: 120 },
    responseRequested: { type: Boolean, default: false },
    status: { type: String, enum: ["sent", "responded"], default: "sent" },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sentByName: { type: String, trim: true, default: "" },
    sentByUsername: { type: String, trim: true, default: "" },
    receivedSeenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    responseBody: { type: String, trim: true, maxlength: 120, default: "" },
    respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    respondedByName: { type: String, trim: true, default: "" },
    respondedByUsername: { type: String, trim: true, default: "" },
    respondedAt: { type: Date, default: null },
    responseSeenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

teamPostSchema.index({ division: 1, fromSection: 1, createdAt: -1 });
teamPostSchema.index({ division: 1, toSection: 1, createdAt: -1 });
teamPostSchema.index({ toSection: 1, receivedSeenBy: 1, createdAt: -1 });
teamPostSchema.index({ fromSection: 1, status: 1, responseSeenBy: 1, respondedAt: -1 });

export default mongoose.model("TeamPost", teamPostSchema);
