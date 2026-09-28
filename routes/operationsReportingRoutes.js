import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess, requirePageWrite } from "../middleware/access.js";
import {
  addCapNote,
  cancelCap,
  confirmCapRecovery,
  getCapReport,
  getMonthlyDashboard,
  getTracker,
  listCapNeeded,
  listCapPeople,
  listCaps,
  openCap,
  updateCap,
} from "../controllers/operationsReportingController.js";

const router = Router();

router.use(protect);
router.get("/tracker", requirePageAccess("operations_reporting.kpi_tracker"), getTracker);
router.get("/dashboard", requirePageAccess("operations_reporting.monthly_dashboard"), getMonthlyDashboard);
router.get("/caps/report", requirePageAccess("operations_reporting.cap_reporting"), getCapReport);
router.get("/caps", requirePageAccess("operations_reporting.cap"), listCaps);
router.get("/caps/needed", requirePageAccess("operations_reporting.cap"), listCapNeeded);
router.post("/caps", requirePageWrite("operations_reporting.cap"), openCap);
router.get("/people", requirePageAccess("operations_reporting.cap"), listCapPeople);
router.patch("/caps/:id", requirePageWrite("operations_reporting.cap"), updateCap);
router.delete("/caps/:id", requirePageWrite("operations_reporting.cap"), cancelCap);
router.post("/caps/:id/notes", requirePageWrite("operations_reporting.cap"), addCapNote);
router.post("/caps/:id/confirm-recovery", requirePageWrite("operations_reporting.cap"), confirmCapRecovery);

export default router;
