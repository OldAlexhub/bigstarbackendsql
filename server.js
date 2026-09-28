import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import mongoose from "./db/sqlMongoose.js";
import connectTodb from "./db/connectTodb.js";
import { assertTransactionSupport } from "./db/transactionSupport.js";
import { validateEnvironment } from "./config/environment.js";
import { createRequestOriginProtection } from "./middleware/requestOrigin.js";
import { createErrorHandler } from "./middleware/errorHandler.js";
import RunCutDay from "./models/RunCutDay.js";
import LoginRateLimitCounter from "./models/LoginRateLimitCounter.js";
import ReallocationRequest from "./models/ReallocationRequest.js";
import TeamPost from "./models/TeamPost.js";
import RetentionCleanupLog from "./models/RetentionCleanupLog.js";
import Operator from "./models/Operator.js";
import Vehicle from "./models/Vehicle.js";
import RunCut from "./models/RunCut.js";
import authRoutes from "./routes/authRoutes.js";
import divisionsRoutes from "./routes/divisionsRoutes.js";
import routesRoutes from "./routes/routesRoutes.js";
import operatorsRoutes from "./routes/operatorsRoutes.js";
import vehiclesRoutes from "./routes/vehiclesRoutes.js";
import runCutsRoutes from "./routes/runCutsRoutes.js";
import runCutDaysRoutes from "./routes/runCutDaysRoutes.js";
import trackerRoutes from "./routes/trackerRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import dailyIssuesRoutes from "./routes/dailyIssuesRoutes.js";
import reportsRoutes from "./routes/reportsRoutes.js";
import deploymentActivityRoutes from "./routes/deploymentActivityRoutes.js";
import permanentOsrChangesRoutes from "./routes/permanentOsrChangesRoutes.js";
import providersRoutes from "./routes/providersRoutes.js";
import homeSummaryRoutes from "./routes/homeSummaryRoutes.js";
import eltReportingRoutes from "./routes/eltReportingRoutes.js";
import leaderboardRoutes from "./routes/leaderboardRoutes.js";
import usersRoutes from "./routes/usersRoutes.js";
import networkSuccessRoutes from "./routes/networkSuccessRoutes.js";
import customerServiceRoutes from "./routes/customerServiceRoutes.js";
import safetyRoutes from "./routes/safetyRoutes.js";
import operationsReportingRoutes from "./routes/operationsReportingRoutes.js";
import reallocationRequestsRoutes from "./routes/reallocationRequestsRoutes.js";
import teamPostsRoutes from "./routes/teamPostsRoutes.js";
import reportBuilderRoutes from "./routes/reportBuilderRoutes.js";
import { scheduleWeeklyFinalization } from "./jobs/finalizeWeeks.js";
import { scheduleAssignmentRollover } from "./jobs/rolloverAssignments.js";
import { scheduleOperationsReconciliation } from "./jobs/reconcileOperationsReporting.js";
import { scheduleReallocationApplications } from "./jobs/applyReallocationRequests.js";
import { scheduleDataRetentionCleanup } from "./jobs/dataRetention.js";
import { backfillAssignmentRosters } from "./utils/backfillAssignmentRosters.js";

dotenv.config({ quiet: true });

let config;
try {
  config = validateEnvironment();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const app = express();

if (config.trustProxy !== undefined) app.set("trust proxy", config.trustProxy);

app.use(
  cors({
    origin: config.clientOrigin || (config.nodeEnv === "production" ? false : true),
    credentials: true,
  })
);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});
app.use(createRequestOriginProtection(config));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? "ok" : "unhealthy",
    database: databaseConnected ? "connected" : "disconnected",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/divisions", divisionsRoutes);
app.use("/api/routes", routesRoutes);
app.use("/api/operators", operatorsRoutes);
app.use("/api/vehicles", vehiclesRoutes);
app.use("/api/run-cuts", runCutsRoutes);
app.use("/api/run-cut-days", runCutDaysRoutes);
app.use("/api/tracker", trackerRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/daily-issues", dailyIssuesRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/deployment-activity", deploymentActivityRoutes);
app.use("/api/permanent-osr-changes", permanentOsrChangesRoutes);
app.use("/api/providers", providersRoutes);
app.use("/api/home-summary", homeSummaryRoutes);
app.use("/api/elt-reporting", eltReportingRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/network-success", networkSuccessRoutes);
app.use("/api/customer-service", customerServiceRoutes);
app.use("/api/safety", safetyRoutes);
app.use("/api/operations-reporting", operationsReportingRoutes);
app.use("/api/reallocation-requests", reallocationRequestsRoutes);
app.use("/api/team-posts", teamPostsRoutes);
app.use("/api/report-builder", reportBuilderRoutes);

app.use((_req, res) => res.status(404).json({ message: "Not found" }));
app.use(createErrorHandler(config));

let httpServer;
let shuttingDown = false;
const scheduledJobs = [];

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down gracefully.`);

  const forcedExit = setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  for (const job of scheduledJobs) clearInterval(job);

  try {
    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await mongoose.disconnect();
    clearTimeout(forcedExit);
    process.exit(0);
  } catch {
    console.error("Graceful shutdown failed.");
    process.exit(1);
  }
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

const start = async () => {
  const database = await connectTodb(config);
  await assertTransactionSupport(database);
  const rosterBackfill = await backfillAssignmentRosters();
  if (rosterBackfill.updatedOperators || rosterBackfill.rewiredAssignments) {
    console.log(
      `Assignment rosters updated: ${rosterBackfill.updatedOperators} operator records, ${rosterBackfill.rewiredAssignments} assignments.`
    );
  }
  await Operator.createIndexes();
  await Vehicle.createIndexes();
  await RunCut.createIndexes();
  await RunCutDay.createIndexes();
  await LoginRateLimitCounter.createIndexes();
  await ReallocationRequest.createIndexes();
  await TeamPost.createIndexes();
  await RetentionCleanupLog.createIndexes();
  if (shuttingDown) return;
  httpServer = app.listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
  });

  scheduledJobs.push(
    scheduleWeeklyFinalization(),
    scheduleAssignmentRollover(),
    scheduleOperationsReconciliation(),
    scheduleReallocationApplications(),
    scheduleDataRetentionCleanup()
  );
};

start().catch(async () => {
  console.error("Server startup failed.");
  try {
    await mongoose.disconnect();
  } finally {
    process.exit(1);
  }
});
