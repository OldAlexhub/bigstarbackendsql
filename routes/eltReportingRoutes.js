import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess } from "../middleware/access.js";
import { getEltReport, exportEltReport } from "../controllers/eltReportingController.js";

const router = Router();

router.use(protect, requirePageAccess("elt_reporting.operations_report"));

router.get("/", getEltReport);
router.get("/export", exportEltReport);

export default router;
