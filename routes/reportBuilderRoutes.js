import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess } from "../middleware/access.js";
import { exportBuiltReport, getReportBuilderPreview } from "../controllers/reportBuilderController.js";

const router = Router();

router.use(protect, requirePageAccess("report_builder"));
router.get("/", getReportBuilderPreview);
router.get("/export", exportBuiltReport);

export default router;
