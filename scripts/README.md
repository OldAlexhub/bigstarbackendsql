# Database scripts

These scripts are retained as operational history. Run them from the `server-sql` directory against a backed-up Microsoft Fabric Warehouse, and review each script before use.

## Migrations

`migrations/` contains one-time data-shape and historical import work. Most are not routine maintenance and may be destructive when rerun against already-migrated data.

The two workbook-based migrations no longer assume a developer's local path:

```powershell
node scripts/migrations/importClientExpFormat.js --file "<absolute-path-to-client-export.xlsm>" --dry-run
node scripts/migrations/fixRunCutStatusFromSource.js --file "<absolute-path-to-source-report.xlsm>"
```

`IMPORT_WORKBOOK_PATH` and `SOURCE_WORKBOOK_PATH` are supported as alternatives to `--file`.

The daily-issue deduplication migration remains available through:

```powershell
npm run migrate:daily-issue-dedup
```

## Maintenance

`maintenance/` contains intentionally repeatable operator tasks. The administrator bootstrap command reads all identity and credential data from environment variables:

```powershell
npm run maintenance:create-admin
```

Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_NAME` first. `ADMIN_PASSWORD` must satisfy the application password policy, and `ADMIN_ROLE` defaults to `Super Admin`.
