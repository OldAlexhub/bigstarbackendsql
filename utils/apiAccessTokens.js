import crypto from "node:crypto";

export const API_ACCESS_TOKEN_PREFIX = "cmp_live_";
const TOKEN_PATTERN = /^cmp_live_[A-Za-z0-9_-]{43}$/;

export const generateApiAccessToken = () =>
  `${API_ACCESS_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;

export const hashApiAccessToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

export const isApiAccessToken = (token) => TOKEN_PATTERN.test(String(token || ""));

export const apiAccessTokenPrefix = (token) => String(token).slice(0, 17);

