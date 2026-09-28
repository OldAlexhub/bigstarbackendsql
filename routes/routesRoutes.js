import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageWrite } from "../middleware/access.js";
import {
  listRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
} from "../controllers/routesController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnyPageAccess([
  "master_run_cuts.run_cuts",
  "deployment.live_schedule",
  "deployment.issue_log",
  "network_success.reallocation_requests",
]), listRoutes);
router.post("/", requirePageWrite("master_run_cuts.run_cuts"), createRoute);
router.patch("/:id", requirePageWrite("master_run_cuts.run_cuts"), updateRoute);
router.delete("/:id", requirePageWrite("master_run_cuts.run_cuts"), deleteRoute);

export default router;
