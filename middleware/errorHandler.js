export const createErrorHandler = ({ nodeEnv }) => (error, _req, res, _next) => {
  const requestedStatus = Number(error?.status || error?.statusCode);
  const status = requestedStatus >= 400 && requestedStatus < 500 ? requestedStatus : 500;
  const safeMessage = status === 500
    ? "Internal server error"
    : nodeEnv !== "production" || error?.publicMessage === true
      ? String(error?.message || "Request failed")
      : "Request could not be processed";

  if (status === 500) {
    console.error(nodeEnv === "production"
      ? "Request failed with an internal server error."
      : "Request failed with an internal error.");
  }

  res.status(status).json({ message: safeMessage });
};
