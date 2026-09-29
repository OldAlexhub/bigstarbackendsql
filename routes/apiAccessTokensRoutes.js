import { Router } from "express";
import {
  createApiAccessToken,
  listApiAccessTokens,
  revokeApiAccessToken,
} from "../controllers/apiAccessTokensController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireSuperAdmin } from "../middleware/access.js";

const router = Router();
router.use(protect, requireSuperAdmin);
router.get("/", listApiAccessTokens);
router.post("/", createApiAccessToken);
router.delete("/:id", revokeApiAccessToken);

export default router;
