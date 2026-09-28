import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requireAnyPageWrite, requirePageWrite } from "../middleware/access.js";
import {
  listRunCutDays,
  setRunCutDayDeployed,
  updateRunCutDayException,
  createExtraRunCutDay,
  deleteExtraRunCutDay,
} from "../controllers/runCutDaysController.js";

const router = Router();

router.use(protect);

const schedulePages = [
  "deployment.live_schedule",
  "deployment.standby_utilization",
  "deployment.reporting",
  "deployment.schedule_history",
];

router.get("/", requireAnyPageAccess(schedulePages), listRunCutDays);
router.post("/", requirePageWrite("deployment.live_schedule"), createExtraRunCutDay);
router.patch("/:id/deployed", requirePageWrite("deployment.live_schedule"), setRunCutDayDeployed);
router.patch("/:id", requireAnyPageWrite(["deployment.live_schedule", "deployment.schedule_history"]), updateRunCutDayException);
router.delete("/:id", requirePageWrite("deployment.live_schedule"), deleteExtraRunCutDay);

export default router;
