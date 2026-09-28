import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageWrite } from "../middleware/access.js";
import {
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} from "../controllers/vehiclesController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnyPageAccess([
  "master_run_cuts.run_cuts",
  "master_run_cuts.vehicles",
  "deployment.live_schedule",
  "deployment.permanent_osr",
  "network_success.reallocation_requests",
]), listVehicles);
router.post("/", requirePageWrite("master_run_cuts.vehicles"), createVehicle);
router.patch("/:id", requirePageWrite("master_run_cuts.vehicles"), updateVehicle);
router.delete("/:id", requirePageWrite("master_run_cuts.vehicles"), deleteVehicle);

export default router;
