import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess, requirePageWrite } from "../middleware/access.js";
import {
  deleteSafetyEntry,
  deleteSafetyScore,
  getSafetyAnalytics,
  listSafetyEntries,
  listSafetyScores,
  saveSafetyEntry,
  saveSafetyScore,
} from "../controllers/safetyController.js";

const router = Router();

router.use(protect);
router.get("/entries", requirePageAccess("safety.accidents"), listSafetyEntries);
router.put("/entries", requirePageWrite("safety.accidents"), saveSafetyEntry);
router.delete("/entries/:id", requirePageWrite("safety.accidents"), deleteSafetyEntry);
router.get("/scores", requirePageAccess("safety.scores"), listSafetyScores);
router.put("/scores", requirePageWrite("safety.scores"), saveSafetyScore);
router.delete("/scores/:id", requirePageWrite("safety.scores"), deleteSafetyScore);
router.get("/analytics", requirePageAccess("safety.analytics"), getSafetyAnalytics);

export default router;
