const REQUIRED_KEYS = [
  "FABRIC_SQL_SERVER",
  "FABRIC_SQL_DATABASE",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "JWT_SECRET",
];

const configuredValue = (env, key) => {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
};

const validateClientOrigin = (value, errors) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push("CLIENT_URL must use http:// or https://.");
      return null;
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      errors.push("CLIENT_URL must be an origin only (for example, https://app.example.com).");
      return null;
    }
    return url.origin;
  } catch {
    errors.push("CLIENT_URL must be a valid absolute URL.");
    return null;
  }
};

const parseTrustProxy = (value) => {
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};

const parseBoolean = (value, fallback) => {
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

export const validateEnvironment = (env = process.env) => {
  const errors = [];

  for (const key of REQUIRED_KEYS) {
    if (!configuredValue(env, key)) errors.push(`${key} is required.`);
  }

  const nodeEnv = configuredValue(env, "NODE_ENV") || "development";
  const jwtSecret = configuredValue(env, "JWT_SECRET");
  if (
    nodeEnv === "production" &&
    (jwtSecret.length < 32 || /replace[-_ ]?with|change[-_ ]?me/i.test(jwtSecret))
  ) {
    errors.push("JWT_SECRET must be a non-placeholder secret of at least 32 characters when NODE_ENV=production.");
  }
  const clientUrl = configuredValue(env, "CLIENT_URL");
  if (nodeEnv === "production" && !clientUrl) {
    errors.push("CLIENT_URL is required when NODE_ENV=production.");
  }
  const rawTrustProxy = configuredValue(env, "TRUST_PROXY");
  if (nodeEnv === "production" && !rawTrustProxy) {
    errors.push("TRUST_PROXY is required when NODE_ENV=production (use false when no reverse proxy is present).");
  }
  const clientOrigin = validateClientOrigin(clientUrl, errors);

  const rawPort = configuredValue(env, "PORT");
  const port = rawPort ? Number(rawPort) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push("PORT must be an integer between 1 and 65535.");
  }

  const fabricSqlServer = configuredValue(env, "FABRIC_SQL_SERVER");
  if (fabricSqlServer && (!/^[A-Za-z0-9.-]+$/.test(fabricSqlServer) || !fabricSqlServer.includes("."))) {
    errors.push("FABRIC_SQL_SERVER must be a hostname without a protocol or port.");
  }
  const fabricSqlDatabase = configuredValue(env, "FABRIC_SQL_DATABASE");

  const rawSqlPort = configuredValue(env, "FABRIC_SQL_PORT");
  const fabricSqlPort = rawSqlPort ? Number(rawSqlPort) : 1433;
  if (!Number.isInteger(fabricSqlPort) || fabricSqlPort < 1 || fabricSqlPort > 65535) {
    errors.push("FABRIC_SQL_PORT must be an integer between 1 and 65535.");
  }
  const fabricSqlEncrypt = parseBoolean(configuredValue(env, "FABRIC_SQL_ENCRYPT"), true);
  if (fabricSqlEncrypt === null) errors.push("FABRIC_SQL_ENCRYPT must be true or false.");
  const fabricSqlTrustServerCertificate = parseBoolean(
    configuredValue(env, "FABRIC_SQL_TRUST_SERVER_CERTIFICATE"),
    false
  );
  if (fabricSqlTrustServerCertificate === null) {
    errors.push("FABRIC_SQL_TRUST_SERVER_CERTIFICATE must be true or false.");
  }

  const rawPoolMax = configuredValue(env, "DB_POOL_MAX");
  const dbPoolMax = rawPoolMax ? Number(rawPoolMax) : 10;
  if (!Number.isInteger(dbPoolMax) || dbPoolMax < 1 || dbPoolMax > 100) {
    errors.push("DB_POOL_MAX must be an integer between 1 and 100.");
  }
  const dbSchema = configuredValue(env, "DB_SCHEMA") || "dbo";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbSchema)) {
    errors.push("DB_SCHEMA must be a valid T-SQL identifier.");
  }
  const rawTransactionRetries = configuredValue(env, "DB_TRANSACTION_RETRIES");
  const dbTransactionRetries = rawTransactionRetries ? Number(rawTransactionRetries) : 3;
  if (!Number.isInteger(dbTransactionRetries) || dbTransactionRetries < 0 || dbTransactionRetries > 10) {
    errors.push("DB_TRANSACTION_RETRIES must be an integer between 0 and 10.");
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join("\n- ")}`);
  }

  return {
    nodeEnv,
    port,
    fabricSqlServer,
    fabricSqlDatabase,
    fabricSqlPort,
    fabricSqlEncrypt,
    fabricSqlTrustServerCertificate,
    azureTenantId: configuredValue(env, "AZURE_TENANT_ID"),
    azureClientId: configuredValue(env, "AZURE_CLIENT_ID"),
    azureClientSecret: configuredValue(env, "AZURE_CLIENT_SECRET"),
    dbPoolMax,
    dbSchema,
    dbTransactionRetries,
    jwtSecret,
    clientOrigin,
    trustProxy: parseTrustProxy(rawTrustProxy),
  };
};
