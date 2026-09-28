import mongoose from "./sqlMongoose.js";

mongoose.set("transactionAsyncLocalStorage", true);

const connectToDb = async (config = {}) => {
  const connection = await mongoose.connect({
    server: config.fabricSqlServer || process.env.FABRIC_SQL_SERVER,
    database: config.fabricSqlDatabase || process.env.FABRIC_SQL_DATABASE,
    port: config.fabricSqlPort || Number(process.env.FABRIC_SQL_PORT) || 1433,
    tenantId: config.azureTenantId || process.env.AZURE_TENANT_ID,
    clientId: config.azureClientId || process.env.AZURE_CLIENT_ID,
    clientSecret: config.azureClientSecret || process.env.AZURE_CLIENT_SECRET,
    encrypt: config.fabricSqlEncrypt ?? process.env.FABRIC_SQL_ENCRYPT !== "false",
    trustServerCertificate:
      config.fabricSqlTrustServerCertificate ??
      process.env.FABRIC_SQL_TRUST_SERVER_CERTIFICATE === "true",
    max: config.dbPoolMax || Number(process.env.DB_POOL_MAX) || 10,
    schema: config.dbSchema || process.env.DB_SCHEMA || "dbo",
    transactionRetries:
      config.dbTransactionRetries ??
      (process.env.DB_TRANSACTION_RETRIES === undefined
        ? 3
        : Number(process.env.DB_TRANSACTION_RETRIES)),
  });
  console.log("Microsoft Fabric Warehouse connected.");
  return connection.connection;
};

export default connectToDb;
