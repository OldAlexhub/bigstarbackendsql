import test from "node:test";
import assert from "node:assert/strict";
import { validateEnvironment } from "./environment.js";

const required = {
  FABRIC_SQL_SERVER: "abc123.datawarehouse.fabric.microsoft.com",
  FABRIC_SQL_DATABASE: "BigStarWarehouse",
  AZURE_TENANT_ID: "11111111-1111-1111-1111-111111111111",
  AZURE_CLIENT_ID: "22222222-2222-2222-2222-222222222222",
  AZURE_CLIENT_SECRET: "test-client-secret",
  JWT_SECRET: "test-only-secret",
};

test("startup reports every missing required server variable", () => {
  assert.throws(
    () => validateEnvironment({}),
    (error) =>
      /FABRIC_SQL_SERVER is required/.test(error.message) &&
      /AZURE_CLIENT_SECRET is required/.test(error.message) &&
      /JWT_SECRET is required/.test(error.message)
  );
});

test("development accepts the required server variables without CLIENT_URL", () => {
  const config = validateEnvironment(required);
  assert.equal(config.nodeEnv, "development");
  assert.equal(config.port, 3000);
  assert.equal(config.clientOrigin, null);
  assert.equal(config.fabricSqlServer, required.FABRIC_SQL_SERVER);
  assert.equal(config.fabricSqlDatabase, required.FABRIC_SQL_DATABASE);
  assert.equal(config.fabricSqlPort, 1433);
  assert.equal(config.fabricSqlEncrypt, true);
  assert.equal(config.fabricSqlTrustServerCertificate, false);
  assert.equal(config.dbPoolMax, 10);
  assert.equal(config.dbSchema, "dbo");
  assert.equal(config.dbTransactionRetries, 3);
});

test("the Fabric Warehouse connection settings are validated", () => {
  assert.throws(
    () => validateEnvironment({ ...required, FABRIC_SQL_SERVER: "https://invalid.example.com:1433" }),
    /FABRIC_SQL_SERVER must be a hostname/
  );
  assert.throws(
    () => validateEnvironment({ ...required, FABRIC_SQL_ENCRYPT: "sometimes" }),
    /FABRIC_SQL_ENCRYPT must be true or false/
  );
  assert.throws(
    () => validateEnvironment({ ...required, FABRIC_SQL_PORT: "0" }),
    /FABRIC_SQL_PORT must be an integer/
  );
  assert.throws(() => validateEnvironment({ ...required, DB_POOL_MAX: "0" }), /DB_POOL_MAX must be an integer/);
  assert.throws(() => validateEnvironment({ ...required, DB_SCHEMA: "bad-name" }), /valid T-SQL identifier/);
  assert.throws(
    () => validateEnvironment({ ...required, DB_TRANSACTION_RETRIES: "11" }),
    /DB_TRANSACTION_RETRIES must be an integer/
  );
});

test("production requires an explicit CLIENT_URL", () => {
  assert.throws(
    () => validateEnvironment({ ...required, NODE_ENV: "production" }),
    (error) =>
      /CLIENT_URL is required when NODE_ENV=production/.test(error.message) &&
      /TRUST_PROXY is required when NODE_ENV=production/.test(error.message)
  );
});

test("production rejects a short JWT signing secret", () => {
  assert.throws(
    () => validateEnvironment({
      ...required,
      NODE_ENV: "production",
      CLIENT_URL: "https://operations.example.com",
      TRUST_PROXY: "false",
    }),
    /JWT_SECRET must be a non-placeholder secret of at least 32 characters/
  );
});

test("production rejects a long placeholder JWT signing secret", () => {
  assert.throws(
    () => validateEnvironment({
      ...required,
      NODE_ENV: "production",
      JWT_SECRET: "replace-with-at-least-32-random-characters",
      CLIENT_URL: "https://operations.example.com",
      TRUST_PROXY: "false",
    }),
    /non-placeholder secret/
  );
});

test("CLIENT_URL must be an HTTP origin without a path", () => {
  assert.throws(
    () => validateEnvironment({ ...required, CLIENT_URL: "https://example.com/app" }),
    /CLIENT_URL must be an origin only/
  );
});

test("production returns the validated client origin", () => {
  const config = validateEnvironment({
    ...required,
    JWT_SECRET: "0123456789abcdef0123456789abcdef",
    NODE_ENV: "production",
    PORT: "3001",
    CLIENT_URL: "https://operations.example.com/",
    TRUST_PROXY: "1",
  });

  assert.equal(config.port, 3001);
  assert.equal(config.clientOrigin, "https://operations.example.com");
  assert.equal(config.trustProxy, 1);
});
