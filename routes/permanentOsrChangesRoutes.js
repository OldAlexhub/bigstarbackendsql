import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess } from "../middleware/access.js";
import { listPermanentOsrChanges, exportPermanentOsrChanges } from "../controllers/permanentOsrChangesController.js";

const router = Router();

router.use(protect, requirePageAccess("deployment.permanent_osr"));

router.get("/", listPermanentOsrChanges);
router.get("/export", exportPermanentOsrChanges);

export default router;
