const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const createRequestOriginProtection = ({ nodeEnv, clientOrigin }) => (req, res, next) => {
  if (nodeEnv !== "production" || !STATE_CHANGING_METHODS.has(req.method)) return next();

  const requestOrigin = req.get("origin");
  if (requestOrigin === clientOrigin) return next();

  return res.status(403).json({ message: "Request origin is not allowed" });
};

