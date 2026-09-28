import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireAnyPageAccess, requirePageAccess, requirePageWrite } from "../middleware/access.js";
import {
  acceptReallocationRequest,
  acknowledgeReallocationNotifications,
  createReallocationRequest,
  exportReallocationRequests,
  getReallocationNotifications,
  getPendingReallocationNotifications,
  listReallocationRequests,
} from "../controllers/reallocationRequestsController.js";

const router = Router();

router.use(protect);
const requestPages = ["network_success.reallocation_requests", "deployment.receiving_requests"];

router.get("/notifications", requirePageAccess("network_success.reallocation_requests"), getReallocationNotifications);
router.get("/pending-notifications", requirePageAccess("deployment.receiving_requests"), getPendingReallocationNotifications);
router.post("/acknowledge", requirePageAccess("network_success.reallocation_requests"), acknowledgeReallocationNotifications);
router.get("/export", requireAnyPageAccess(requestPages), exportReallocationRequests);
router.get("/", requireAnyPageAccess(requestPages), listReallocationRequests);
router.post("/", requirePageWrite("network_success.reallocation_requests"), createReallocationRequest);
router.post("/:id/accept", requirePageWrite("deployment.receiving_requests"), acceptReallocationRequest);

export default router;
