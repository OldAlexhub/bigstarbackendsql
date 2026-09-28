import mongoose from "../db/sqlMongoose.js";

const customerServiceEntrySchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    month: { type: String, required: true },
    complaints: { type: Number, required: true, min: 0 },
    compliments: { type: Number, required: true, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

customerServiceEntrySchema.index(
  { division: 1, month: 1 },
  { unique: true, name: "uniq_customer_service_division_month" }
);
customerServiceEntrySchema.index({ division: 1, month: -1 });

const CustomerServiceEntry = mongoose.model("CustomerServiceEntry", customerServiceEntrySchema);

export default CustomerServiceEntry;
