import mongoose from "../db/sqlMongoose.js";
import bcrypt from "bcrypt";
import { PAGE_ACCESS } from "../utils/pageAccess.js";
import { SUPER_ADMIN_ROLE } from "../utils/roles.js";
import { isValidEmail, passwordValidationMessage } from "../utils/userCredentials.js";

export const SECTIONS = [
  "master_run_cuts",
  "deployment",
  "network_success",
  "customer_service",
  "safety",
  "operations_reporting",
];

// Global administration roles bypass operational section/division checks.
// API administration is separately restricted to Super Admin.
export const ROLES = [SUPER_ADMIN_ROLE, "ELT", "VP", "Director", "Sr Manager", "Manager", "Coordinator"];

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
      validate: {
        validator(value) {
          return !passwordValidationMessage(value, {
            username: this.username,
            email: this.email,
            allowHash: true,
          });
        },
        message: (props) => passwordValidationMessage(props.value, { allowHash: true }) || "Invalid password.",
      },
    },
    pinHash: {
      type: String,
      select: false,
      default: null,
      relationalAddIfMissing: true,
    },
    pinConfiguredAt: {
      type: Date,
      default: null,
      relationalAddIfMissing: true,
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
      maxlength: 254,
      validate: {
        validator: (value) => value == null || value === "" || isValidEmail(value),
        message: "Enter a valid email address.",
      },
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

userSchema.methods.setPin = async function (pin) {
  this.pinHash = await bcrypt.hash(pin, 12);
  this.pinConfiguredAt = new Date();
};

userSchema.methods.comparePin = function (candidate) {
  if (!this.pinHash) return false;
  return bcrypt.compare(candidate, this.pinHash);
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
