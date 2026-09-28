import mongoose from "../db/sqlMongoose.js";
import bcrypt from "bcrypt";
import { PAGE_ACCESS } from "../utils/pageAccess.js";

export const SECTIONS = [
  "master_run_cuts",
  "deployment",
  "network_success",
  "customer_service",
  "safety",
  "operations_reporting",
];

// "ELT" is the only role that bypasses section/division checks everywhere
// in the app (see requireELT/canAccessDivision/divisionFilter in
// middleware/access.js) — the rest of the hierarchy is informational plus
// the basis for sections/divisionAccess, same as "staff" behaved before.
export const ROLES = ["ELT", "VP", "Director", "Sr Manager", "Manager", "Coordinator"];

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    department: {
      type: String,
      trim: true,
      default: "",
    },
    active: {
      type: Boolean,
      default: true,
    },
    role: {
      type: String,
      enum: ROLES,
      default: "Coordinator",
    },
    sections: {
      type: [String],
      enum: SECTIONS,
      default: [],
    },
    pageAccess: {
      type: [String],
      enum: PAGE_ACCESS,
      default: [],
    },
    pageAccessConfigured: {
      type: Boolean,
      default: false,
    },
    pageAccessLevels: {
      type: [{
        _id: false,
        page: { type: String, enum: PAGE_ACCESS, required: true },
        level: { type: String, enum: ["read", "write"], required: true },
      }],
      default: [],
    },
    divisionAccess: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Division",
      default: [],
    },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true, sparse: true });

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSessionJSON = function () {
  return {
    id: this._id,
    username: this.username,
    name: this.name,
    role: this.role,
    sections: this.sections,
    pageAccess: this.pageAccess,
    pageAccessConfigured: this.pageAccessConfigured,
    pageAccessLevels: Array.isArray(this.pageAccessLevels)
      ? Object.fromEntries(this.pageAccessLevels.map(({ page, level }) => [page, level]))
      : this.pageAccessLevels instanceof Map
        ? Object.fromEntries(this.pageAccessLevels)
        : this.pageAccessLevels || {},
    divisionAccess: this.divisionAccess,
  };
};

userSchema.methods.toPublicJSON = function () {
  return {
    ...this.toSessionJSON(),
    email: this.email,
    phone: this.phone,
    title: this.title,
    department: this.department,
    active: this.active,
  };
};

const User = mongoose.model("User", userSchema);

export default User;
