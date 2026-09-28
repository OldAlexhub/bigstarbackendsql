import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireELT } from "../middleware/access.js";
import { listUsers, createUser, updateUser, deleteUser } from "../controllers/usersController.js";

const router = Router();

router.use(protect, requireELT);

router.get("/", listUsers);
router.post("/", createUser);
router.patch("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
