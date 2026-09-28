import mongoose from "../db/sqlMongoose.js";
import { TIMEZONES, DEFAULT_TIMEZONE } from "../utils/timezone.js";

const divisionSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["standard", "standby"],
      default: "standard",
    },
    // Drives every "today"/"this week" boundary for this division's
    // schedule (RunCutDay generation, Deployment's Today/Tomorrow, Dashboard
    // stats) — see server/utils/timezone.js.
    timezone: {
      type: String,
      enum: TIMEZONES,
      default: DEFAULT_TIMEZONE,
    },
    parentDivision: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      default: null,
    },
    active: {
      type: Boolean,
      default: true,
    },
    // Every division owns these outright — there is no company-wide fallback,
    // since standards genuinely differ by division and can diverge further
    // over time even when they currently happen to match.
    thresholds: {
      breakMinutes: { type: Number, required: true },
      revenueRatio: { type: Number, required: true },
    },
    // Division-specific handling for how a standby's coverage of a route
    // here affects pullout address — off by default (a standby's own
    // address is normally the right one to show). Turn standbyKeepsRouteAddress
    // on for a division whose pullout addresses are tied to the route
    // itself rather than to whichever driver is on it (e.g. Division 3
    // GoLink), so standby coverage doesn't overwrite it. editableInLiveSchedule
    // is independent: it lets Deployment correct a route's pullout address
    // directly in Live Schedule's today/tomorrow table, not just through the
    // OSR Planner or a Permanent OSR.
    pulloutAddressRules: {
      standbyKeepsRouteAddress: { type: Boolean, default: false },
      editableInLiveSchedule: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const Division = mongoose.model("Division", divisionSchema);

export default Division;
