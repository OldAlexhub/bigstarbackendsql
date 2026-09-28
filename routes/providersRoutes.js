import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageWrite } from "../middleware/access.js";
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
} from "../controllers/providersController.js";

const router = Router();

router.use(protect);

router.get("/", requireAnyPageAccess(["master_run_cuts.run_cuts", "master_run_cuts.drivers", "network_success.performance"]), listProviders);
router.post("/", requirePageWrite("master_run_cuts.drivers"), createProvider);
router.patch("/:id", requirePageWrite("master_run_cuts.drivers"), updateProvider);
router.delete("/:id", requirePageWrite("master_run_cuts.drivers"), deleteProvider);

export default router;
