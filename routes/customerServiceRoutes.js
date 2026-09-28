import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess, requirePageWrite } from "../middleware/access.js";
import {
  deleteCustomerServiceEntry,
  getCustomerServiceAnalytics,
  listCustomerServiceEntries,
  saveCustomerServiceEntry,
} from "../controllers/customerServiceController.js";

const router = Router();

router.use(protect);
router.get("/entries", requirePageAccess("customer_service.monthly_counts"), listCustomerServiceEntries);
router.put("/entries", requirePageWrite("customer_service.monthly_counts"), saveCustomerServiceEntry);
router.delete("/entries/:id", requirePageWrite("customer_service.monthly_counts"), deleteCustomerServiceEntry);
router.get("/analytics", requirePageAccess("customer_service.analytics"), getCustomerServiceAnalytics);

export default router;
