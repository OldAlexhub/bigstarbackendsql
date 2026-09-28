import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess } from "../middleware/access.js";
import { exportDeploymentActivity, listDeploymentActivity } from "../controllers/deploymentActivityController.js";

const router = Router();

router.use(protect, requirePageAccess("deployment.tracker_log"));

router.get("/", listDeploymentActivity);
router.get("/export", exportDeploymentActivity);

export default router;
