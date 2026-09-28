import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildModelMapping,
  ddlForMapping,
  flattenDynamicValue,
  inflateDynamicValue,
  mappingsDdl,
} from "./relationalMapping.js";
import Division from "../models/Division.js";
import User from "../models/User.js";
import NetworkKpiEntry from "../models/NetworkKpiEntry.js";

test("each model maps to a dedicated relational table with flattened embedded fields", () => {
  const mapping = buildModelMapping(Division);
  assert.equal(mapping.mainTable, "divisions");
  assert.ok(mapping.columns.some((column) => column.column === "thresholds_break_minutes"));
  assert.ok(mapping.columns.some((column) => column.column === "pullout_address_rules_standby_keeps_route_address"));
  assert.equal(mapping.arrays.length, 0);
  assert.equal(mapping.mixed.length, 0);
});

test("primitive and subdocument arrays map to child tables", () => {
  const user = buildModelMapping(User);
  assert.equal(user.arrays.find((array) => array.path === "sections")?.kind, "primitive");
  assert.equal(user.arrays.find((array) => array.path === "pageAccessLevels")?.kind, "subdocument");
  assert.ok(
    user.arrays
      .find((array) => array.path === "pageAccessLevels")
      ?.columns.some((column) => column.column === "level")
  );
});

test("dynamic Mixed fields use typed relational value-node tables instead of JSON columns", () => {
  const mapping = buildModelMapping(NetworkKpiEntry);
  assert.ok(mapping.mixed.some((field) => field.path === "deployment.provenance"));
  assert.ok(mapping.mixed.some((field) => field.path === "assignmentAudit"));
  const components = mapping.arrays.find((array) => array.path === "components");
  assert.ok(components.mixed.some((field) => field.localPath === "sourceFields"));

  const ddl = ddlForMapping(mapping);
  assert.match(ddl, /CREATE TABLE \[dbo\]\.\[network_kpi_entries\]/);
  assert.match(ddl, /network_kpi_entries_components/);
  assert.match(ddl, /value_type varchar\(16\)/);
  assert.doesNotMatch(ddl, /\bjson\b/i);
});

test("typed value nodes preserve arbitrary mixed data without document serialization", () => {
  const value = {
    label: "sample",
    count: 3.5,
    active: false,
    empty: null,
    date: new Date("2026-09-28T12:00:00.000Z"),
    values: [1, "two", { nested: true }],
  };
  const rows = flattenDynamicValue(value);
  const restored = inflateDynamicValue(rows);
  assert.deepEqual(restored, value);
});

test("the checked-in Fabric schema exactly matches every registered model", async () => {
  const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const modelsDirectory = path.join(projectDirectory, "models");
  const files = fs
    .readdirSync(modelsDirectory)
    .filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"))
    .sort();
  const mappings = [];
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(modelsDirectory, file)));
    if (module.default?.schema) mappings.push(buildModelMapping(module.default));
  }

  const checkedInSchema = fs.readFileSync(path.join(projectDirectory, "db", "schema.sql"), "utf8");
  assert.equal(checkedInSchema.trimEnd(), mappingsDdl(mappings).trimEnd());
});
