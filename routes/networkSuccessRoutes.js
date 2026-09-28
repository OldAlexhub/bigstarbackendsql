import { Router } from "express";
import multer from "multer";
import { protect } from "../middleware/authMiddleware.js";
import { requirePageAccess, requirePageWrite } from "../middleware/access.js";
import {
  confirmSubmission,
  getPerformance,
  listEntries,
  listSubmissions,
  preprocessSubmission,
  previewSubmission,
  removeSubmission,
  reopenSubmission,
  updatePerformanceAssignment,
} from "../controllers/networkSuccessSubmissionsController.js";

const router = Router();
const excelExtension = /\.xlsx?$/i;
const csvExtension = /\.csv$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, callback) => {
    // Workbook sources are strictly .xls/.xlsx; Spare's export is a .csv,
    // accepted only under its own field name.
    const accepted = file.fieldname === "spare" ? csvExtension : excelExtension;
    if (!accepted.test(file.originalname)) {
      return callback(
        new Error(
          file.fieldname === "spare" ? "Only .csv files are accepted." : "Only .xls and .xlsx workbooks are accepted."
        )
      );
    }
    callback(null, true);
  },
});
const receiveWorkbooks = (req, res, next) => {
  upload.fields([
    { name: "vision", maxCount: 1 },
    { name: "productivity", maxCount: 1 },
    { name: "driverPerformance", maxCount: 1 },
    { name: "spare", maxCount: 1 },
    { name: "ridecoHours", maxCount: 1 },
    { name: "ridecoOtp", maxCount: 1 },
  ])(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Each workbook must be 10 MB or smaller." });
    return res.status(400).json({ message: error.message || "The uploaded files could not be accepted." });
  });
};

router.use(protect);
router.get("/submissions", requirePageAccess("network_success.excel_submissions"), listSubmissions);
router.get("/entries", requirePageAccess("network_success.excel_submissions"), listEntries);
router.get("/performance", requirePageAccess("network_success.performance"), getPerformance);
router.delete("/submissions/:id", requirePageWrite("network_success.excel_submissions"), removeSubmission);
router.post("/submissions/:id/reopen", requirePageWrite("network_success.excel_submissions"), reopenSubmission);
router.patch("/entries/:id/assignment", requirePageWrite("network_success.performance"), updatePerformanceAssignment);
router.post("/submissions/preprocess", requirePageWrite("network_success.excel_submissions"), receiveWorkbooks, preprocessSubmission);
router.post("/submissions/:id/preview", requirePageWrite("network_success.excel_submissions"), previewSubmission);
router.post("/submissions/:id/confirm", requirePageWrite("network_success.excel_submissions"), confirmSubmission);

export default router;
