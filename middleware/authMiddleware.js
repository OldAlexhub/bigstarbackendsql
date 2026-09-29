import jwt from "jsonwebtoken";
import ApiAccessToken from "../models/ApiAccessToken.js";
import User from "../models/User.js";
import { hashApiAccessToken, isApiAccessToken } from "../utils/apiAccessTokens.js";
import { ELT_ROLE } from "../utils/roles.js";

export const getRequestToken = (req) => {
  return req.cookies?.token || null;
};

export const getBearerToken = (req) => {
  const authorization = req.headers?.authorization;
  if (typeof authorization !== "string") return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const authenticateApiAccessToken = async (req, res, accessToken) => {
  if (!["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase())) {
    return res.status(403).json({ message: "API access tokens are read-only." });
  }

  const token = await ApiAccessToken.findOne({
    tokenHash: hashApiAccessToken(accessToken),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).populate("user");
  const user = token?.user;
  if (!user || user.active === false || user.role === ELT_ROLE) {
    return res.status(401).json({ message: "Invalid or expired API access token." });
  }

  token.lastUsedAt = new Date();
  await token.save();
  req.user = user;
  req.authType = "api_access_token";
  req.apiAccessToken = token;
  return null;
};

export const protect = async (req, res, next) => {
  try {
    const bearerToken = getBearerToken(req);
    if (isApiAccessToken(bearerToken)) {
      const errorResponse = await authenticateApiAccessToken(req, res, bearerToken);
      if (errorResponse) return errorResponse;
      return next();
    }

    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Legacy session tokens did not include a purpose. Keep them valid until
    // they expire, but never allow a PIN challenge token to authorize a route.
    if (decoded.purpose && decoded.purpose !== "session") {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await User.findById(decoded.id);
    if (!user || !user.active) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Not authenticated" });
  }
};
