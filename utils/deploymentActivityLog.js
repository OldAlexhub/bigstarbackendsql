import DeploymentActivityLog from "../models/DeploymentActivityLog.js";

// Fire-and-forget by design: a logging failure shouldn't roll back or fail
// the real action that already succeeded and already responded (or is about
// to). Errors are swallowed to a console.error rather than thrown.
export const logDeploymentActivity = async ({ division, user, action, summary, route, reason, changes }) => {
  try {
    await DeploymentActivityLog.create({
      division,
      user: user?._id || null,
      username: user?.username || "",
      name: user?.name || "",
      action,
      summary,
      route: route || "",
      reason: reason || "",
      changes: changes || [],
    });
  } catch {
    console.error("Failed to write deployment activity log.");
  }
};
