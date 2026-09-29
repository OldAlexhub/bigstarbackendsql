import { Router } from "express";
import { login, logout, me, resetPassword, setupPin, verifyPin } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";
import loginRateLimiter, {
  passwordResetAccountRateLimiter,
  sensitiveAuthRateLimiter,
} from "../middleware/loginRateLimiter.js";

const router = Router();

router.post("/login", loginRateLimiter, login);
router.post("/pin/setup", sensitiveAuthRateLimiter, setupPin);
router.post("/pin/verify", sensitiveAuthRateLimiter, verifyPin);
router.post("/password/reset", sensitiveAuthRateLimiter, passwordResetAccountRateLimiter, resetPassword);
router.post("/logout", logout);
router.get("/me", protect, me);

export default router;
