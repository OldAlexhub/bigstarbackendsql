import { AsyncLocalStorage } from "node:async_hooks";
import nativeMongoose from "mongoose";
import sql from "mssql";
import { Aggregator, Query as MingoQuery } from "mingo";
import {
  buildModelMapping,
  flattenDynamicValue,
  inflateDynamicValue,
  mappingsDdl,
  quoteIdentifier,
} from "./relationalMapping.js";

const transactionStorage = new AsyncLocalStorage();
const modelsByName = new Map();
const modelsByCollection = new Map();
const runtimeIndexes = new Map();
const relationalMappings = new Map();

let pool = null;
let schemaName = "dbo";
let writeLockTable = "[dbo].[bigstar_write_lock]";
let transactionRetries = 3;

const unwrap = (value) => (value && typeof value === "object" && value._doc ? value._doc : value);

const isObjectId = (value) =>
  value instanceof nativeMongoose.Types.ObjectId || value?._bsontype === "ObjectId";

const canonical = (value) => {
  if (value == null) return value;
  if (isObjectId(value)) return String(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp || Buffer.isBuffer(value)) return value;
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, item]) => [key, canonical(item)]));
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") {
    const source = unwrap(value);
    return Object.fromEntries(
      Object.entries(source).map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
};

const normalizeCriteria = (value) => {
  if (value == null || value instanceof Date || value instanceof RegExp) return canonical(value);
  if (isObjectId(value)) return String(value);
  if (Array.isArray(value)) return value.map(normalizeCriteria);
  if (typeof value !== "object") return value;

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeCriteria(item)])
  );
  if (normalized.$type === "objectId") {
    normalized.$type = "string";
    normalized.$regex = /^[a-f\d]{24}$/i;
  }
  return normalized;
};

const matches = (document, criteria = {}) =>
  new MingoQuery(normalizeCriteria(criteria)).test(canonical(document));

const valueAtPath = (value, path) => {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let current = unwrap(value);
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      current = current.map((item) => valueAtPath(item, [part])).flat();
    } else {
      current = unwrap(current)?.[part];
    }
  }
  return current;
};

const setAtPath = (target, path, value) => {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let current = unwrap(target);
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!current[part] || typeof unwrap(current[part]) !== "object") current[part] = {};
    current = unwrap(current[part]);
  }
  current[parts.at(-1)] = value;
};

const unsetAtPath = (target, path) => {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  const current = unwrap(target);
  if (Array.isArray(current)) {
    for (const item of current) unsetAtPath(item, parts);
    return;
  }
  if (!current || typeof current !== "object") return;
  if (parts.length === 1) {
    delete current[parts[0]];
    return;
  }
  unsetAtPath(current[parts[0]], parts.slice(1));
};

const transformAtPath = async (target, path, transform) => {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  const current = unwrap(target);
  if (Array.isArray(current)) {
    await Promise.all(current.map((item) => transformAtPath(item, parts, transform)));
    return;
  }
  if (!current || typeof current !== "object") return;
  const [part, ...rest] = parts;
  if (!(part in current)) return;
  if (!rest.length) {
    current[part] = await transform(current[part]);
    return;
  }
  await transformAtPath(current[part], rest, transform);
};

const sameValue = (left, right) => {
  const a = canonical(left);
  const b = canonical(right);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp && b instanceof RegExp) return String(a) === String(b);
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
};

const compareValues = (left, right) => {
  const a = Array.isArray(left) ? left[0] : left;
  const b = Array.isArray(right) ? right[0] : right;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const normalizedA = a instanceof Date ? a.getTime() : a;
  const normalizedB = b instanceof Date ? b.getTime() : b;
  if (normalizedA < normalizedB) return -1;
  if (normalizedA > normalizedB) return 1;
  return 0;
};

const sortDocuments = (documents, sort = {}) => {
  const entries = Object.entries(sort || {});
  if (!entries.length) return documents;
  return documents.sort((left, right) => {
    for (const [path, direction] of entries) {
      const result = compareValues(valueAtPath(left, path), valueAtPath(right, path));
      if (result) return result * (Number(direction) < 0 ? -1 : 1);
    }
    return 0;
  });
};

const selectionTokens = (selection) => {
  if (!selection) return [];
  if (typeof selection === "string") return selection.trim().split(/\s+/).filter(Boolean);
  return Object.entries(selection).map(([path, include]) => `${include ? "" : "-"}${path}`);
};

const hiddenPaths = (Model) => {
  const hidden = [];
  Model.schema.eachPath((path, schemaType) => {
    if (schemaType.options?.select === false) hidden.push(path);
  });
  return hidden;
};

const copySelectedPath = (source, target, path) => {
  const value = valueAtPath(source, path);
  if (value !== undefined) setAtPath(target, path, canonical(value));
};

const projectDocument = (Model, source, selection) => {
  const tokens = selectionTokens(selection);
  const explicitIncludes = tokens.filter((token) => !token.startsWith("-") && !token.startsWith("+"));
  let projected;

  if (explicitIncludes.length) {
    projected = {};
    for (const path of explicitIncludes) copySelectedPath(source, projected, path);
    if (!tokens.includes("-_id")) copySelectedPath(source, projected, "_id");
  } else {
    projected = canonical(source);
  }

  for (const path of hiddenPaths(Model)) {
    if (!tokens.includes(`+${path}`) && !explicitIncludes.includes(path)) unsetAtPath(projected, path);
  }
  for (const token of tokens) {
    if (token.startsWith("-")) unsetAtPath(projected, token.slice(1));
  }
  return projected;
};

const stripPopulatedReferences = (document, schema) => {
  const plain = canonical(document);
  schema.eachPath((path, schemaType) => {
    const ref = schemaType.options?.ref || schemaType.caster?.options?.ref;
    if (!ref) return;
    const strip = (value) => {
      if (Array.isArray(value)) return value.map(strip);
      if (value && typeof value === "object" && value._id != null) return canonical(value._id);
      return canonical(value);
    };
    const parts = path.split(".");
    const walk = (target, remaining) => {
      const current = unwrap(target);
      if (Array.isArray(current)) {
        for (const item of current) walk(item, remaining);
        return;
      }
      if (!current || typeof current !== "object") return;
      const [part, ...rest] = remaining;
      if (!(part in current)) return;
      if (!rest.length) current[part] = strip(current[part]);
      else walk(current[part], rest);
    };
    walk(plain, parts);
  });
  return plain;
};

const ensureConnected = () => {
  if (!pool || connection.readyState !== 1) {
    throw new Error("Microsoft Fabric Warehouse is not connected.");
  }
};

const requestInput = (request, name, value) => {
  if (typeof value === "string") return request.input(name, sql.VarChar(sql.MAX), value);
  if (typeof value === "boolean") return request.input(name, sql.Bit, value);
  if (Number.isInteger(value)) return request.input(name, sql.BigInt, value);
  if (typeof value === "number") return request.input(name, sql.Float, value);
  if (value instanceof Date) return request.input(name, sql.DateTime2(6), value);
  if (Buffer.isBuffer(value)) return request.input(name, sql.VarBinary(sql.MAX), value);
  return request.input(name, value);
};

const databaseQuery = async (text, values = []) => {
  ensureConnected();
  const statement = text.replace(/\$(\d+)/g, "@p$1");
  const context = transactionStorage.getStore();
  const execute = async () => {
    if (context?.failure) throw context.failure;
    const request = context ? new sql.Request(context.transaction) : pool.request();
    values.forEach((value, index) => requestInput(request, `p${index + 1}`, value));
    try {
      const result = await request.query(statement);
      return {
        rows: result.recordset || [],
        rowCount: result.rowsAffected?.reduce((total, count) => total + count, 0) || 0,
        recordsets: result.recordsets || [],
      };
    } catch (error) {
      if (context) context.failure = error;
      throw error;
    }
  };

  if (!context) return execute();
  const result = context.queue.then(execute);
  context.queue = result.catch(() => {});
  return result;
};

const acquireWriteLock = () =>
  databaseQuery(
    `UPDATE ${writeLockTable}
     SET lock_version = lock_version + 1, updated_at = SYSUTCDATETIME()
     WHERE lock_name = 'global'`
  );

const withWriteLock = async (_collectionName, work) => {
  const activeTransaction = transactionStorage.getStore();
  if (activeTransaction) {
    await acquireWriteLock();
    return work();
  }
  return connection.transaction(async () => {
    await acquireWriteLock();
    return work();
  });
};

const qualifiedTable = (table) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(table)}`;

const storageValue = (value, instance) => {
  if (value == null) return null;
  if (instance === "ObjectId") return String(value);
  if (instance === "Date") return value instanceof Date ? value : new Date(value);
  if (instance === "Boolean") return Boolean(value);
  if (["Number", "Double", "Decimal128"].includes(instance)) return Number(value);
  if (["BigInt", "Int32"].includes(instance)) return Number(value);
  if (instance === "Buffer") return Buffer.isBuffer(value) ? value : Buffer.from(value);
  return String(value);
};

const insertRows = async (table, columns, rows) => {
  if (!rows.length) return;
  const maximumRows = Math.max(1, Math.floor(1800 / columns.length));
  for (let offset = 0; offset < rows.length; offset += maximumRows) {
    const chunk = rows.slice(offset, offset + maximumRows);
    const values = [];
    const tuples = chunk.map((row) => {
      const parameters = columns.map((column) => {
        values.push(row[column] ?? null);
        return `$${values.length}`;
      });
      return `(${parameters.join(", ")})`;
    });
    await databaseQuery(
      `INSERT INTO ${qualifiedTable(table)} (${columns.map(quoteIdentifier).join(", ")})
       VALUES ${tuples.join(", ")}`,
      values
    );
  }
};

const dynamicRowsForStorage = (parentId, value, itemOrder) =>
  flattenDynamicValue(value).map((row) => ({
    parent_id: parentId,
    ...(itemOrder == null ? {} : { item_order: itemOrder }),
    ...row,
  }));

const dynamicColumns = (includeItemOrder) => [
  "parent_id",
  ...(includeItemOrder ? ["item_order"] : []),
  "node_order",
  "parent_node_order",
  "path_key",
  "array_index",
  "value_type",
  "string_value",
  "number_value",
  "boolean_value",
  "date_value",
  "binary_value",
];

const decodeScalar = (value, instance) => {
  if (value == null) return value;
  if (instance === "Boolean") return Boolean(value);
  if (instance === "Date") return value instanceof Date ? value : new Date(value);
  if (["Number", "Double", "Decimal128", "BigInt", "Int32"].includes(instance)) {
    return Number(value);
  }
  return value;
};

const rowsBy = (rows, keyFor) => {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
};

const readRelationalRows = async (Model) => {
  const mapping = relationalMappings.get(Model.collectionName) || buildModelMapping(Model);
  const mainResult = await databaseQuery(`SELECT * FROM ${qualifiedTable(mapping.mainTable)}`);
  const documents = new Map();

  for (const row of mainResult.rows) {
    const plain = {};
    for (const embedded of mapping.embeddedPresence) {
      if (row[embedded.column]) setAtPath(plain, embedded.path, {});
      else setAtPath(plain, embedded.path, null);
    }
    for (const column of mapping.columns) {
      const value = decodeScalar(row[column.column], column.instance);
      if (value !== null && value !== undefined) setAtPath(plain, column.path, value);
    }
    for (const array of mapping.arrays) setAtPath(plain, array.path, []);
    for (const field of mapping.mixed) {
      if (field.container === "array") setAtPath(plain, field.path, []);
    }
    documents.set(String(plain._id), plain);
  }

  for (const array of mapping.arrays) {
    const result = await databaseQuery(
      `SELECT * FROM ${qualifiedTable(array.table)} ORDER BY parent_id, item_order`
    );
    for (const row of result.rows) {
      const document = documents.get(String(row.parent_id));
      if (!document) continue;
      const values = valueAtPath(document, array.path);
      if (array.kind === "primitive") {
        values[row.item_order] = decodeScalar(row.value, array.columns[0].instance);
      } else {
        const item = {};
        for (const column of array.columns) {
          const value = decodeScalar(row[column.column], column.instance);
          if (value !== null && value !== undefined) setAtPath(item, column.path, value);
        }
        values[row.item_order] = item;
      }
    }

    for (const field of array.mixed) {
      const result = await databaseQuery(
        `SELECT * FROM ${qualifiedTable(field.table)} ORDER BY parent_id, item_order, node_order`
      );
      const grouped = rowsBy(result.rows, (row) => `${row.parent_id}\u0000${row.item_order}`);
      for (const [key, rows] of grouped) {
        const separator = key.lastIndexOf("\u0000");
        const parentId = key.slice(0, separator);
        const itemOrder = Number(key.slice(separator + 1));
        const item = valueAtPath(documents.get(parentId), array.path)?.[itemOrder];
        if (item) setAtPath(item, field.localPath, inflateDynamicValue(rows));
      }
    }
  }

  for (const field of mapping.mixed) {
    const result = await databaseQuery(
      `SELECT * FROM ${qualifiedTable(field.table)} ORDER BY parent_id, node_order`
    );
    const grouped = rowsBy(result.rows, (row) => String(row.parent_id));
    for (const [parentId, rows] of grouped) {
      const document = documents.get(parentId);
      if (document) setAtPath(document, field.path, inflateDynamicValue(rows));
    }
  }
  return [...documents.values()];
};

const rawRows = async (Model) => {
  if (transactionStorage.getStore()) return readRelationalRows(Model);
  return connection.transaction(() => readRelationalRows(Model));
};

const hydrateForQuery = (Model, stored) => {
  const document = Model.hydrate(stored);
  return canonical(document.toObject({ depopulate: true, flattenMaps: true, minimize: false }));
};

const loadDocuments = async (Model) => (await rawRows(Model)).map((row) => hydrateForQuery(Model, row));

const indexName = (keys, options = {}) =>
  options.name || Object.entries(keys).map(([path, direction]) => `${path}_${direction}`).join("_");

const indexesForModel = (Model) => {
  const declared = Model.schema.indexes().map(([key, options]) => ({
    key,
    name: indexName(key, options),
    ...options,
  }));
  return [{ key: { _id: 1 }, name: "_id_", unique: true }, ...declared, ...(runtimeIndexes.get(Model.collectionName) || [])];
};

const duplicateError = (Model, index, document) => {
  const error = new Error(
    `E11000 duplicate key error collection: ${Model.collectionName} index: ${index.name}`
  );
  error.name = "MongoServerError";
  error.code = 11000;
  error.keyPattern = index.key;
  error.keyValue = Object.fromEntries(
    Object.keys(index.key).map((path) => [path, valueAtPath(document, path)])
  );
  return error;
};

const assertUniqueIndexes = async (Model, document) => {
  const allDocuments = await loadDocuments(Model);
  for (const index of indexesForModel(Model).filter((candidate) => candidate.unique)) {
    if (index.partialFilterExpression && !matches(document, index.partialFilterExpression)) continue;
    const values = Object.keys(index.key).map((path) => valueAtPath(document, path));
    if (index.sparse && values.some((value) => value == null)) continue;
    const duplicate = allDocuments.find((candidate) =>
      String(candidate._id) !== String(document._id) &&
      (!index.partialFilterExpression || matches(candidate, index.partialFilterExpression)) &&
      Object.keys(index.key).every((path) =>
        sameValue(valueAtPath(candidate, path), valueAtPath(document, path))
      )
    );
    if (duplicate) throw duplicateError(Model, index, document);
  }
};

const persistPlain = async (Model, document, { enforceUnique = true } = {}) => {
  const plain = stripPopulatedReferences(document, Model.schema);
  plain._id = canonical(plain._id);
  if (plain._id == null) throw new Error(`${Model.modelName} requires an _id.`);
  if (enforceUnique) await assertUniqueIndexes(Model, plain);

  const mapping = relationalMappings.get(Model.collectionName) || buildModelMapping(Model);
  const mainColumns = [...mapping.columns.map((column) => column.column), ...mapping.embeddedPresence.map((field) => field.column)];
  const mainValues = [
    ...mapping.columns.map((column) => storageValue(valueAtPath(plain, column.path), column.instance)),
    ...mapping.embeddedPresence.map((field) => valueAtPath(plain, field.path) != null),
  ];
  const idIndex = mainColumns.indexOf(mapping.idColumn.column);
  const updateColumns = mainColumns.filter((_, index) => index !== idIndex);
  const valueParameter = (column) => `$${mainColumns.indexOf(column) + 1}`;
  await databaseQuery(
    `MERGE ${qualifiedTable(mapping.mainTable)} AS target
     USING (SELECT ${valueParameter(mapping.idColumn.column)} AS ${quoteIdentifier(mapping.idColumn.column)}) AS source
       ON target.${quoteIdentifier(mapping.idColumn.column)} = source.${quoteIdentifier(mapping.idColumn.column)}
     WHEN MATCHED THEN
       UPDATE SET ${updateColumns.map((column) => `${quoteIdentifier(column)} = ${valueParameter(column)}`).join(", ")}
     WHEN NOT MATCHED THEN
       INSERT (${mainColumns.map(quoteIdentifier).join(", ")})
       VALUES (${mainColumns.map(valueParameter).join(", ")});`,
    mainValues
  );

  const parentId = String(plain._id);
  for (const array of mapping.arrays) {
    for (const field of array.mixed) {
      await databaseQuery(`DELETE FROM ${qualifiedTable(field.table)} WHERE parent_id = $1`, [parentId]);
    }
    await databaseQuery(`DELETE FROM ${qualifiedTable(array.table)} WHERE parent_id = $1`, [parentId]);
    const values = valueAtPath(plain, array.path) || [];
    const rows = values.map((item, itemOrder) => ({
      parent_id: parentId,
      item_order: itemOrder,
      ...Object.fromEntries(
        array.columns.map((column) => [
          column.column,
          storageValue(
            array.kind === "primitive" ? item : valueAtPath(item, column.path),
            column.instance
          ),
        ])
      ),
    }));
    await insertRows(
      array.table,
      ["parent_id", "item_order", ...array.columns.map((column) => column.column)],
      rows
    );
    for (const field of array.mixed) {
      const dynamicRows = values.flatMap((item, itemOrder) => {
        const value = valueAtPath(item, field.localPath);
        return value === undefined ? [] : dynamicRowsForStorage(parentId, value, itemOrder);
      });
      await insertRows(field.table, dynamicColumns(true), dynamicRows);
    }
  }

  for (const field of mapping.mixed) {
    await databaseQuery(`DELETE FROM ${qualifiedTable(field.table)} WHERE parent_id = $1`, [parentId]);
    const value = valueAtPath(plain, field.path);
    if (value !== undefined) {
      await insertRows(field.table, dynamicColumns(false), dynamicRowsForStorage(parentId, value));
    }
  }
};

const removeById = async (Model, id) => {
  const mapping = relationalMappings.get(Model.collectionName) || buildModelMapping(Model);
  const parentId = String(id);
  for (const array of mapping.arrays) {
    for (const field of array.mixed) {
      await databaseQuery(`DELETE FROM ${qualifiedTable(field.table)} WHERE parent_id = $1`, [parentId]);
    }
    await databaseQuery(`DELETE FROM ${qualifiedTable(array.table)} WHERE parent_id = $1`, [parentId]);
  }
  for (const field of mapping.mixed) {
    await databaseQuery(`DELETE FROM ${qualifiedTable(field.table)} WHERE parent_id = $1`, [parentId]);
  }
  return databaseQuery(
    `DELETE FROM ${qualifiedTable(mapping.mainTable)} WHERE ${quoteIdentifier(mapping.idColumn.column)} = $1`,
    [parentId]
  );
};

const schemaRef = (Model, path) => {
  const schemaType = Model.schema.path(path);
  return schemaType?.options?.ref || schemaType?.caster?.options?.ref || null;
};

const normalizePopulate = (pathOrOptions, select) => {
  const raw = Array.isArray(pathOrOptions) ? pathOrOptions : [pathOrOptions];
  return raw.flatMap((item) => {
    if (typeof item === "string") {
      return item.split(/\s+/).filter(Boolean).map((path) => ({ path, select }));
    }
    return item ? [item] : [];
  });
};

const populateTargets = async (Model, targets, specs, lean, cache = new Map()) => {
  for (const spec of specs) {
    const refName = schemaRef(Model, spec.path);
    const RefModel = modelsByName.get(refName);
    if (!RefModel) continue;
    if (!cache.has(RefModel.collectionName)) cache.set(RefModel.collectionName, await loadDocuments(RefModel));
    const referenceDocuments = cache.get(RefModel.collectionName);

    for (const target of targets) {
      const source = lean ? target : target._doc;
      await transformAtPath(source, spec.path, async (rawValue) => {
        const populateValue = async (value) => {
          if (value == null) return null;
          const found = referenceDocuments.find((candidate) => String(candidate._id) === String(value?._id ?? value));
          if (!found || (spec.match && !matches(found, spec.match))) return null;
          const selected = projectDocument(RefModel, found, spec.select);
          const populated = lean ? selected : RefModel.hydrate(selected);
          if (spec.populate) {
            await populateTargets(
              RefModel,
              [populated],
              normalizePopulate(spec.populate),
              lean,
              cache
            );
          }
          return populated;
        };
        if (Array.isArray(rawValue)) {
          const populated = await Promise.all(rawValue.map(populateValue));
          return populated.filter(Boolean);
        }
        return populateValue(rawValue);
      });
      if (!lean && typeof target.populated === "function" && !spec.path.includes(".")) {
        target.populated(spec.path, valueAtPath(target, spec.path));
      }
    }
  }
  return targets;
};

const equalitySeed = (criteria = {}) => {
  const seed = {};
  for (const [path, value] of Object.entries(criteria)) {
    if (path.startsWith("$")) continue;
    if (value && typeof value === "object" && !isObjectId(value) && !(value instanceof Date)) {
      if ("$eq" in value) setAtPath(seed, path, canonical(value.$eq));
      continue;
    }
    setAtPath(seed, path, canonical(value));
  }
  return seed;
};

const applyUpdate = (source, update, { inserting = false } = {}) => {
  const document = canonical(source);
  if (Array.isArray(update)) {
    return canonical(new Aggregator(update.map(normalizeCriteria)).run([document])[0]);
  }
  const entries = Object.entries(update || {});
  const hasOperators = entries.some(([key]) => key.startsWith("$"));
  const operations = hasOperators ? update : { $set: update };

  for (const [operator, values] of Object.entries(operations)) {
    if (operator === "$set" || (operator === "$setOnInsert" && inserting)) {
      for (const [path, value] of Object.entries(values)) setAtPath(document, path, canonical(value));
    } else if (operator === "$unset") {
      for (const path of Object.keys(values)) unsetAtPath(document, path);
    } else if (operator === "$inc") {
      for (const [path, value] of Object.entries(values)) {
        setAtPath(document, path, Number(valueAtPath(document, path) || 0) + Number(value));
      }
    } else if (operator === "$addToSet") {
      for (const [path, value] of Object.entries(values)) {
        const current = Array.isArray(valueAtPath(document, path)) ? [...valueAtPath(document, path)] : [];
        const additions = value?.$each ? value.$each : [value];
        for (const addition of additions) {
          if (!current.some((item) => sameValue(item, addition))) current.push(canonical(addition));
        }
        setAtPath(document, path, current);
      }
    } else if (operator === "$pull") {
      for (const [path, condition] of Object.entries(values)) {
        const current = Array.isArray(valueAtPath(document, path)) ? valueAtPath(document, path) : [];
        const keep = current.filter((item) => {
          if (condition && typeof condition === "object" && Object.keys(condition).some((key) => key.startsWith("$"))) {
            return !matches({ value: item }, { value: condition });
          }
          return !sameValue(item, condition);
        });
        setAtPath(document, path, keep);
      }
    } else if (operator === "$push") {
      for (const [path, value] of Object.entries(values)) {
        const current = Array.isArray(valueAtPath(document, path)) ? [...valueAtPath(document, path)] : [];
        current.push(...canonical(value?.$each ? value.$each : [value]));
        setAtPath(document, path, current);
      }
    } else if (operator !== "$setOnInsert") {
      throw new Error(`Unsupported update operator: ${operator}`);
    }
  }
  return document;
};

const addUpdateTimestamp = (Model, document, inserting = false) => {
  if (!Model.schema.options.timestamps) return document;
  const timestamps = Model.schema.options.timestamps;
  const createdAt = typeof timestamps === "object" && timestamps.createdAt ? timestamps.createdAt : "createdAt";
  const updatedAt = typeof timestamps === "object" && timestamps.updatedAt ? timestamps.updatedAt : "updatedAt";
  const now = new Date();
  if (inserting && valueAtPath(document, createdAt) == null) setAtPath(document, createdAt, now);
  setAtPath(document, updatedAt, now);
  return document;
};

const updateMatching = async (Model, criteria, update, options = {}, many = false) =>
  withWriteLock(Model.collectionName, async () => {
    const documents = await loadDocuments(Model);
    const matching = documents.filter((document) => matches(document, criteria));
    const targets = many ? matching : matching.slice(0, 1);
    let modifiedCount = 0;

    for (const original of targets) {
      const changed = addUpdateTimestamp(Model, applyUpdate(original, update), false);
      if (!sameValue(original, changed)) modifiedCount += 1;
      await persistPlain(Model, changed, { enforceUnique: true });
    }

    let upsertedId = null;
    if (!targets.length && options.upsert) {
      const seeded = equalitySeed(criteria);
      const changed = addUpdateTimestamp(Model, applyUpdate(seeded, update, { inserting: true }), true);
      const document = new Model(changed);
      await document.save();
      upsertedId = document._id;
    }

    return {
      acknowledged: true,
      matchedCount: targets.length,
      modifiedCount,
      upsertedCount: upsertedId == null ? 0 : 1,
      upsertedId,
    };
  });

const deleteMatching = async (Model, criteria, many = false) =>
  withWriteLock(Model.collectionName, async () => {
    const documents = (await loadDocuments(Model)).filter((document) => matches(document, criteria));
    const targets = many ? documents : documents.slice(0, 1);
    for (const document of targets) await removeById(Model, document._id);
    return { acknowledged: true, deletedCount: targets.length };
  });

const aggregateDocuments = async (Model, pipeline) => {
  const normalized = pipeline.map((stage) => normalizeCriteria(stage));
  return new Aggregator(normalized).run(await loadDocuments(Model));
};

const createCollectionAdapter = (Model) => ({
  find: (criteria = {}) => ({
    toArray: async () => (await loadDocuments(Model)).filter((document) => matches(document, criteria)),
  }),
  aggregate: (pipeline = []) => ({ toArray: () => aggregateDocuments(Model, pipeline) }),
  updateOne: (criteria, update, options = {}) => updateMatching(Model, criteria, update, options, false),
  updateMany: (criteria, update, options = {}) => updateMatching(Model, criteria, update, options, true),
  deleteOne: (criteria) => deleteMatching(Model, criteria, false),
  deleteMany: (criteria) => deleteMatching(Model, criteria, true),
  indexes: async () => indexesForModel(Model),
  createIndex: async (key, options = {}) => {
    const index = { key, name: indexName(key, options), ...options };
    const current = runtimeIndexes.get(Model.collectionName) || [];
    runtimeIndexes.set(Model.collectionName, [...current.filter((item) => item.name !== index.name), index]);
    if (index.unique) {
      const documents = await loadDocuments(Model);
      for (const document of documents) await assertUniqueIndexes(Model, document);
    }
    return index.name;
  },
  dropIndex: async (name) => {
    const current = runtimeIndexes.get(Model.collectionName) || [];
    runtimeIndexes.set(Model.collectionName, current.filter((item) => item.name !== name));
    return { ok: 1 };
  },
});

const finalizeResult = async (Model, plainDocuments, query, single) => {
  const projected = plainDocuments.map((document) => projectDocument(Model, document, query._selection));
  const results = query._lean ? projected : projected.map((document) => Model.hydrate(document));
  await populateTargets(Model, results, query._populate, query._lean);
  return single ? results[0] || null : results;
};

class SqlQuery {
  constructor(Model, operation, args = []) {
    this.Model = Model;
    this.operation = operation;
    this.args = args;
    this._populate = [];
    this._selection = null;
    this._sort = null;
    this._limit = null;
    this._skip = 0;
    this._lean = false;
  }

  populate(pathOrOptions, select) {
    this._populate.push(...normalizePopulate(pathOrOptions, select));
    return this;
  }

  select(selection) {
    this._selection = selection;
    return this;
  }

  sort(sort) {
    this._sort = sort;
    return this;
  }

  limit(limit) {
    this._limit = Math.max(0, Number(limit));
    return this;
  }

  skip(skip) {
    this._skip = Math.max(0, Number(skip));
    return this;
  }

  lean(value = true) {
    this._lean = value !== false;
    return this;
  }

  session() {
    return this;
  }

  async exec() {
    const [criteria = {}, update, options = {}] = this.args;
    if (["find", "findOne", "findById"].includes(this.operation)) {
      const effectiveCriteria = this.operation === "findById" ? { _id: criteria } : criteria;
      let documents = (await loadDocuments(this.Model)).filter((document) => matches(document, effectiveCriteria));
      sortDocuments(documents, this._sort);
      if (this._skip) documents = documents.slice(this._skip);
      if (this._limit != null) documents = documents.slice(0, this._limit);
      const single = this.operation !== "find";
      if (single) documents = documents.slice(0, 1);
      return finalizeResult(this.Model, documents, this, single);
    }

    if (this.operation === "findOneAndUpdate") {
      const plain = await withWriteLock(this.Model.collectionName, async () => {
        const documents = await loadDocuments(this.Model);
        const original = documents.find((document) => matches(document, criteria));
        if (!original && !options.upsert) return null;
        const inserting = !original;
        const seeded = original || equalitySeed(criteria);
        const changed = addUpdateTimestamp(
          this.Model,
          applyUpdate(seeded, update, { inserting }),
          inserting
        );
        const document = inserting ? new this.Model(changed) : this.Model.hydrate(changed);
        if (!inserting) document.set(changed);
        await document.save();
        return hydrateForQuery(this.Model, document.toObject({ depopulate: true }));
      });
      return finalizeResult(this.Model, plain ? [plain] : [], this, true);
    }

    if (this.operation === "findByIdAndDelete") {
      const documents = await loadDocuments(this.Model);
      const found = documents.find((document) => String(document._id) === String(criteria));
      if (found) await deleteMatching(this.Model, { _id: criteria }, false);
      return finalizeResult(this.Model, found ? [found] : [], this, true);
    }

    throw new Error(`Unsupported query operation: ${this.operation}`);
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(callback) {
    return this.exec().finally(callback);
  }
}

const installModelMethods = (Model) => {
  Model.collectionName = Model.collection.collectionName;
  const collection = createCollectionAdapter(Model);
  Object.defineProperty(Model, "collection", { value: collection, configurable: true });
  modelsByName.set(Model.modelName, Model);
  modelsByCollection.set(Model.collectionName, Model);
  relationalMappings.set(Model.collectionName, buildModelMapping(Model));

  Model.prototype.save = async function save(options = {}) {
    const document = this;
    await document._execDocumentPreHooks("save", options, [options]);
    const plain = stripPopulatedReferences(
      document.toObject({ depopulate: true, flattenMaps: true, minimize: false }),
      Model.schema
    );
    await withWriteLock(Model.collectionName, () => persistPlain(Model, plain));
    document.$isNew = false;
    document.$__reset();
    await document._execDocumentPostHooks("save", options);
    return document;
  };

  Model.prototype.deleteOne = function deleteOne() {
    return Model.deleteOne({ _id: this._id });
  };

  Model.prototype.populate = async function populate(pathOrOptions, select) {
    await populateTargets(Model, [this], normalizePopulate(pathOrOptions, select), false);
    return this;
  };

  Model.find = (criteria = {}) => new SqlQuery(Model, "find", [criteria]);
  Model.findOne = (criteria = {}) => new SqlQuery(Model, "findOne", [criteria]);
  Model.findById = (id) => new SqlQuery(Model, "findById", [id]);
  Model.findOneAndUpdate = (criteria, update, options = {}) =>
    new SqlQuery(Model, "findOneAndUpdate", [criteria, update, options]);
  Model.findByIdAndDelete = (id) => new SqlQuery(Model, "findByIdAndDelete", [id]);
  Model.create = async (values) => {
    if (Array.isArray(values)) return Promise.all(values.map((value) => new Model(value).save()));
    return new Model(values).save();
  };
  Model.insertMany = (values) => Promise.all(values.map((value) => new Model(value).save()));
  Model.updateOne = (criteria, update, options = {}) => updateMatching(Model, criteria, update, options, false);
  Model.updateMany = (criteria, update, options = {}) => updateMatching(Model, criteria, update, options, true);
  Model.deleteOne = (criteria = {}) => deleteMatching(Model, criteria, false);
  Model.deleteMany = (criteria = {}) => deleteMatching(Model, criteria, true);
  Model.countDocuments = async (criteria = {}) =>
    (await loadDocuments(Model)).filter((document) => matches(document, criteria)).length;
  Model.exists = async (criteria = {}) => {
    const found = (await loadDocuments(Model)).find((document) => matches(document, criteria));
    return found ? { _id: found._id } : null;
  };
  Model.distinct = async (path, criteria = {}) => {
    const values = (await loadDocuments(Model))
      .filter((document) => matches(document, criteria))
      .flatMap((document) => {
        const value = valueAtPath(document, path);
        return Array.isArray(value) ? value : [value];
      })
      .filter((value) => value !== undefined);
    return values.filter((value, index) => values.findIndex((item) => sameValue(item, value)) === index);
  };
  Model.aggregate = (pipeline = []) => aggregateDocuments(Model, pipeline);
  Model.bulkWrite = async (operations) => {
    let insertedCount = 0;
    let matchedCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    let upsertedCount = 0;
    for (const operation of operations) {
      if (operation.updateOne) {
        const result = await Model.updateOne(
          operation.updateOne.filter,
          operation.updateOne.update,
          operation.updateOne
        );
        matchedCount += result.matchedCount;
        modifiedCount += result.modifiedCount;
        upsertedCount += result.upsertedCount;
      } else if (operation.insertOne) {
        await Model.create(operation.insertOne.document);
        insertedCount += 1;
      } else if (operation.deleteOne) {
        const result = await Model.deleteOne(operation.deleteOne.filter);
        deletedCount += result.deletedCount;
      } else if (operation.deleteMany) {
        const result = await Model.deleteMany(operation.deleteMany.filter);
        deletedCount += result.deletedCount;
      } else {
        throw new Error("Unsupported bulkWrite operation.");
      }
    }
    return { acknowledged: true, insertedCount, matchedCount, modifiedCount, deletedCount, upsertedCount };
  };
  Model.createIndexes = async () => indexesForModel(Model).map((index) => index.name);
  return Model;
};

const model = (name, schema, collectionName) => {
  if (modelsByName.has(name)) return modelsByName.get(name);
  const Model = nativeMongoose.models[name] || nativeMongoose.model(name, schema, collectionName);
  return installModelMethods(Model);
};

const connection = {
  readyState: 0,
  query: (text, values) => databaseQuery(text, values),
  collection: (name) => {
    const Model = modelsByCollection.get(name);
    if (!Model) throw new Error(`Unknown collection: ${name}`);
    return Model.collection;
  },
  transaction: async (work) => {
    const activeTransaction = transactionStorage.getStore();
    if (activeTransaction) return work();
    ensureConnected();

    for (let attempt = 0; ; attempt += 1) {
      const transaction = new sql.Transaction(pool);
      const context = { transaction, queue: Promise.resolve(), failure: null };
      let begun = false;
      try {
        await transaction.begin();
        begun = true;
        const result = await transactionStorage.run(context, work);
        await context.queue;
        if (context.failure) throw context.failure;
        await transaction.commit();
        return result;
      } catch (error) {
        await context.queue;
        if (begun) {
          try {
            await transaction.rollback();
          } catch {
            // Fabric may already have aborted a transaction after a write conflict.
          }
        }
        const details = [error, error?.originalError, ...(error?.precedingErrors || [])]
          .filter(Boolean)
          .map((item) => `${item.number || item.code || ""} ${item.message || ""}`)
          .join(" ");
        const retryable = /\b1205\b|\b24556\b|write[- ]write|snapshot.*conflict|conflict.*transaction|deadlock|transaction.*abort/i.test(details);
        if (!retryable || attempt >= transactionRetries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      }
    }
  },
};

const connect = async (options = {}) => {
  const required = ["server", "database", "tenantId", "clientId", "clientSecret"];
  const missing = required.filter((key) => !String(options[key] || "").trim());
  if (missing.length) {
    throw new Error(`Missing Microsoft Fabric Warehouse connection setting(s): ${missing.join(", ")}.`);
  }
  connection.readyState = 0;
  if (pool) await pool.close();

  schemaName = options.schema || "dbo";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName)) {
    throw new Error("Invalid Microsoft Fabric Warehouse schema name.");
  }
  writeLockTable = `${quoteIdentifier(schemaName)}.[bigstar_write_lock]`;
  transactionRetries = Number.isInteger(options.transactionRetries)
    ? options.transactionRetries
    : 3;

  pool = new sql.ConnectionPool({
    server: options.server,
    port: options.port || 1433,
    database: options.database,
    connectionTimeout: options.connectionTimeout || 30_000,
    requestTimeout: options.requestTimeout || 120_000,
    pool: {
      max: options.max || 10,
      min: 0,
      idleTimeoutMillis: options.idleTimeoutMillis || 30_000,
    },
    options: {
      encrypt: options.encrypt !== false,
      trustServerCertificate: options.trustServerCertificate === true,
      enableArithAbort: true,
    },
    authentication: {
      type: "azure-active-directory-service-principal-secret",
      options: {
        tenantId: options.tenantId,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
      },
    },
  });
  pool.on("error", () => {
    connection.readyState = 0;
  });

  try {
    await pool.connect();
    await pool.request().query(mappingsDdl([...relationalMappings.values()], schemaName));
    connection.readyState = 1;
    return { connection };
  } catch (error) {
    await pool.close().catch(() => {});
    pool = null;
    connection.readyState = 0;
    throw error;
  }
};

const disconnect = async () => {
  if (pool) await pool.close();
  pool = null;
  connection.readyState = 0;
};

const mongoose = {
  Schema: nativeMongoose.Schema,
  Types: nativeMongoose.Types,
  Error: nativeMongoose.Error,
  models: nativeMongoose.models,
  connection,
  model,
  connect,
  disconnect,
  isValidObjectId: nativeMongoose.isValidObjectId.bind(nativeMongoose),
  set: () => mongoose,
};

export const Schema = mongoose.Schema;
export const Types = mongoose.Types;
export { connection, model, connect, disconnect };
export default mongoose;
