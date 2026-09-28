import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess } from "../middleware/access.js";
import { getDailyScheduleReport } from "../controllers/dailyScheduleReportController.js";
import { getWorkOrderReport } from "../controllers/workOrderReportController.js";

const router = Router();

router.use(protect, requirePageAccess("deployment.client_report"));

router.get("/daily-schedule", getDailyScheduleReport);
router.get("/work-order", getWorkOrderReport);

export default router;
