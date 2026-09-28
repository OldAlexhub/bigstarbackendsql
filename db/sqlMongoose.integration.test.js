import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "./sqlMongoose.js";
import Division from "../models/Division.js";
import Route from "../models/Route.js";
import RunCut from "../models/RunCut.js";
import User from "../models/User.js";
import { SqlRateLimitStore } from "../utils/sqlRateLimitStore.js";

const integrationConfig = {
  server: process.env.TEST_FABRIC_SQL_SERVER,
  database: process.env.TEST_FABRIC_SQL_DATABASE,
  tenantId: process.env.TEST_AZURE_TENANT_ID,
  clientId: process.env.TEST_AZURE_CLIENT_ID,
  clientSecret: process.env.TEST_AZURE_CLIENT_SECRET,
};
const hasIntegrationConfig = Object.values(integrationConfig).every(Boolean);

test("Fabric Warehouse compatibility layer supports the server's core persistence contract", {
  skip: !hasIntegrationConfig,
}, async () => {
  const schema = `bigstar_test_${process.pid}`;
  await mongoose.connect({ ...integrationConfig, schema, max: 2 });

  try {
    const division = await Division.create({
      code: "SQL",
      name: "SQL Integration",
      thresholds: { breakMinutes: 30, revenueRatio: 0.8 },
    });
    assert.ok(division.createdAt instanceof Date);
    const relationalDivision = await mongoose.connection.query(
      `SELECT code, name, thresholds_break_minutes
       FROM [${schema}].[divisions]
       WHERE id = $1`,
      [String(division._id)]
    );
    assert.deepEqual(relationalDivision.rows[0], {
      code: "SQL",
      name: "SQL Integration",
      thresholds_break_minutes: 30,
    });

    await assert.rejects(
      Division.create({
        code: "SQL",
        name: "Duplicate",
        thresholds: { breakMinutes: 30, revenueRatio: 0.8 },
      }),
      (error) => error.code === 11000
    );

    const route = await Route.create({ division: division._id, code: "101", type: "standard" });
    const populated = await Route.findById(route._id).populate("division", "code name");
    assert.equal(populated.division.code, "SQL");
    assert.equal(populated.division.name, "SQL Integration");

    const runCut = await RunCut.create({
      division: division._id,
      route: route._id,
      daysOfWeek: ["MON", "TUE"],
      startTime: "08:00",
      endTime: "16:00",
    });
    const relationalDays = await mongoose.connection.query(
      `SELECT item_order, value
       FROM [${schema}].[run_cuts_days_of_week]
       WHERE parent_id = $1
       ORDER BY item_order`,
      [String(runCut._id)]
    );
    assert.deepEqual(relationalDays.rows, [
      { item_order: 0, value: "MON" },
      { item_order: 1, value: "TUE" },
    ]);

    await Route.updateOne({ _id: route._id }, { $set: { code: "102" } });
    assert.equal((await Route.findById(route._id).lean()).code, "102");

    const user = await User.create({
      username: "sql-admin",
      password: "integration-password",
      name: "SQL Admin",
      role: "ELT",
    });
    const authenticated = await User.findById(user._id).select("+password");
    assert.equal(await authenticated.comparePassword("integration-password"), true);

    await assert.rejects(
      mongoose.connection.transaction(async () => {
        await Route.create({ division: division._id, code: "ROLLBACK", type: "standard" });
        throw new Error("force rollback");
      }),
      /force rollback/
    );
    assert.equal(await Route.countDocuments({ code: "ROLLBACK" }), 0);

    const grouped = await Route.aggregate([
      { $match: { division: division._id } },
      { $group: { _id: "$division", count: { $sum: 1 } } },
    ]);
    assert.equal(grouped[0].count, 1);

    const rateLimitStore = new SqlRateLimitStore();
    rateLimitStore.init({ windowMs: 60_000 });
    assert.equal((await rateLimitStore.increment("integration-client")).totalHits, 1);
    assert.equal((await rateLimitStore.increment("integration-client")).totalHits, 2);
  } finally {
    try {
      const tables = await mongoose.connection.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = $1",
        [schema]
      );
      for (const { TABLE_NAME: tableName } of tables.rows) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
          await mongoose.connection.query(`DROP TABLE [${schema}].[${tableName}]`);
        }
      }
      await mongoose.connection.query(`EXEC(N'DROP SCHEMA [${schema}]')`);
    } finally {
      await mongoose.disconnect();
    }
  }
});
