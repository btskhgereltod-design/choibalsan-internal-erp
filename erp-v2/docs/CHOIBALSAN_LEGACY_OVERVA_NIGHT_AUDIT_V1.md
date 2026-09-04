# Choibalsan Legacy ERP to OVERVA Night Audit V1

Date: 2026-09-03
Repository commit at audit start: `77d3bc3`
Scope: local/demo and repository only; production was not connected, migrated,
written, restarted, or deployed.

## Executive result

No new P0 tenant-isolation, destructive-data, or audit-integrity defect was
proven in this pass. The reviewed Choibalsan master/import counts reconcile well
for Assets, accounting fixed assets, inventory, finance, Employees, Work Orders,
operational incidents, safety evidence, and canonical Documents.

The largest immediate release risk is environment drift, not missing source
code. The repository contains migrations through `0105`, the local database is
at `0103`, and the running local API image contains migrations only through
`0090`. The current source images build successfully, but they were deliberately
not deployed during this audit. A production GO decision must not use the
currently running local stack as evidence for the `0104`-`0105` fiber slice.

Two low-risk release-test defects were corrected in source:

- the release check now closes its PostgreSQL pool on a failed assertion instead
  of hanging indefinitely;
- the session smoke now selects only a `can_login=true` ordinary user for its
  expected HTTP 403 authorization check, rather than selecting a disabled
  imported demo account and receiving HTTP 401.

## Safety boundaries used

- Legacy `data/app.db` was opened only with SQLite `OPEN_READONLY` and
  `PRAGMA query_only=ON` for aggregate table counts.
- The local PostgreSQL database was queried only for aggregate counts and
  release/health evidence.
- No integration harness that creates or deletes database records was enabled.
- No legacy server was started because its startup creates/alters SQLite tables
  and activates cron jobs.
- No Docker service was recreated. `docker compose build api web` created local
  images only and did not change the running containers or database.
- No customer row content, credentials, tokens, phone numbers, salaries,
  addresses, GPS coordinates, document contents, or private file names are
  reproduced here.
- The pre-existing untracked `../OVERVA.code-workspace` file was not touched.

## Baseline and verification results

| Check | Result | Interpretation |
| --- | --- | --- |
| `npm run check` in `api` | PASS | API entrypoint syntax is valid. |
| `npm test` in `api` | 462 passed, 0 failed | Unit/static contracts pass. Several integration scripts are counted as passed after their environment guard skips execution; this is not 462 live E2E journeys. |
| `node --check` for all top-level `web/*.js` | PASS | Tenant web JavaScript parses. |
| `GET http://127.0.0.1:4101/health` | PASS | Running local API reports healthy. |
| `docker compose build api web` | PASS | Current source builds into local API and Web images without deployment. |
| Running-image `npm run release:check` | FAIL | Database `0103`; running image expects `0090`. The old failure path also hung until interrupted. |
| Current-source release check against local DB | Expected FAIL in 160 ms | Database `0103`; current source expects `0105`. The corrected failure path exits cleanly. |
| Running-image safety smoke | PASS | 92 imported risks were readable; no current safety incident/briefing rows. |
| Running-image session smoke | FAIL | Disabled ordinary demo user produced 401 instead of the intended permission-denial 403. Source fixture corrected; environment still lacks a suitable ordinary login fixture. |
| Running-image administration smoke | FAIL | No pilot HR login/role fixture satisfying the smoke contract. |
| Running-image employee-access smoke | FAIL | Owner reached People/Structure, but the old image returned 403 for the HR overview. |
| Running-image lighting/work-intake smoke commands | UNAVAILABLE | Those package scripts are absent from the running `0090` image. |
| New API `npm audit --omit=dev` | 3 moderate | Express 4.22.2's current `body-parser`/`qs` dependency chain. `npm audit fix` made no change; a forced override was not applied. |
| Legacy ERP `npm audit --omit=dev` | 17 total: 1 critical, 10 high, 4 moderate, 2 low | Includes legacy `tar/sqlite3/node-gyp`, `pdfjs-dist`, `nodemailer`, `fast-uri`, Hono-related packages, and `xlsx` with no npm audit fix. |

## Aggregate reconciliation evidence

These are counts, not a claim that every record is canonically reviewed.

| Source/capability | Legacy aggregate | Local OVERVA aggregate | Result |
| --- | ---: | ---: | --- |
| Asset master | 465 | 465 Assets | Reconciled |
| Accounting fixed assets | 3,932 | 3,932 | Reconciled |
| Inventory material master | 665 | 667 inventory items | 665 imported plus two documented local demo items |
| Warehouse movements | 124 | 126 stock movements | 124 imported plus two documented local/demo movements |
| Cash journal | 157 | 157 finance transactions | Reconciled |
| Payables | 61 | 79 finance obligations total | 43 valid source obligations plus warning/pre-existing/other obligation evidence; source provenance retains all 61 |
| Receivables | 36 | Provenance retains 36 | Reconciled at import boundary |
| Active Employees | 21 | 21 Employees | Reconciled; 22 Users because login identity is separate |
| Operational work | 106 legacy asset-event work records | 106 Work Orders, 553 events | Reconciled without fabricating missing history |
| Lighting incidents | 212 | 242 incidents total | 212 lighting plus 30 documented camera incidents |
| Lighting operational objects | 451 | Included in 561 total objects | Reconciled |
| Camera objects | 110 | Included in 561 total objects; 110 component allocations | Aggregate/object import covered |
| Safety risks/routes/documents | 92 / 19 / 2 | 92 / 19 / 2 | Reconciled; two acknowledgements remain intentionally unlinked warnings |
| Finance/inventory source evidence | — | 6,662 `source_import_records` total | Immutable provenance retained |
| Canonical legacy document import | eligible subset | 31 Documents, 32 Versions, 6 Correspondence records, 69 mappings | Reviewed subset committed locally; remaining files are not silently imported |

## Legacy-to-OVERVA parity matrix

| Business area | Classification | Evidence and remaining boundary |
| --- | --- | --- |
| Tenant, login, Employee and RBAC separation | REPLACED | OVERVA separates Organization, Employee, User, role, permission, workspace relevance, and process authority. This is stronger than the single-tenant legacy role model. |
| Employee master and structure | COVERED | 21 active Employees are canonical and mapped to jobs/positions/assignments. Login remains optional. |
| HR lifecycle, complaints, records and archive | PARTIAL | Modern governed foundations exist, but the local dataset has zero archive/complaint/lifecycle operational rows. Remaining legacy attachments and inactive identities require separate review. |
| Attendance | DATA MIGRATION GAP | Local OVERVA has zero attendance rows. Review staging deliberately blocks automatic reconciliation and production history must not be guessed. |
| Work intake, Work Order, assignment and closure | COVERED | One canonical Work Order flow replaces parallel lighting/camera work stores; 106 source work records and append-only events are retained. |
| Work scope, HSE and material trace on real pilot jobs | PARTIAL | Code/contracts exist, but current local imported jobs have zero scope items, zero canonical safety reviews, and zero material request/event traces. Historical evidence must not be fabricated; a new real pilot journey is required. |
| Legacy planned work and monthly reporting | PARTIAL | Management report and engineering commentary foundations exist. Legacy blank commentary was correctly not imported. Long-range plan behavior needs user validation rather than table copying. |
| Lighting objects and fast fault capture | COVERED | Object/fault master, governed batch capture, quantity grains, provenance, and Work Order coordination exist. Sixty-nine mixed source rows remain explicitly unclassified. |
| Incident correction and cancellation | PARTIAL | New batch reporting is implemented; correction and cancellation commands remain planned. |
| Lighting schedules, meter master, readings and electricity reconciliation | MISSING | Legacy has 19 schedules, 331 meter points, 1,870 checks, 2,356 bill points and 3,705 raw bill rows. Canonical schedule/meter/observation/invoice reconciliation remains planned. |
| Camera registry and current fault/work view | COVERED | 110 objects, aggregate 302-camera provenance, 30 incidents, daily snapshots and Work Orders are retained. |
| Camera technical points, device groups and reviewed GPS | PARTIAL | Current local data has zero canonical camera specifications/points/devices. Raw/partial coordinates remain provenance until human review. |
| Fiber GIS and recovery | PARTIAL | Source contains 23 routes/184 vertices. Repository `0104`-`0105` implements governed GIS and recovery staging, but the running local database/image cannot prove it; staging-to-canonical promotion is intentionally absent. |
| Inventory and storekeeper operations | COVERED | Master, balance, movements and valuation reconcile. Approved Work Order issue is the preferred path; ad-hoc issue is an evidenced exception. |
| Accounting and finance | COVERED | Cash, obligations, receivables evidence, fixed assets and inventory values are reconciled under a separate accounting workspace. Payroll-specific legacy behavior still needs a policy decision. |
| Vehicle registry, inspections and repairs | DATA MIGRATION GAP | Legacy has 3 vehicles, 117 daily, 10 weekly, 8 monthly inspections and 4 repairs. Local OVERVA Fleet/GPS has zero vehicle/device rows and no proven equivalent inspection migration. |
| IoT/LoRa runtime | NEEDS HUMAN DECISION | OVERVA has a safer generic IoT authority, but local data has zero devices/commands/telemetry while legacy retains substantial operational history. Historical commands must not be replayed or treated as current device truth. |
| Documents and attachments | PARTIAL | Canonical Documents/Versions/Links cover the approved subset. Forty-seven other attachments and one employee file remain for a future reviewed importer. |
| Legacy employee GPS/location | DO NOT COPY | Private employee coordinates were deliberately excluded. Any future workforce-location capability requires explicit privacy, retention, consent and authority decisions. |
| Legacy chat, assistant logs, surveys, public content and website administration | NEEDS HUMAN DECISION | These are not operational ERP parity requirements by default. Private chat/AI history must not be bulk-migrated as organizational truth. |
| Legacy hard delete and GET-time schema creation patterns | DO NOT COPY | OVERVA uses retirement/versioning, ordered migrations, audit evidence and explicit lifecycle commands. |

## Findings by priority

### P0

No new P0 was proven. This does not replace a clean disposable migration,
cross-tenant E2E run, browser UAT, restore rehearsal, or production security
review before GO.

### P1

#### CH-AUD-001 — Local runtime/source/schema drift

- Repository latest: `0105`.
- Local database latest: `0103` with 103 migration records.
- Running API image latest migration file: `0090`.
- Running image lacks the current lighting and work-intake smoke package scripts.
- Current API/Web images build successfully but are not running.

Impact: the local demo cannot be treated as a release candidate for the current
fiber and recovery work. Code, database, UI, and verification scripts do not
describe one immutable release.

Acceptance criteria:

1. Take and verify a local backup.
2. Record current running image identities.
3. Rehearse `0104`-`0105` on an explicitly disposable database.
4. Recreate only the local demo API/Web after approval.
5. Confirm one source commit, schema `0105`, matching image contents and all
   authenticated smokes.
6. Preserve a tested application rollback path compatible with additive schema.

Verification:

```powershell
docker compose --profile ops run --rm backup-verify
docker compose exec -T api npm run release:check
docker compose exec -T api npm run smoke:session
docker compose exec -T api npm run smoke:lighting
docker compose exec -T api npm run smoke:work-intake
docker compose exec -T api npm run smoke:safety
docker compose exec -T api npm run smoke:administration
```

#### CH-AUD-002 — Release check hung after failure

Cause: `closePool()` ran only on the success path. A failed schema assertion left
the PostgreSQL pool alive.

Status: fixed in source. The mismatch path now exits non-zero in about 160 ms.

Verification:

```powershell
cd api
node --test test/data-management-foundation.test.js
```

#### CH-AUD-003 — Authenticated smoke fixture/environment mismatch

The session smoke selected an active but login-disabled imported account. The
source query now requires `can_login=true`. The local demo currently provides no
proven ordinary login fixture for the required 403 test and no HR role fixture
meeting the administration smoke contract.

Acceptance criteria:

- create bounded synthetic smoke identities only in a disposable/rehearsal
  database, or explicitly provision reviewed local-demo login accounts;
- prove ordinary report denial is 403, revoked/disabled identity denial is 401,
  HR/records/archive role access is 200, and owner access does not rely on job
  title;
- do not enable imported employee accounts implicitly.

Verification:

```powershell
cd api
node --test test/production-release-readiness.test.js
```

#### CH-AUD-004 — Legacy runtime dependency exposure

The legacy application audit reports 17 known dependency findings including one
critical and ten high. Several fixes require breaking upgrades, and `xlsx` has
no npm-audit fix. This audit made no legacy dependency or runtime change.

Acceptance criteria:

- confirm whether the legacy server is reachable outside the trusted network;
- restrict exposure while compatibility work remains;
- upgrade/test `nodemailer`, `pdfjs-dist`, MCP/Hono dependencies and SQLite in
  isolated batches;
- replace or isolate vulnerable `xlsx` parsing for untrusted uploads;
- rerun legacy route, permission, upload and document parsing tests after each
  batch.

Verification:

```powershell
cd ..
npm audit --omit=dev --audit-level=moderate
npm run test:routes
npm run test:mcp:permissions
```

### P2

#### CH-AUD-005 — Test count overstates live integration coverage

`node --test` discovers integration script files whose environment guards print
"Set RUN_...=1 to run" and then exit successfully. The 462-pass headline mixes
real unit/static contracts with skipped live integrations.

Acceptance criteria: expose separate deterministic commands for unit/static,
disposable database integration, authenticated rehearsal smoke, and production
read-only smoke; CI must label a guarded skip as skipped rather than passed.

#### CH-AUD-006 — Remaining fixed-role authorization debt

Confirmed consumers remain in attendance, dashboard presentation, maintenance
and procurement behavior, attachment exceptions, and IoT command authority.
This matches the accepted legacy authorization audit. It is not safe to remove
all compatibility checks together, especially for IoT.

Acceptance criteria: migrate one domain at a time with allow/deny matrices,
revocation tests, server-derived permissions, UI visibility tests, and no
authority union between legacy and new policy.

#### CH-AUD-007 — Operational core is code-proven but not pilot-outcome-proven

The current dataset contains 106 imported Work Orders but zero canonical scope
items, safety reviews, material requests, or material events. This is correct for
non-fabricated history, but it means a new real lighting/camera maintenance
journey must prove the complete modern flow.

Acceptance criteria: one bounded new incident must reach intake, team claim or
assignment, HSE gate, material request/approval/issue/consumption, scoped
completion, acceptance, linked incident resolution, management report and
append-only audit without a manual database correction.

#### CH-AUD-008 — Major legacy operational domains still need explicit decisions

Canonical lighting energy/schedule, vehicle inspection/repair, camera technical
point review, fiber promotion, IoT device onboarding, attendance reconciliation,
remaining formal documents and payroll policy are not safe generic table-copy
tasks. Each needs a bounded authority/data contract and pilot acceptance.

### P3

#### CH-AUD-009 — Documentation contains historical/current ambiguity

The lighting discovery contract still describes an earlier read-only/81-row
state while `CURRENT_STATE.md` records the later editable master and 69 genuinely
unresolved rows. The generic-named release readiness runbook and release-contract
smoke remain pinned to the historical `0080` release. Historical evidence should
remain immutable, but files must be clearly labelled superseded or release-
specific so operators do not run the wrong gate.

#### CH-AUD-010 — Large source files increase change risk

Examples include `web/administration.js` (about 147 KB),
`api/src/routes/work-orders.js` (about 77 KB), `web/app.js` (about 77 KB),
`web/lighting.js` (about 66 KB), `web/business-modules.js` (about 65 KB), and
`api/src/routes/platform.js` (about 65 KB). Size alone is not dead code and is
not grounds for a broad refactor. Extract only along tested domain boundaries
when a real change requires it.

## Changes made

| File | Change | Risk |
| --- | --- | --- |
| `api/scripts/release-check.js` | Close DB pool on both pass and failure. | Low; release tooling only |
| `api/scripts/session-smoke.js` | Require a login-capable ordinary user for the 403 test. | Low; smoke fixture selection only |
| `api/test/data-management-foundation.test.js` | Guard release-check cleanup behavior. | Test only |
| `api/test/production-release-readiness.test.js` | Guard login-capable smoke selection. | Test only |
| This audit document | Record evidence and next batches. | Documentation only |

No production capability or architecture decision changed, so
`docs/CURRENT_STATE.md` and `docs/DECISIONS.md` were not modified.

## Recommended implementation batches

### Batch 1 — Reconcile the local release candidate

Outcome: current source, current local images and local schema all identify one
`0105` release, with verified backup and no production action.

Do not execute this batch without explicit approval because it recreates local
services and applies additive migrations to the local demo database.

### Batch 2 — Make test layers truthful

Outcome: unit/static tests, disposable DB integrations and read-only smokes have
separate commands and results. Skipped integrations cannot inflate the pass
headline.

Suggested verification:

```powershell
cd api
npm run check
npm test
```

Add a disposable-database command only after its create/retain/cleanup policy is
explicitly approved.

### Batch 3 — One real operational vertical-slice UAT

Outcome: a newly reported lighting or camera incident completes the entire
governed Work Order/HSE/material/report trace. Use synthetic or approved pilot
data and record timestamps, role decisions, denials, idempotent retries and
audit counts.

### Batch 4 — Lighting energy discovery and contract

Outcome: review the 19 schedule rows, 331 meter points and invoice/check evidence
without copying overwrite/clamp defects. Approve a canonical schedule, meter,
observation and supplier-invoice reconciliation contract before schema work.

### Batch 5 — Vehicle and field-safety gap

Outcome: decide whether the 3 vehicles, 135 inspection records and 4 repair
records belong in Fleet, Safety, Maintenance, or coordinated projections. Define
authority, evidence, recurrence, defect-to-Work-Order handoff and migration
rules before implementation.

### Batch 6 — Remaining reviewed migration queues

Outcome: resolve attendance cases, camera point/GPS review, fiber promotion,
remaining attachments, inactive identities and two unlinked safety
acknowledgements without guessed identity/history.

### Batch 7 — Authorization debt by domain

Suggested order: attachments, attendance, maintenance/procurement, dashboard
presentation, then IoT last. IoT must preserve Emergency > Manual > Weather >
Schedule > Default at every layer.

### Batch 8 — Dependency hardening

Handle the new API's Express/`qs` advisory after an upstream-compatible release
or a reviewed override test. Treat the legacy dependency set as separate
security batches; never run `npm audit fix --force` across the legacy application
as one change.

## Human decisions required

1. Whether to approve a local-only backup, migration `0104`-`0105`, and service
   recreate for Batch 1.
2. Which real pilot job may be used for the vertical-slice UAT, or whether to
   use fully synthetic rehearsal data.
3. Whether lighting schedule/meter/electricity reconciliation is the next
   operational priority ahead of vehicle inspection.
4. Whether legacy employee location, payroll, surveys, chat/assistant history,
   and public website content have a valid future OVERVA purpose. Default is no
   migration without an explicit privacy/business decision.
5. Whether the legacy server remains network-accessible; this determines the
   urgency of its dependency-hardening batch.

## Production GO recommendation

Current verdict: **not ready to use this local demo as the current release
candidate** because source/image/schema identities differ. This is not a verdict
that OVERVA is generally broken. Core imported data reconciliation is strong,
unit/static contracts pass, and current source images build. Reconcile the local
release candidate, make integration evidence truthful, then complete one real
operational vertical-slice UAT before treating the demo as GO evidence.
