import { Router } from "express";
import { login, logout, me } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";
import loginRateLimiter from "../middleware/loginRateLimiter.js";

const router = Router();

router.post("/login", loginRateLimiter, login);
router.post("/logout", logout);
router.get("/me", protect, me);

export default router;
