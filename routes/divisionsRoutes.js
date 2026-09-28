import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageAccess, requirePageWrite, requireELT } from "../middleware/access.js";
import { PAGE_ACCESS } from "../utils/pageAccess.js";
import {
  listDivisions,
  listDivisionThresholds,
  createDivision,
  saveDivisionThreshold,
  updateDivision,
  deleteDivision,
} from "../controllers/divisionsController.js";

const router = Router();

router.use(protect);

const divisionPages = PAGE_ACCESS.filter((page) => !["dashboard", "leaderboard"].includes(page));

router.get("/", requireAnyPageAccess(divisionPages), listDivisions);
router.get("/thresholds", requirePageAccess("settings.general"), listDivisionThresholds);
router.post("/", requirePageWrite("master_run_cuts.run_cuts"), requireELT, createDivision);
router.post("/:id/thresholds", requirePageWrite("settings.general"), saveDivisionThreshold);
router.patch("/:id", requirePageWrite("settings.general"), updateDivision);
router.delete("/:id", requirePageWrite("settings.general"), requireELT, deleteDivision);

export default router;
