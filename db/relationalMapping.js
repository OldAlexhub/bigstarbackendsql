const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const MODEL_TABLES = {
  ApiAccessToken: "api_access_tokens",
  ChangeLog: "change_logs",
  CorrectiveActionPlan: "corrective_action_plans",
  CustomerServiceEntry: "customer_service_entries",
  DailyIssueLog: "daily_issue_logs",
  DeploymentActivityLog: "deployment_activity_logs",
  Division: "divisions",
  DivisionThresholdChange: "division_threshold_changes",
  LoginRateLimitCounter: "login_rate_limit_counters",
  NetworkKpiEntry: "network_kpi_entries",
  NetworkRouteAlias: "network_route_aliases",
  NetworkSubmission: "network_submissions",
  OperationsKpiResult: "operations_kpi_results",
  OperationsKpiSetting: "operations_kpi_settings",
  Operator: "operators",
  PermanentOsrChange: "permanent_osr_changes",
  Provider: "providers",
  ReallocationRequest: "reallocation_requests",
  RetentionCleanupLog: "retention_cleanup_logs",
  Route: "routes",
  RunCut: "run_cuts",
  RunCutDay: "run_cut_days",
  SafetyEntry: "safety_entries",
  SafetyScoreEntry: "safety_score_entries",
  Settings: "settings",
  TeamPost: "team_posts",
  User: "users",
  Vehicle: "vehicles",
  WeeklyDivisionSummary: "weekly_division_summaries",
};

export const tableForModel = (modelName) => MODEL_TABLES[modelName] || null;

export const quoteIdentifier = (value) => {
  const identifier = String(value);
  if (!IDENTIFIER_PATTERN.test(identifier)) throw new Error(`Invalid SQL identifier: ${identifier}`);
  return `[${identifier}]`;
};

export const columnNameForPath = (path) => {
  if (path === "_id") return "id";
  if (path === "__v") return "version";
  return String(path)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(".", "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
};

export const sqlTypeForInstance = (instance, { identifier = false } = {}) => {
  if (identifier || instance === "ObjectId") return "varchar(128)";
  if (instance === "String") return "varchar(max)";
  if (instance === "Number" || instance === "Double" || instance === "Decimal128") return "float";
  if (instance === "BigInt" || instance === "Int32") return "bigint";
  if (instance === "Boolean") return "bit";
  if (instance === "Date") return "datetime2(6)";
  if (instance === "Buffer") return "varbinary(max)";
  throw new Error(`Unsupported relational schema type: ${instance}`);
};

const scalarDescriptor = (path, schemaType, column = columnNameForPath(path)) => ({
  path,
  column,
  instance: schemaType.instance,
  ref: schemaType.options?.ref || null,
  addIfMissing: schemaType.options?.relationalAddIfMissing === true,
  required:
    path === "_id" ||
    schemaType.options?.required === true ||
    (schemaType.options?.default !== undefined && schemaType.options.default !== null),
});

const tableName = (...parts) => parts.map(columnNameForPath).join("_");

const subdocumentColumns = (schema, prefix = "") => {
  const columns = [];
  const mixed = [];
  for (const [path, schemaType] of Object.entries(schema.paths)) {
    const fullPath = prefix ? `${prefix}.${path}` : path;
    if (schemaType.instance === "Mixed") {
      mixed.push({ path: fullPath, localPath: path });
    } else if (schemaType.instance === "Embedded") {
      const nested = subdocumentColumns(schemaType.schema, fullPath);
      columns.push(...nested.columns);
      mixed.push(...nested.mixed);
    } else if (schemaType.instance !== "Array") {
      columns.push(scalarDescriptor(fullPath, schemaType, columnNameForPath(fullPath)));
    } else {
      throw new Error(`Nested arrays are not supported in relational field ${fullPath}.`);
    }
  }
  return { columns, mixed };
};

export const buildModelMapping = (Model) => {
  const mainTable = MODEL_TABLES[Model.modelName];
  if (!mainTable) throw new Error(`No relational table is registered for model ${Model.modelName}.`);
  const timestampPaths = new Set(Object.values(Model.schema.$timestamps || {}));
  const columns = [];
  const embeddedPresence = [];
  const arrays = [];
  const mixed = [];

  for (const [path, schemaType] of Object.entries(Model.schema.paths)) {
    if (schemaType.instance === "Mixed") {
      mixed.push({
        path,
        table: tableName(mainTable, path, "values"),
        scope: "main",
      });
      continue;
    }

    if (schemaType.instance === "Embedded") {
      embeddedPresence.push({ path, column: `${columnNameForPath(path)}_present` });
      const nested = subdocumentColumns(schemaType.schema, path);
      columns.push(...nested.columns);
      for (const field of nested.mixed) {
        mixed.push({
          path: field.path,
          table: tableName(mainTable, field.path, "values"),
          scope: "main",
        });
      }
      continue;
    }

    if (schemaType.instance === "Array") {
      const element = schemaType.embeddedSchemaType;
      if (!element) throw new Error(`Unable to determine array type for ${Model.modelName}.${path}.`);
      if (element.instance === "Mixed") {
        mixed.push({
          path,
          table: tableName(mainTable, path, "values"),
          scope: "main",
          container: "array",
        });
        continue;
      }

      const array = {
        path,
        table: tableName(mainTable, path),
        kind: schemaType.schema ? "subdocument" : "primitive",
        columns: [],
        mixed: [],
      };
      if (schemaType.schema) {
        const nested = subdocumentColumns(schemaType.schema);
        array.columns = nested.columns;
        array.mixed = nested.mixed.map((field) => ({
          ...field,
          table: tableName(array.table, field.path, "values"),
          scope: "array",
          arrayPath: path,
        }));
      } else {
        array.columns = [scalarDescriptor("value", element, "value")];
      }
      arrays.push(array);
      continue;
    }

    const column = scalarDescriptor(path, schemaType);
    if (timestampPaths.has(path)) column.required = true;
    columns.push(column);
  }

  const idColumn = columns.find((column) => column.path === "_id");
  if (!idColumn) throw new Error(`${Model.modelName} has no relational id mapping.`);

  return {
    modelName: Model.modelName,
    collectionName: Model.collectionName,
    mainTable,
    idColumn,
    columns,
    embeddedPresence,
    arrays,
    mixed,
  };
};

const treeTableDdl = (qualifiedTable, includeItemOrder) => `
  IF OBJECT_ID(N'${qualifiedTable}', N'U') IS NULL
  BEGIN
    CREATE TABLE ${qualifiedTable} (
      parent_id varchar(128) NOT NULL,${includeItemOrder ? "\n      item_order int NOT NULL," : ""}
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;`;

export const ddlForMapping = (mapping, schemaName = "dbo") => {
  const schema = quoteIdentifier(schemaName);
  const main = `${schema}.${quoteIdentifier(mapping.mainTable)}`;
  const mainColumns = [
    ...mapping.columns.map((column) =>
      `      ${quoteIdentifier(column.column)} ${sqlTypeForInstance(column.instance, { identifier: column.path === "_id" })} ${column.required ? "NOT NULL" : "NULL"}`
    ),
    ...mapping.embeddedPresence.map((field) =>
      `      ${quoteIdentifier(field.column)} bit NOT NULL`
    ),
  ];

  const statements = [`
  IF OBJECT_ID(N'${main}', N'U') IS NULL
  BEGIN
    CREATE TABLE ${main} (
${mainColumns.join(",\n")}
    );
  END;`];

  for (const column of mapping.columns.filter((item) => item.addIfMissing)) {
    if (column.required) throw new Error(`Incremental relational column ${mapping.modelName}.${column.path} must be nullable.`);
    statements.push(`
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'${schemaName}'
      AND TABLE_NAME = N'${mapping.mainTable}'
      AND COLUMN_NAME = N'${column.column}'
  )
    ALTER TABLE ${main} ADD ${quoteIdentifier(column.column)} ${sqlTypeForInstance(column.instance)} NULL;`);
  }

  for (const array of mapping.arrays) {
    const qualified = `${schema}.${quoteIdentifier(array.table)}`;
    const columns = array.columns.map((column) =>
      `      ${quoteIdentifier(column.column)} ${sqlTypeForInstance(column.instance)} ${array.kind === "primitive" || column.required ? "NOT NULL" : "NULL"}`
    );
    statements.push(`
  IF OBJECT_ID(N'${qualified}', N'U') IS NULL
  BEGIN
    CREATE TABLE ${qualified} (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL${columns.length ? ",\n" : "\n"}${columns.join(",\n")}
    );
  END;`);
    for (const field of array.mixed) {
      statements.push(treeTableDdl(`${schema}.${quoteIdentifier(field.table)}`, true));
    }
  }

  for (const field of mapping.mixed) {
    statements.push(treeTableDdl(`${schema}.${quoteIdentifier(field.table)}`, false));
  }
  return statements.join("\n");
};

const valueType = (value) => {
  if (value === null) return "null";
  if (value instanceof Date) return "date";
  if (Buffer.isBuffer(value)) return "binary";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
};

export const flattenDynamicValue = (value) => {
  const rows = [];
  const visit = (current, parentNodeOrder = null, pathKey = null, arrayIndex = null) => {
    const nodeOrder = rows.length;
    const type = valueType(current);
    const row = {
      node_order: nodeOrder,
      parent_node_order: parentNodeOrder,
      path_key: pathKey,
      array_index: arrayIndex,
      value_type: type,
      string_value: null,
      number_value: null,
      boolean_value: null,
      date_value: null,
      binary_value: null,
    };
    if (type === "string") row.string_value = String(current);
    else if (type === "number") row.number_value = current;
    else if (type === "boolean") row.boolean_value = current;
    else if (type === "date") row.date_value = current;
    else if (type === "binary") row.binary_value = current;
    rows.push(row);

    if (type === "array") {
      current.forEach((item, index) => visit(item, nodeOrder, null, index));
    } else if (type === "object") {
      Object.entries(current).forEach(([key, item]) => visit(item, nodeOrder, key, null));
    }
  };
  visit(value);
  return rows;
};

export const inflateDynamicValue = (rows) => {
  if (!rows.length) return undefined;
  const values = new Map();
  const ordered = [...rows].sort((left, right) => left.node_order - right.node_order);
  for (const row of ordered) {
    let value;
    if (row.value_type === "null") value = null;
    else if (row.value_type === "array") value = [];
    else if (row.value_type === "object") value = {};
    else if (row.value_type === "number") value = row.number_value;
    else if (row.value_type === "boolean") value = Boolean(row.boolean_value);
    else if (row.value_type === "date") value = row.date_value;
    else if (row.value_type === "binary") value = row.binary_value;
    else value = row.string_value;
    values.set(row.node_order, value);
  }

  for (const row of ordered) {
    if (row.parent_node_order == null) continue;
    const parent = values.get(row.parent_node_order);
    const value = values.get(row.node_order);
    if (Array.isArray(parent)) parent[row.array_index] = value;
    else parent[row.path_key] = value;
  }
  return values.get(ordered[0].node_order);
};

export const mappingsDdl = (mappings, schemaName = "dbo") => {
  const schema = quoteIdentifier(schemaName);
  const lockTable = `${schema}.[bigstar_write_lock]`;
  const constraint = (name, type, statement) => `
IF OBJECT_ID(N'${schema}.${quoteIdentifier(name)}', N'${type}') IS NULL
  ${statement};`;
  const constraints = [
    constraint(
      "pk_bigstar_write_lock",
      "PK",
      `ALTER TABLE ${lockTable} ADD CONSTRAINT [pk_bigstar_write_lock] PRIMARY KEY NONCLUSTERED ([lock_name]) NOT ENFORCED`
    ),
  ];

  for (const mapping of mappings) {
    const main = `${schema}.${quoteIdentifier(mapping.mainTable)}`;
    constraints.push(
      constraint(
        `pk_${mapping.mainTable}`,
        "PK",
        `ALTER TABLE ${main} ADD CONSTRAINT ${quoteIdentifier(`pk_${mapping.mainTable}`)} PRIMARY KEY NONCLUSTERED (${quoteIdentifier(mapping.idColumn.column)}) NOT ENFORCED`
      )
    );

    for (const array of mapping.arrays) {
      const child = `${schema}.${quoteIdentifier(array.table)}`;
      const primaryName = `pk_${array.table}`;
      const parentName = `fk_${array.table}_parent`;
      constraints.push(
        constraint(
          primaryName,
          "PK",
          `ALTER TABLE ${child} ADD CONSTRAINT ${quoteIdentifier(primaryName)} PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED`
        ),
        constraint(
          parentName,
          "F",
          `ALTER TABLE ${child} ADD CONSTRAINT ${quoteIdentifier(parentName)} FOREIGN KEY ([parent_id]) REFERENCES ${main} ([id]) NOT ENFORCED`
        )
      );
      for (const field of array.mixed) {
        const valuesTable = `${schema}.${quoteIdentifier(field.table)}`;
        const valuePrimary = `pk_${field.table}`;
        const valueParent = `fk_${field.table}_parent`;
        constraints.push(
          constraint(
            valuePrimary,
            "PK",
            `ALTER TABLE ${valuesTable} ADD CONSTRAINT ${quoteIdentifier(valuePrimary)} PRIMARY KEY NONCLUSTERED ([parent_id], [item_order], [node_order]) NOT ENFORCED`
          ),
          constraint(
            valueParent,
            "F",
            `ALTER TABLE ${valuesTable} ADD CONSTRAINT ${quoteIdentifier(valueParent)} FOREIGN KEY ([parent_id], [item_order]) REFERENCES ${child} ([parent_id], [item_order]) NOT ENFORCED`
          )
        );
      }
    }

    for (const field of mapping.mixed) {
      const valuesTable = `${schema}.${quoteIdentifier(field.table)}`;
      const primaryName = `pk_${field.table}`;
      const parentName = `fk_${field.table}_parent`;
      constraints.push(
        constraint(
          primaryName,
          "PK",
          `ALTER TABLE ${valuesTable} ADD CONSTRAINT ${quoteIdentifier(primaryName)} PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED`
        ),
        constraint(
          parentName,
          "F",
          `ALTER TABLE ${valuesTable} ADD CONSTRAINT ${quoteIdentifier(parentName)} FOREIGN KEY ([parent_id]) REFERENCES ${main} ([id]) NOT ENFORCED`
        )
      );
    }
  }

  return `-- Generated relational schema for BigStar on Microsoft Fabric Warehouse.
-- Application uniqueness and references are enforced by the API because Fabric constraints are NOT ENFORCED.

IF SCHEMA_ID(N'${schemaName}') IS NULL
  EXEC(N'CREATE SCHEMA ${schema}');

IF OBJECT_ID(N'${lockTable}', N'U') IS NULL
BEGIN
  CREATE TABLE ${lockTable} (
    lock_name varchar(32) NOT NULL,
    lock_version bigint NOT NULL,
    updated_at datetime2(6) NOT NULL
  );
END;

IF NOT EXISTS (SELECT 1 FROM ${lockTable} WHERE lock_name = 'global')
  INSERT INTO ${lockTable} (lock_name, lock_version, updated_at)
  VALUES ('global', 0, SYSUTCDATETIME());
${mappings.map((mapping) => ddlForMapping(mapping, schemaName)).join("\n")}
-- Fabric Warehouse supports relationship constraints only as NOT ENFORCED metadata.
${constraints.join("\n")}
`;
};
