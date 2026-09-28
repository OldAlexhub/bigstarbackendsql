import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess, requirePageWrite } from "../middleware/access.js";
import {
  listDailyIssues,
  listDailyIssuesReport,
  exportDailyIssues,
  createDailyIssue,
  updateDailyIssue,
  deleteDailyIssue,
} from "../controllers/dailyIssuesController.js";

const router = Router();

router.use(protect);

router.get("/", requirePageAccess("deployment.issue_log"), listDailyIssues);
router.get("/report", requirePageAccess("deployment.reporting"), listDailyIssuesReport);
router.get("/export", requirePageAccess("deployment.reporting"), exportDailyIssues);
router.post("/", requirePageWrite("deployment.issue_log"), createDailyIssue);
router.patch("/:id", requirePageWrite("deployment.issue_log"), updateDailyIssue);
router.delete("/:id", requirePageWrite("deployment.issue_log"), deleteDailyIssue);

export default router;
