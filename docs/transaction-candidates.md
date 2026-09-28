# Microsoft Fabric Warehouse transaction boundaries

Critical multi-record state transitions remain atomic in the SQL edition. The relational compatibility layer propagates one Warehouse transaction through asynchronous work, verifies T-SQL connectivity and transaction execution before startup, and commits or rolls back each protected workflow as one unit. Primary rows, ordered child rows, and typed dynamic-value rows are committed together. A shared write-lock row makes application-enforced unique rules safe across server instances, and recognized Fabric write conflicts are retried with bounded backoff.

## Protected workflows

- Standby deployment updates the standby day, clears any previous covered route, updates the newly covered route, and synchronizes generated issues in one transaction. Application-enforced uniqueness guarantees that only one deployed standby can cover a `(date, coveringRoute)` tuple, including shared branch pools.
- Run-cut creation, editing, and deletion include assignment projection, future run-cut days, generated issues, and change-log rows in the same transaction.
- Scheduled assignment rollover projects each run cut in its own transaction so one route cannot be left partially projected without creating one very large cross-division transaction.
- Route retirement removes future generated issues and run-cut days, clears standby dispositions, removes the current run cut, and retires the route atomically.
- Network Success confirmation and removal update submissions, KPI entries, aliases, and audit data atomically. Reopening and reusable performance assignments also protect their related writes.
- Deployment exception updates include the selected daily assignment/status/disruption and generated issues in one transaction. Orion Service Requests use the company OSR advance-days setting and change route status only when explicitly requested.

Activity-log writes and reporting refresh queues intentionally run after commit. They are derived, retryable side effects and must not cause an already-committed operational change to appear failed to the user.

## Operational requirement

The process exits before `app.listen()` when configuration, Entra authentication, Warehouse connectivity, initialization, or the transaction check fails. The service principal needs workspace/Warehouse access plus schema and table DDL/DML permissions for first startup. Existing installations should run `npm run maintenance:verify-production` and resolve duplicate active standby coverage before cutover.
