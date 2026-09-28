import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  acknowledgeTeamPostNotifications,
  createTeamPost,
  getTeamPostNotifications,
  listTeamPosts,
  respondToTeamPost,
} from "../controllers/teamPostsController.js";

const router = Router();

router.use(protect);
router.get("/notifications", getTeamPostNotifications);
router.post("/acknowledge", acknowledgeTeamPostNotifications);
router.get("/", listTeamPosts);
router.post("/", createTeamPost);
router.post("/:id/respond", respondToTeamPost);

export default router;
