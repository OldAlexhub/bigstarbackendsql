import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { SqlRateLimitStore } from "../utils/sqlRateLimitStore.js";

export const LOGIN_RATE_LIMIT_MAX = 20;
export const SENSITIVE_AUTH_RATE_LIMIT_MAX = 5;

const requestKey = (prefix) => (req) => `${prefix}:${ipKeyGenerator(req.ip)}`;

export const createLoginRateLimiter = ({ store = new SqlRateLimitStore() } = {}) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: LOGIN_RATE_LIMIT_MAX,
  store,
  keyGenerator: requestKey("login"),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many login attempts. Try again in 15 minutes." },
});

export const createSensitiveAuthRateLimiter = ({ store = new SqlRateLimitStore() } = {}) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: SENSITIVE_AUTH_RATE_LIMIT_MAX,
  store,
  keyGenerator: requestKey("sensitive-auth"),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many security-code attempts. Try again in 15 minutes." },
});

export const createPasswordResetAccountRateLimiter = ({ store = new SqlRateLimitStore() } = {}) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: SENSITIVE_AUTH_RATE_LIMIT_MAX,
  store,
  keyGenerator: (req) => `password-reset-account:${String(req.body?.email || "").trim().toLowerCase()}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many password-reset attempts. Try again in 15 minutes." },
});

const loginRateLimiter = createLoginRateLimiter();
export const sensitiveAuthRateLimiter = createSensitiveAuthRateLimiter();
export const passwordResetAccountRateLimiter = createPasswordResetAccountRateLimiter();

export default loginRateLimiter;
