import mongoose from "mongoose";
import ApiAccessToken from "../models/ApiAccessToken.js";
import User from "../models/User.js";
import {
  apiAccessTokenPrefix,
  generateApiAccessToken,
  hashApiAccessToken,
} from "../utils/apiAccessTokens.js";
import { ELT_ROLE, isSuperAdmin } from "../utils/roles.js";

const tokenJson = (token) => ({
  id: token._id,
  name: token.name,
  tokenPrefix: token.tokenPrefix,
  user: token.user
    ? {
        id: token.user._id || token.user,
        name: token.user.name || "Deleted user",
        username: token.user.username || null,
      }
    : null,
  createdBy: token.createdBy?.name || null,
  expiresAt: token.expiresAt,
  lastUsedAt: token.lastUsedAt,
  revokedAt: token.revokedAt,
  createdAt: token.createdAt,
});

export const listApiAccessTokens = async (_req, res) => {
  const tokens = await ApiAccessToken.find({})
    .populate("user", "name username active")
    .populate("createdBy", "name")
    .sort({ createdAt: -1 });
  res.json({ tokens: tokens.map(tokenJson) });
};

export const createApiAccessToken = async (req, res) => {
  const name = String(req.body.name || "").trim();
  const userId = req.body.userId;
  const expiresInDays = Number(req.body.expiresInDays ?? 90);
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ message: "Token name must be between 2 and 80 characters." });
  }
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ message: "Choose a valid service user." });
  }
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
    return res.status(400).json({ message: "Token lifetime must be between 1 and 365 days." });
  }

  const user = await User.findById(userId);
  if (!user || user.active === false) {
    return res.status(400).json({ message: "Choose an active service user." });
  }
  if (user.role === ELT_ROLE) {
    return res.status(400).json({ message: "ELT accounts cannot be used for API tokens." });
  }
  if (!isSuperAdmin(user) && (!user.pageAccessConfigured || !user.pageAccess?.length)) {
    return res.status(400).json({
      message: "The service user must have explicit read-only page permissions before a token can be issued.",
    });
  }

  const accessToken = generateApiAccessToken();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const token = await ApiAccessToken.create({
    name,
    tokenHash: hashApiAccessToken(accessToken),
    tokenPrefix: apiAccessTokenPrefix(accessToken),
    user: user._id,
    createdBy: req.user._id,
    expiresAt,
  });
  const responseToken = tokenJson(token);
  responseToken.user = { id: user._id, name: user.name, username: user.username };
  responseToken.createdBy = req.user.name || null;
  res.status(201).json({
    token: responseToken,
    accessToken,
    message: "Copy this token now. It cannot be displayed again.",
  });
};

export const revokeApiAccessToken = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid API token." });
  }
  const token = await ApiAccessToken.findById(req.params.id);
  if (!token) return res.status(404).json({ message: "API token not found." });
  if (!token.revokedAt) {
    token.revokedAt = new Date();
    await token.save();
  }
  await token.populate("user", "name username active");
  await token.populate("createdBy", "name");
  res.json({ token: tokenJson(token), message: "API token revoked." });
};
