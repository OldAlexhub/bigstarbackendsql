import { rateLimit } from "express-rate-limit";
import { SqlRateLimitStore } from "../utils/sqlRateLimitStore.js";

export const LOGIN_RATE_LIMIT_MAX = 20;

export const createLoginRateLimiter = ({ store = new SqlRateLimitStore() } = {}) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: LOGIN_RATE_LIMIT_MAX,
  store,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many login attempts. Try again in 15 minutes." },
});

const loginRateLimiter = createLoginRateLimiter();

export default loginRateLimiter;
