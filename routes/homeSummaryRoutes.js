import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess } from "../middleware/access.js";
import { getHomeSummary } from "../controllers/homeSummaryController.js";

const router = Router();

router.get("/", protect, requirePageAccess("dashboard"), getHomeSummary);

export default router;
