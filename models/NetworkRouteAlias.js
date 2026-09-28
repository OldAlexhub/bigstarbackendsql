import mongoose from "../db/sqlMongoose.js";

const networkRouteAliasSchema = new mongoose.Schema(
  {
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", required: true },
    source: { type: String, enum: ["vision", "ecolane", "spare", "rideco"], required: true },
    normalizedSourceRoute: { type: String, required: true },
    sourceRoute: { type: String, required: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: "Route", required: true },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

networkRouteAliasSchema.index(
  { division: 1, source: 1, normalizedSourceRoute: 1 },
  { unique: true, name: "uniq_network_route_alias" }
);

const NetworkRouteAlias = mongoose.model("NetworkRouteAlias", networkRouteAliasSchema);
export default NetworkRouteAlias;
