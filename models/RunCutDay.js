import mongoose from "../db/sqlMongoose.js";
import { RUN_CUT_STATUSES } from "../utils/hours.js";
import { DISRUPTION_TYPES } from "../utils/disruptionTypes.js";
import { DISPOSITION_TYPES } from "../utils/dispositions.js";

const runCutDaySchema = new mongoose.Schema(
  {
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      required: true,
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Route",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    operator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Operator",
      default: null,
    },
    // When standby coverage temporarily supplies this route's operator,
    // retain the route-day value that was replaced so removing or moving
    // that coverage can restore it without losing a manual override.
    operatorStandbyDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RunCutDay",
      default: null,
    },
    operatorBeforeStandby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Operator",
      default: null,
    },
    operatorOverrideBeforeStandby: {
      type: Boolean,
      default: false,
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },
    // Same idea as operatorStandbyDay, for the vehicle field.
    vehicleStandbyDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RunCutDay",
      default: null,
    },
    vehicleBeforeStandby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },
    vehicleOverrideBeforeStandby: {
      type: Boolean,
      default: false,
    },
    pulloutAddress: {
      type: String,
      trim: true,
      default: "",
    },
    // Same idea as operatorStandbyDay, for the pullout address field.
    pulloutAddressStandbyDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RunCutDay",
      default: null,
    },
    pulloutAddressBeforeStandby: {
      type: String,
      trim: true,
      default: "",
    },
    pulloutAddressOverrideBeforeStandby: {
      type: Boolean,
      default: false,
    },
    startTime: {
      type: String,
      default: null,
    },
    endTime: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: RUN_CUT_STATUSES,
      default: "active",
    },
    serviceHours: {
      type: Number,
      default: 0,
    },
    revenueHours: {
      type: Number,
      default: 0,
    },
    clientNotes: {
      type: String,
      trim: true,
      default: "",
    },
    disruptionType: {
      type: String,
      enum: [...DISRUPTION_TYPES, null],
      default: null,
    },
    disruptionNotes: {
      type: String,
      trim: true,
      default: "",
    },
    // The route's final outcome for this specific live day. This is kept
    // separate from disruptionType, which remains an Issue Log category.
    disposition: {
      type: String,
      enum: [...DISPOSITION_TYPES, null],
      default: null,
    },
    dispositionSource: {
      type: String,
      enum: ["manual", "standby", "status", null],
      default: null,
    },
    // Set only when standby coverage assigned this disposition, allowing
    // that exact assignment to safely clear it when coverage is removed.
    dispositionStandbyDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RunCutDay",
      default: null,
    },
    // Standby coverage temporarily activates a route and recalculates its
    // hours. Keep an owner-scoped snapshot so removing or moving that exact
    // standby restores the route-day without stealing a pre-existing status
    // override or losing its prior disposition ownership.
    routeStateStandbyDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RunCutDay",
      default: null,
    },
    statusBeforeStandby: {
      type: String,
      enum: [...RUN_CUT_STATUSES, null],
      default: null,
    },
    statusOverrideBeforeStandby: {
      type: Boolean,
      default: false,
    },
    serviceHoursBeforeStandby: {
      type: Number,
      default: null,
    },
    revenueHoursBeforeStandby: {
      type: Number,
      default: null,
    },
    dispositionBeforeStandby: {
      type: String,
      enum: [...DISPOSITION_TYPES, null],
      default: null,
    },
    dispositionSourceBeforeStandby: {
      type: String,
      enum: ["manual", "standby", "status", null],
      default: null,
    },
    dispositionStandbyDayBeforeStandby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RunCutDay",
      default: null,
    },
    deployed: {
      type: Boolean,
      default: false,
    },
    // Which actual route a deployed standby is covering that day — only
    // meaningful when deployed is true and this route itself is a standby
    // route; cleared whenever deployed is set back to false.
    coveringRoute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Route",
      default: null,
    },
    // A one-off duty Deployment added for this date only (an operator
    // picking up extra revenue on a route that isn't normally scheduled
    // that day) — never generated by the persistent RunCut projection, and
    // protected from its cleanup pass so it isn't swept away as "no longer
    // scheduled."
    isExtra: {
      type: Boolean,
      default: false,
    },
    // Marks fields Deployment has overridden for this specific date, so the
    // daily projection from the persistent RunCut assignment leaves them
    // alone instead of overwriting them — a Deployment-side exception
    // applies to this day only, never the ongoing schedule.
    overrides: {
      operator: { type: Boolean, default: false },
      vehicle: { type: Boolean, default: false },
      pulloutAddress: { type: Boolean, default: false },
      startTime: { type: Boolean, default: false },
      endTime: { type: Boolean, default: false },
      status: { type: Boolean, default: false },
      clientNotes: { type: Boolean, default: false },
      disruption: { type: Boolean, default: false },
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

runCutDaySchema.index({ division: 1, route: 1, date: 1 }, { unique: true });
runCutDaySchema.index({ division: 1, date: 1 });
runCutDaySchema.index({ operator: 1, date: 1 });
runCutDaySchema.index({ vehicle: 1, date: 1 });
runCutDaySchema.index(
  { date: 1, coveringRoute: 1 },
  {
    unique: true,
    partialFilterExpression: { deployed: true, coveringRoute: { $type: "objectId" } },
    name: "one_deployed_standby_per_covered_route_global",
  }
);

const RunCutDay = mongoose.model("RunCutDay", runCutDaySchema);

export default RunCutDay;
