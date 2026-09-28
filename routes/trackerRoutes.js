import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess } from "../middleware/access.js";
import { getTracker, getTrackerAllDivisions } from "../controllers/trackerController.js";

const router = Router();

router.use(protect, requirePageAccess("master_run_cuts.tracker"));

router.get("/all", getTrackerAllDivisions);
router.get("/", getTracker);

export default router;
