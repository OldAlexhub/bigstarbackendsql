import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess } from "../middleware/access.js";
import { getLeaderboard, exportLeaderboardPdf } from "../controllers/leaderboardController.js";

const router = Router();

router.use(protect, requirePageAccess("leaderboard"));

router.get("/", getLeaderboard);
router.get("/export", exportLeaderboardPdf);

export default router;
