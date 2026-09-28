# BigStar Operations Server — Microsoft Fabric Warehouse edition

This edition preserves the routes, controllers, validation, authorization, reports, jobs, and response shapes from [`../server`](../server), while persisting each application model in relational Microsoft Fabric Warehouse tables. The existing frontend can use it without API changes.

## Relational design

The Warehouse schema contains:

- 27 primary domain tables, including `users`, `divisions`, `routes`, `operators`, `vehicles`, `run_cuts`, and `run_cut_days`
- child tables for primitive arrays and embedded subdocuments
- typed value-node tables for the few intentionally dynamic Mongoose `Mixed` fields
- `bigstar_write_lock` for transaction coordination and application-enforced uniqueness

There is no generic document table and no JSON document column. Nested fixed-shape objects are flattened into named columns. Arrays and subdocuments are stored in ordered child rows. Arbitrary imported/audit values are decomposed into typed relational nodes containing string, number, Boolean, date, binary, object, array, and null values.

[`db/relationalMapping.js`](db/relationalMapping.js) is the model-to-table mapping implementation. [`db/schema.sql`](db/schema.sql) is the generated idempotent T-SQL schema. Regenerate or inspect the schema with:

```powershell
npm run schema:print
```

Fabric Warehouse constraints are not enforced like traditional OLTP constraints. Existing schema validation, defaults, hooks, references, population, uniqueness rules, query operators, and aggregation remain enforced by the Node compatibility layer. Protected writes use Warehouse transactions, a shared write-lock row, and bounded conflict retries.

## What the Fabric administrator must provide

- Warehouse SQL endpoint hostname, such as `<workspace-id>.datawarehouse.fabric.microsoft.com`
- Warehouse item/database name
- Microsoft Entra tenant ID
- service-principal client ID and client secret
- permission for the service principal to connect and read/write the application tables

The Fabric tenant setting **Service principals can use Fabric APIs** must allow the principal. Store the client secret only in the server secret manager or local `.env`; never commit it or expose it to the frontend.

## Setup

Requirements:

- Node.js 22.12 or newer
- Microsoft Fabric Warehouse
- Warehouse connectivity over TCP 1433
- the relational schema provisioned from `db/schema.sql`, or temporary DDL permission for automatic initialization

Install dependencies and create `.env` from [`.env.example`](.env.example):

```powershell
npm ci
Copy-Item .env.example .env
```

Set at least:

```dotenv
FABRIC_SQL_SERVER=replace-with-endpoint.datawarehouse.fabric.microsoft.com
FABRIC_SQL_DATABASE=BigStarWarehouse
FABRIC_SQL_PORT=1433
FABRIC_SQL_ENCRYPT=true
FABRIC_SQL_TRUST_SERVER_CERTIFICATE=false
AZURE_TENANT_ID=replace-with-directory-tenant-id
AZURE_CLIENT_ID=replace-with-application-client-id
AZURE_CLIENT_SECRET=replace-with-client-secret
DB_POOL_MAX=10
DB_SCHEMA=dbo
DB_TRANSACTION_RETRIES=3
JWT_SECRET=replace-with-at-least-32-random-characters
```

Production also requires `CLIENT_URL`, explicit `TRUST_PROXY`, and a non-placeholder JWT secret of at least 32 characters.

Start with `npm start`, or use `npm run dev` during development. Startup validates configuration, authenticates with Microsoft Entra, initializes any absent relational tables when permitted, and verifies a real transaction before accepting traffic. `GET /api/health` returns `503` when the Warehouse is disconnected.

## Verification

Run the application and relational mapping suite:

```powershell
npm test
```

The live persistence test creates and removes a process-specific schema. Supply test-only Fabric credentials:

```powershell
$env:TEST_FABRIC_SQL_SERVER="replace-with-endpoint.datawarehouse.fabric.microsoft.com"
$env:TEST_FABRIC_SQL_DATABASE="BigStarWarehouse"
$env:TEST_AZURE_TENANT_ID="replace-with-tenant-id"
$env:TEST_AZURE_CLIENT_ID="replace-with-client-id"
$env:TEST_AZURE_CLIENT_SECRET="replace-with-client-secret"
npm run test:integration
```

The live test checks direct relational columns, CRUD, child data, population, uniqueness, password hooks, aggregation, rate limiting, and rollback. Its identity must be allowed to create and drop its temporary schema.

Existing operational commands remain available:

```powershell
npm run migrate:assignment-rosters
npm run migrate:daily-issue-dedup
npm run maintenance:create-admin
npm run maintenance:verify-production
```

## Existing MongoDB data

Creating the relational Warehouse does not migrate MongoDB data. Historical documents must be transformed into their primary rows, ordered child rows, and typed dynamic-value rows while preserving `_id` and reference identifiers. Keep the original database unchanged until a separately tested migration, reconciliation, and cutover are complete.

## Technology

- Node.js with ES modules and Express 5
- Microsoft Fabric Warehouse through TDS/T-SQL and `mssql`
- Microsoft Entra service-principal authentication
- Mongoose schemas used locally for casting, defaults, validation, references, and hooks; Mongoose does not connect to MongoDB
- Relational model tables with flattened columns and child relations; no document column
- PDFKit and the patched SheetJS 0.20.3 distribution for imports and exports

---

Developed by **Mohamed Gad** for **Big Star Transit LLC**.
